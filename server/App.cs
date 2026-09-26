using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace LinkFlow;

/// <summary>Things the web server needs from the Windows desktop side.</summary>
internal interface IHostBridge
{
    Task<bool> SetClipboardText(string text);
    Task<string> GetClipboardText();
    Task<bool> SetClipboardFile(string path);
    void RevealInExplorer(string path);
    bool Wake();
    void RequestShutdown();
}

/// <summary>
/// LAN web server: static UI, REST API, WebSocket timeline, pairing-token auth and file storage.
/// </summary>
internal sealed class LinkFlowServer
{
    private const string Category = "LinkFlow.Server";

    private static readonly JsonSerializerOptions JsonOpts = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static readonly FileExtensionContentTypeProvider MimeTypes = new();
    private static readonly HashSet<string> ApiPaths = new(StringComparer.Ordinal)
    {
        "/api/messages", "/api/months", "/api/upload", "/api/system/info", "/api/system/clipboard",
        "/api/system/open-file", "/api/system/copy-file", "/api/system/wake", "/api/system/shutdown",
    };

    private readonly AppPaths _paths;
    private readonly IHostBridge _host;
    private readonly object _dataLock = new();
    private readonly ConcurrentDictionary<WsClient, byte> _clients = new();

    private MessageDb _db = null!;
    private WebApplication? _app;
    private string _token = "";
    private string _lanIp = "127.0.0.1";
    private List<string> _allIps = new();
    private HashSet<string> _localIps = new();
    private volatile bool _autoClipboard = true;

    public LinkFlowServer(AppPaths paths, IHostBridge host)
    {
        _paths = paths;
        _host = host;
    }

    public int Port { get; private set; }
    public string PcUrl => $"http://localhost:{Port}";
    public string PhoneUrl => $"http://{_lanIp}:{Port}/?token={Uri.EscapeDataString(_token)}";

    private string UploadTempDir => Path.Combine(_paths.DataDir, ".uploads");

    // ------------------------------------------------------------------ lifecycle

    public async Task StartAsync()
    {
        Directory.CreateDirectory(_paths.FilesDir);
        Directory.CreateDirectory(_paths.ThumbsDir);
        _db = new MessageDb(_paths.DbPath);
        _token = LoadOrCreateToken();
        _allIps = NetworkHelper.GetLanIps();
        _lanIp = _allIps[0];
        _localIps = new HashSet<string>(_allIps) { "127.0.0.1", "::1" };

        int port = NetworkHelper.FindFreePort(AppInfo.DefaultPort);

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = _paths.Root,
            Args = Array.Empty<string>(),
        });
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(new FileLoggerProvider());
        builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
        builder.Logging.AddFilter("System", LogLevel.Warning);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
            options.Limits.MaxRequestBodySize = AppInfo.MaxRequestBytes;
            options.Listen(IPAddress.Any, port);
        });

        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            await next(context);
        });
        app.UseWebSockets();
        app.Use(async (context, next) =>
        {
            if (!await TryHandleAsync(context)) await next(context);
        });

        var staticFiles = new PhysicalFileProvider(_paths.StaticDir);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = staticFiles });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = staticFiles,
            ServeUnknownFileTypes = true,
            OnPrepareResponse = c =>
            {
                var headers = c.Context.Response.Headers;
                headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                headers["Pragma"] = "no-cache";
                headers["Expires"] = "0";
            },
        });

        await app.StartAsync();
        _app = app;
        Port = port;
    }

    public async Task StopAsync()
    {
        foreach (var client in _clients.Keys)
        {
            try { client.Socket.Abort(); } catch { }
        }
        if (_app == null) return;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await _app.StopAsync(cts.Token);
        }
        catch
        {
            // Ignore.
        }
        await _app.DisposeAsync();
        _app = null;
    }

    private string LoadOrCreateToken()
    {
        lock (JsonFile.Lock)
        {
            var config = JsonFile.Read(_paths.ConfigPath);
            if (config["pairing_token"] is JsonValue value && value.TryGetValue(out string? existing) &&
                existing != null && existing.Length >= 32)
                return existing;

            string token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
            config["pairing_token"] = token;
            JsonFile.Write(_paths.ConfigPath, config);
            return token;
        }
    }

    // ------------------------------------------------------------------ request plumbing

    private sealed class HttpError : Exception
    {
        public HttpError(int status, string message) : base(message) => Status = status;
        public int Status { get; }
    }

    private static string RemoteIp(HttpContext ctx)
    {
        var address = ctx.Connection.RemoteIpAddress;
        if (address == null) return "";
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        return address.ToString();
    }

    private bool IsHost(HttpContext ctx) => _localIps.Contains(RemoteIp(ctx));

    private static bool OriginAllowed(HttpContext ctx)
    {
        string origin = ctx.Request.Headers["Origin"].ToString();
        if (string.IsNullOrEmpty(origin)) return true;
        int sep = origin.IndexOf("://", StringComparison.Ordinal);
        if (sep <= 0) return false;
        string scheme = origin.Substring(0, sep).ToLowerInvariant();
        string netloc = origin.Substring(sep + 3).TrimEnd('/');
        return (scheme == "http" || scheme == "https") &&
               string.Equals(netloc, ctx.Request.Host.Value, StringComparison.OrdinalIgnoreCase);
    }

    private bool Authorized(HttpContext ctx)
    {
        if (IsHost(ctx)) return true;
        string supplied = ctx.Request.Headers["X-LinkFlow-Token"].ToString();
        if (supplied.Length == 0) supplied = ctx.Request.Query["token"].ToString();
        return supplied.Length > 0 &&
               CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(_token));
    }

    private async Task<bool> GuardAsync(HttpContext ctx)
    {
        if (!OriginAllowed(ctx))
        {
            await WriteJson(ctx, new { error = "Cross-origin request rejected" }, 403);
            return false;
        }
        if (!Authorized(ctx))
        {
            await WriteJson(ctx, new { error = "Pairing token required" }, 401);
            return false;
        }
        return true;
    }

    private void RequireHost(HttpContext ctx)
    {
        if (!IsHost(ctx)) throw new HttpError(403, "This operation is only available on the host PC");
    }

    private static HttpError MethodNotAllowed() => new(405, "Method Not Allowed");

    private static string Json(object value) => JsonSerializer.Serialize(value, JsonOpts);

    private static async Task WriteJson(HttpContext ctx, object body, int status = 200)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=UTF-8";
        await ctx.Response.WriteAsync(Json(body));
    }

    private static string? Arg(HttpContext ctx, string name)
    {
        var values = ctx.Request.Query[name];
        return values.Count == 0 ? null : values[values.Count - 1];
    }

    private static async Task<JsonElement> ReadJsonBody(HttpContext ctx)
    {
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        return doc.RootElement.Clone();
    }

    private static string? GetString(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string GuessMime(string fileName) =>
        MimeTypes.TryGetContentType(fileName, out var type) ? type : "application/octet-stream";

    private static string? ManagedPath(string baseDir, string? relative)
    {
        if (string.IsNullOrEmpty(relative)) return null;
        try
        {
            string basePath = Path.GetFullPath(baseDir);
            string candidate = Path.GetFullPath(Path.Combine(basePath, relative));
            string prefix = basePath.EndsWith(Path.DirectorySeparatorChar) ? basePath : basePath + Path.DirectorySeparatorChar;
            return candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? candidate : null;
        }
        catch
        {
            return null;
        }
    }

    private async Task<bool> TryHandleAsync(HttpContext ctx)
    {
        string path = ctx.Request.Path.Value ?? "/";

        if (path == "/ws")
        {
            if (await GuardAsync(ctx)) await HandleWebSocket(ctx);
            return true;
        }
        if (path.StartsWith("/files/", StringComparison.Ordinal))
        {
            if (await GuardAsync(ctx)) await ServeManagedFile(ctx, _paths.FilesDir, path.Substring("/files/".Length));
            return true;
        }
        if (path.StartsWith("/thumbs/", StringComparison.Ordinal))
        {
            if (await GuardAsync(ctx)) await ServeManagedFile(ctx, _paths.ThumbsDir, path.Substring("/thumbs/".Length));
            return true;
        }
        if (!ApiPaths.Contains(path)) return false;

        if (!await GuardAsync(ctx)) return true;
        if (HttpMethods.IsOptions(ctx.Request.Method))
        {
            ctx.Response.StatusCode = 204;
            return true;
        }

        try
        {
            switch (path)
            {
                case "/api/messages": await HandleMessages(ctx); break;
                case "/api/months": await HandleMonths(ctx); break;
                case "/api/upload": await HandleUpload(ctx); break;
                case "/api/system/info": await HandleSystemInfo(ctx); break;
                case "/api/system/clipboard": await HandleClipboard(ctx); break;
                case "/api/system/open-file": await HandleOpenFile(ctx); break;
                case "/api/system/copy-file": await HandleCopyFile(ctx); break;
                case "/api/system/wake": await HandleWake(ctx); break;
                case "/api/system/shutdown": await HandleShutdown(ctx); break;
            }
        }
        catch (HttpError e)
        {
            if (!ctx.Response.HasStarted) await WriteJson(ctx, new { error = e.Message }, e.Status);
        }
        catch (Exception ex)
        {
            AppLog.Error(Category, $"{ctx.Request.Method} {path} failed", ex);
            if (!ctx.Response.HasStarted) await WriteJson(ctx, new { error = ex.Message }, 500);
        }
        return true;
    }

    // ------------------------------------------------------------------ handlers

    private async Task HandleMessages(HttpContext ctx)
    {
        string method = ctx.Request.Method;
        if (HttpMethods.IsGet(method))
        {
            int limit = int.TryParse(Arg(ctx, "limit"), out int l) ? Math.Clamp(l, 1, 500) : 50;
            long? beforeTs = long.TryParse(Arg(ctx, "before_ts"), out long b) ? b : null;
            string? search = Arg(ctx, "search");
            string? month = Arg(ctx, "month");
            var messages = _db.GetMessages(limit, beforeTs,
                string.IsNullOrEmpty(search) ? null : search,
                string.IsNullOrEmpty(month) ? null : month);
            await WriteJson(ctx, new Dictionary<string, object?>
            {
                ["status"] = "ok",
                ["messages"] = messages,
                ["month"] = month,
            });
            return;
        }

        if (!HttpMethods.IsDelete(method)) throw MethodNotAllowed();

        string? id = Arg(ctx, "id");
        if (!string.IsNullOrEmpty(id))
        {
            Dictionary<string, object?>? deleted;
            lock (_dataLock) deleted = _db.Delete(id);
            if (deleted == null)
            {
                await WriteJson(ctx, new { error = "Message not found" }, 404);
                return;
            }
            DeleteMessageFiles(deleted);
            Broadcast(new { type = "message_deleted", id });
            await WriteJson(ctx, new { status = "ok", deleted = id });
            return;
        }

        RequireHost(ctx);
        int count;
        lock (_dataLock) count = ClearAllData();
        Broadcast(new { type = "messages_cleared" });
        await WriteJson(ctx, new { status = "ok", cleared_count = count });
    }

    private async Task HandleMonths(HttpContext ctx)
    {
        if (!HttpMethods.IsGet(ctx.Request.Method)) throw MethodNotAllowed();
        await WriteJson(ctx, new { status = "ok", months = _db.GetRecordedMonths() });
    }

    private async Task HandleUpload(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();

        string sender = IsHost(ctx) ? "pc" : "phone";
        string note = Arg(ctx, "note") ?? "";

        string? boundary = null;
        if (MediaTypeHeaderValue.TryParse(ctx.Request.ContentType, out var mediaType) &&
            mediaType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase))
            boundary = HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value;
        if (string.IsNullOrEmpty(boundary))
        {
            await WriteJson(ctx, new { error = "No file uploaded" }, 400);
            return;
        }

        Directory.CreateDirectory(UploadTempDir);
        string? tempPath = null;
        string? rawName = null;
        long size = 0;
        bool tooLarge = false;

        try
        {
            var reader = new MultipartReader(boundary, ctx.Request.Body);
            MultipartSection? section;
            while ((section = await reader.ReadNextSectionAsync(ctx.RequestAborted)) != null)
            {
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition))
                {
                    await section.Body.CopyToAsync(Stream.Null, ctx.RequestAborted);
                    continue;
                }

                string name = HeaderUtilities.RemoveQuotes(disposition.Name).Value ?? "";
                bool isFile = disposition.FileName.HasValue || disposition.FileNameStar.HasValue;

                if (isFile && name == "file" && tempPath == null)
                {
                    rawName = disposition.FileNameStar.HasValue
                        ? disposition.FileNameStar.Value
                        : HeaderUtilities.RemoveQuotes(disposition.FileName).Value;
                    tempPath = Path.Combine(UploadTempDir, Guid.NewGuid().ToString("N") + ".part");

                    await using (var output = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                    {
                        var buffer = new byte[81920];
                        int read;
                        while ((read = await section.Body.ReadAsync(buffer, ctx.RequestAborted)) > 0)
                        {
                            size += read;
                            if (size > AppInfo.MaxUploadBytes)
                            {
                                tooLarge = true;
                                break;
                            }
                            await output.WriteAsync(buffer.AsMemory(0, read), ctx.RequestAborted);
                        }
                    }
                    if (tooLarge) break;
                }
                else if (!isFile && name == "note")
                {
                    using var noteReader = new StreamReader(section.Body, Encoding.UTF8);
                    note = await noteReader.ReadToEndAsync(ctx.RequestAborted);
                }
                else
                {
                    await section.Body.CopyToAsync(Stream.Null, ctx.RequestAborted);
                }
            }
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            tooLarge = true;
        }
        catch
        {
            DeleteQuietly(tempPath);
            throw;
        }

        if (tooLarge)
        {
            DeleteQuietly(tempPath);
            await WriteJson(ctx, new { error = $"File exceeds the {AppInfo.MaxUploadBytes / (1024 * 1024)} MB upload limit" }, 413);
            return;
        }
        if (tempPath == null)
        {
            await WriteJson(ctx, new { error = "No file uploaded" }, 400);
            return;
        }

        string fileName = SafeFileName(rawName);
        Dictionary<string, object?> record;
        try
        {
            lock (_dataLock)
            {
                // Layout: data/files/YYYY-MM/, keep the original name,
                // append a 13-digit millisecond timestamp only on collision.
                string month = DateTime.Now.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                string targetDir = Path.Combine(_paths.FilesDir, month);
                Directory.CreateDirectory(targetDir);

                string safeName = fileName;
                if (File.Exists(Path.Combine(targetDir, safeName)))
                {
                    var (stem, ext) = SplitExt(fileName);
                    long ts = NowMs();
                    safeName = $"{stem}-{ts}{ext}";
                    while (File.Exists(Path.Combine(targetDir, safeName)))
                    {
                        ts++;
                        safeName = $"{stem}-{ts}{ext}";
                    }
                }

                File.Move(tempPath, Path.Combine(targetDir, safeName));
                record = NewRecord(sender, "file", note.Trim(), safeName, $"{month}/{safeName}", size, GuessMime(fileName));
                _db.Insert(record);
            }
        }
        catch
        {
            DeleteQuietly(tempPath);
            throw;
        }

        Broadcast(new { type = "new_message", message = record });
        await WriteJson(ctx, new { status = "ok", message = record });
    }

    private async Task HandleSystemInfo(HttpContext ctx)
    {
        if (HttpMethods.IsGet(ctx.Request.Method))
        {
            bool isHost = IsHost(ctx);
            var response = new Dictionary<string, object?>
            {
                ["status"] = "ok",
                ["version"] = AppInfo.Version,
                ["lan_ip"] = _lanIp,
                ["all_ips"] = _allIps,
                ["port"] = Port,
                ["auto_clipboard"] = _autoClipboard,
                ["is_host"] = isHost,
                ["max_upload_bytes"] = AppInfo.MaxUploadBytes,
                ["stats"] = _db.GetStats(),
            };
            if (isHost) response["pairing_token"] = _token;
            await WriteJson(ctx, response);
            return;
        }

        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();
        RequireHost(ctx);
        JsonElement body;
        try
        {
            body = await ReadJsonBody(ctx);
        }
        catch (Exception ex)
        {
            await WriteJson(ctx, new { error = ex.Message }, 400);
            return;
        }
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("auto_clipboard", out var value))
            _autoClipboard = Truthy(value);
        await WriteJson(ctx, new { status = "ok", auto_clipboard = _autoClipboard });
    }

    private async Task HandleClipboard(HttpContext ctx)
    {
        RequireHost(ctx);
        if (HttpMethods.IsGet(ctx.Request.Method))
        {
            string text = await _host.GetClipboardText();
            await WriteJson(ctx, new { status = "ok", text });
            return;
        }
        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();
        JsonElement body;
        try
        {
            body = await ReadJsonBody(ctx);
        }
        catch (Exception ex)
        {
            await WriteJson(ctx, new { error = ex.Message }, 400);
            return;
        }
        bool ok = await _host.SetClipboardText(GetString(body, "text") ?? "");
        await WriteJson(ctx, new { status = ok ? "ok" : "failed" });
    }

    private async Task HandleOpenFile(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();
        RequireHost(ctx);
        var body = await ReadJsonBody(ctx);
        string? id = GetString(body, "id");
        var message = id == null ? null : _db.GetById(id);
        string? filePath = message?.GetValueOrDefault("file_path") as string;
        if (string.IsNullOrEmpty(filePath))
        {
            await WriteJson(ctx, new { error = "File not found" }, 404);
            return;
        }

        string? fullPath = ManagedPath(_paths.FilesDir, filePath);
        if (fullPath != null && (File.Exists(fullPath) || Directory.Exists(fullPath)))
        {
            _host.RevealInExplorer(fullPath);
            await WriteJson(ctx, new { status = "ok", path = fullPath });
        }
        else
        {
            await WriteJson(ctx, new { error = "File does not exist on disk" }, 404);
        }
    }

    private async Task HandleCopyFile(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();
        RequireHost(ctx);
        try
        {
            var body = await ReadJsonBody(ctx);
            string? id = GetString(body, "id");
            var message = id == null ? null : _db.GetById(id);
            string? filePath = message?.GetValueOrDefault("file_path") as string;
            if (message == null || string.IsNullOrEmpty(filePath))
            {
                await WriteJson(ctx, new { error = "未找到对应的文件记录" }, 404);
                return;
            }

            string? fullPath = ManagedPath(_paths.FilesDir, filePath);
            if (fullPath == null || !File.Exists(fullPath))
            {
                await WriteJson(ctx, new { error = "本地磁盘上未找到该物理文件" }, 404);
                return;
            }

            if (await _host.SetClipboardFile(fullPath))
                await WriteJson(ctx, new { status = "ok", path = fullPath, file_name = message.GetValueOrDefault("file_name") as string ?? "" });
            else
                await WriteJson(ctx, new { error = "Windows 剪贴板被其他应用占用，复制失败，请稍后重试" }, 500);
        }
        catch (Exception ex)
        {
            await WriteJson(ctx, new { error = "复制异常: " + ex.Message }, 500);
        }
    }

    private async Task HandleWake(HttpContext ctx)
    {
        string method = ctx.Request.Method;
        if (!HttpMethods.IsPost(method) && !HttpMethods.IsGet(method)) throw MethodNotAllowed();
        RequireHost(ctx);

        bool windowActivated = false;
        try
        {
            windowActivated = _host.Wake();
        }
        catch (Exception ex)
        {
            AppLog.Warn(Category, "Wake callback error", ex);
        }

        var localClients = _clients.Keys.Where(c => c.Ip == "127.0.0.1" || c.Ip == "::1").ToList();
        string payload = Json(new { type = "wake_tab" });
        foreach (var client in localClients) client.Send(payload);

        await WriteJson(ctx, new
        {
            status = "ok",
            window_activated = windowActivated,
            has_client = localClients.Count > 0,
            client_count = localClients.Count,
        });
    }

    private async Task HandleShutdown(HttpContext ctx)
    {
        if (!HttpMethods.IsPost(ctx.Request.Method)) throw MethodNotAllowed();
        RequireHost(ctx);
        await WriteJson(ctx, new { status = "ok", message = "LinkFlow is shutting down" });
        await ctx.Response.CompleteAsync();
        _ = Task.Run(async () =>
        {
            await Task.Delay(50);
            _host.RequestShutdown();
        });
    }

    private async Task ServeManagedFile(HttpContext ctx, string baseDir, string relative)
    {
        string method = ctx.Request.Method;
        if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method))
        {
            await WriteJson(ctx, new { error = "Method Not Allowed" }, 405);
            return;
        }
        string? fullPath = ManagedPath(baseDir, relative);
        if (fullPath == null)
        {
            await WriteJson(ctx, new { error = "Forbidden" }, 403);
            return;
        }
        if (!File.Exists(fullPath))
        {
            await WriteJson(ctx, new { error = "Not Found" }, 404);
            return;
        }
        await TypedResults.PhysicalFile(fullPath, GuessMime(fullPath), enableRangeProcessing: true).ExecuteAsync(ctx);
    }

    // ------------------------------------------------------------------ WebSocket

    private sealed class WsClient
    {
        private readonly Channel<string> _outgoing =
            Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

        public WsClient(WebSocket socket, string ip, bool isHost)
        {
            Socket = socket;
            Ip = ip;
            IsHost = isHost;
        }

        public WebSocket Socket { get; }
        public string Ip { get; }
        public bool IsHost { get; }

        public void Send(string payload) => _outgoing.Writer.TryWrite(payload);
        public void Complete() => _outgoing.Writer.TryComplete();

        public async Task RunSenderAsync(CancellationToken token)
        {
            try
            {
                await foreach (string payload in _outgoing.Reader.ReadAllAsync(token))
                {
                    if (Socket.State != WebSocketState.Open) break;
                    byte[] bytes = Encoding.UTF8.GetBytes(payload);
                    await Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
                }
            }
            catch
            {
                // Connection closed.
            }
        }
    }

    private void Broadcast(object data)
    {
        string payload = Json(data);
        foreach (var client in _clients.Keys) client.Send(payload);
    }

    private async Task HandleWebSocket(HttpContext ctx)
    {
        if (!ctx.WebSockets.IsWebSocketRequest)
        {
            await WriteJson(ctx, new { error = "Can \"Upgrade\" only to \"WebSocket\"." }, 400);
            return;
        }

        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
        var client = new WsClient(socket, RemoteIp(ctx), IsHost(ctx));
        _clients[client] = 0;
        client.Send(Json(new
        {
            type = "connected",
            lan_ip = _lanIp,
            port = Port,
            auto_clipboard = _autoClipboard,
            is_host = client.IsHost,
        }));

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
        var senderTask = client.RunSenderAsync(cts.Token);
        try
        {
            var buffer = new byte[16 * 1024];
            using var message = new MemoryStream();
            while (socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                message.Write(buffer, 0, result.Count);
                if (message.Length > 10 * 1024 * 1024) break;
                if (!result.EndOfMessage) continue;
                if (result.MessageType == WebSocketMessageType.Text)
                    OnWebSocketMessage(client, Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length));
                message.SetLength(0);
            }
        }
        catch
        {
            // Client disconnected.
        }
        finally
        {
            _clients.TryRemove(client, out _);
            client.Complete();
            cts.Cancel();
            try { await senderTask; } catch { }
            if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
            {
                try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None); } catch { }
            }
        }
    }

    private void OnWebSocketMessage(WsClient client, string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            switch (GetString(root, "type"))
            {
                case "text":
                {
                    string content = (GetString(root, "content") ?? "").Trim();
                    if (content.Length == 0) return;
                    string sender = client.IsHost ? "pc" : "phone";
                    var record = NewRecord(sender, "text", content, "", "", Encoding.UTF8.GetByteCount(content), "text/plain");
                    lock (_dataLock) _db.Insert(record);
                    if (sender == "phone" && _autoClipboard) _ = _host.SetClipboardText(content);
                    Broadcast(new { type = "new_message", message = record });
                    break;
                }
                case "delete":
                {
                    string? id = GetString(root, "id");
                    if (string.IsNullOrEmpty(id)) return;
                    Dictionary<string, object?>? deleted;
                    lock (_dataLock) deleted = _db.Delete(id);
                    if (deleted != null) DeleteMessageFiles(deleted);
                    Broadcast(new { type = "message_deleted", id });
                    break;
                }
                case "clear_all":
                    if (!client.IsHost)
                    {
                        client.Send(Json(new { type = "error", error = "Clearing all data is only available on the host PC" }));
                        return;
                    }
                    lock (_dataLock) ClearAllData();
                    Broadcast(new { type = "messages_cleared" });
                    break;
                case "ping":
                    client.Send(Json(new { type = "pong" }));
                    break;
            }
        }
        catch (Exception ex)
        {
            AppLog.Error(Category, "Error processing WS message", ex);
        }
    }

    // ------------------------------------------------------------------ data helpers

    private static Dictionary<string, object?> NewRecord(string sender, string msgType, string content,
        string fileName, string filePath, long fileSize, string mimeType) => new()
    {
        ["id"] = Guid.NewGuid().ToString(),
        ["timestamp"] = NowMs(),
        ["sender"] = sender,
        ["msg_type"] = msgType,
        ["content"] = content,
        ["file_name"] = fileName,
        ["file_path"] = filePath,
        ["file_size"] = fileSize,
        ["mime_type"] = mimeType,
        ["thumb_path"] = "",
    };

    private void DeleteMessageFiles(Dictionary<string, object?> message)
    {
        DeleteManaged(_paths.FilesDir, message.GetValueOrDefault("file_path") as string);
        DeleteManaged(_paths.ThumbsDir, message.GetValueOrDefault("thumb_path") as string);
    }

    private static void DeleteManaged(string baseDir, string? relative)
    {
        string? full = ManagedPath(baseDir, relative);
        if (full == null || !File.Exists(full)) return;
        try
        {
            File.Delete(full);
            AppLog.Info(Category, $"Deleted physical file: {full}");
        }
        catch (Exception ex)
        {
            AppLog.Error(Category, $"Failed to delete physical file {full}", ex);
        }
    }

    /// <summary>Clears records and all managed files as one action, rolling back on failure.</summary>
    private int ClearAllData()
    {
        string backupRoot = Path.Combine(_paths.DataDir, ".clear-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(backupRoot);
        var moved = new List<(string Dir, string Backup)>();

        void Rollback()
        {
            for (int i = moved.Count - 1; i >= 0; i--)
            {
                try
                {
                    if (Directory.Exists(moved[i].Dir)) Directory.Delete(moved[i].Dir, true);
                    Directory.Move(moved[i].Backup, moved[i].Dir);
                }
                catch
                {
                    // Best effort.
                }
            }
            try { Directory.Delete(backupRoot, true); } catch { }
        }

        try
        {
            foreach (string dir in new[] { _paths.FilesDir, _paths.ThumbsDir })
            {
                if (Directory.Exists(dir))
                {
                    string backup = Path.Combine(backupRoot, Path.GetFileName(dir));
                    Directory.Move(dir, backup);
                    moved.Add((dir, backup));
                }
                Directory.CreateDirectory(dir);
            }
        }
        catch
        {
            Rollback();
            throw;
        }

        int count;
        try
        {
            count = _db.ClearAll();
        }
        catch
        {
            Rollback();
            throw;
        }

        try
        {
            Directory.Delete(backupRoot, true);
        }
        catch (Exception ex)
        {
            AppLog.Warn(Category, "Cleared records but could not remove temporary file backup", ex);
        }
        return count;
    }

    private static string SafeFileName(string? raw)
    {
        string name = (raw ?? "").Replace('\\', '/');
        int slash = name.LastIndexOf('/');
        if (slash >= 0) name = name.Substring(slash + 1);

        char[] invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(name.Length);
        foreach (char c in name) sb.Append(Array.IndexOf(invalid, c) >= 0 ? '_' : c);
        name = sb.ToString().Trim().TrimEnd('.', ' ');
        return name.Length == 0 ? "unnamed_file" : name;
    }

    /// <summary>Splits "name.ext" (leading dots are not an extension, e.g. ".bashrc").</summary>
    private static (string Stem, string Ext) SplitExt(string name)
    {
        int dot = name.LastIndexOf('.');
        if (dot <= 0 || name.Substring(0, dot).TrimStart('.').Length == 0) return (name, "");
        return (name.Substring(0, dot), name.Substring(dot));
    }

    private static bool Truthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.Number => value.GetDouble() != 0,
        JsonValueKind.String => (value.GetString() ?? "").Length > 0,
        JsonValueKind.Array => value.GetArrayLength() > 0,
        JsonValueKind.Object => value.EnumerateObject().Any(),
        _ => false,
    };

    private static void DeleteQuietly(string? path)
    {
        if (path == null) return;
        try { File.Delete(path); } catch { }
    }
}
