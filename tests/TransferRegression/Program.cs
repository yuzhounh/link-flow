using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Text.Json;

// A real server in an isolated directory; no desktop window, clipboard or user messages.
var assembly = Assembly.Load("LinkFlow");
var pathsType = assembly.GetType("LinkFlow.AppPaths", true)!;
var serverType = assembly.GetType("LinkFlow.LinkFlowServer", true)!;
var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "linkflow-transfer-test-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(Path.Combine(root, "static"));
Directory.CreateDirectory(Path.Combine(root, "data"));
File.WriteAllText(Path.Combine(root, "data", "config.json"), "{\"pairing_token\":\"test-pairing-token-0123456789abcdef\"}");
var paths = Activator.CreateInstance(pathsType, BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { root }, null)!;
var server = Activator.CreateInstance(serverType, new object?[] { paths, null })!;
try {
    await (Task)serverType.GetMethod("StartAsync")!.Invoke(server, null)!;
    int port = (int)serverType.GetProperty("Port")!.GetValue(server)!;
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    using var receiver = new ClientWebSocket();
    await receiver.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/ws"), timeout.Token);
    await ReadEvent(receiver, timeout.Token);
    using var handler = new SocketsHttpHandler { UseProxy = false, ConnectCallback = async (_, token) => {
        var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        socket.Bind(new IPEndPoint(IPAddress.Parse("127.0.0.2"), 0));
        await socket.ConnectAsync(new IPEndPoint(IPAddress.Loopback, port), token);
        return new NetworkStream(socket, ownsSocket: true);
    } };
    using var client = new HttpClient(handler);
    client.DefaultRequestHeaders.Add("X-LinkFlow-Token", "test-pairing-token-0123456789abcdef");
    byte[] payload = new byte[512 * 1024]; new Random(9).NextBytes(payload);
    client.DefaultRequestHeaders.Add("X-LinkFlow-File-Size", payload.Length.ToString());
    using var form = new MultipartFormDataContent();
    form.Add(new StringContent("Test phone"), "device");
    form.Add(new SlowContent(payload), "file", "transfer.bin");
    var upload = client.PostAsync($"http://127.0.0.1:{port}/api/upload", form, timeout.Token);
    var percentages = new List<int>();
    string? savedPath = null;
    while (savedPath == null) {
        using var message = await ReadEvent(receiver, timeout.Token);
        var json = message.RootElement;
        if (json.GetProperty("type").GetString() == "file_receiving") percentages.Add(json.GetProperty("percent").GetInt32());
        if (json.GetProperty("type").GetString() == "new_message") {
            if (json.GetProperty("message").GetProperty("sender").GetString() != "phone") throw new Exception("sender mismatch");
            if (!json.TryGetProperty("transfer_id", out _)) throw new Exception("missing transfer correlation");
            savedPath = json.GetProperty("message").GetProperty("file_path").GetString();
        }
    }
    using var response = await upload;
    response.EnsureSuccessStatusCode();
    if (!percentages.Contains(0) || !percentages.Any(p => p > 0 && p < 100)) throw new Exception("no real intermediate progress");
    if (!File.ReadAllBytes(Path.Combine(root, "data", "files", savedPath!)).SequenceEqual(payload)) throw new Exception("received bytes differ");
    Console.WriteLine("PASS: phone upload broadcasts real progress and is automatically saved on PC before completion");
    receiver.Abort();
} finally {
    await (Task)serverType.GetMethod("StopAsync")!.Invoke(server, null)!;
    var allowed = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (root.StartsWith(allowed, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(root).StartsWith("linkflow-transfer-test-")) Directory.Delete(root, true);
}
static async Task<JsonDocument> ReadEvent(ClientWebSocket socket, CancellationToken token) {
    using var output = new MemoryStream(); var buffer = new byte[8192]; WebSocketReceiveResult result;
    do { result = await socket.ReceiveAsync(buffer, token); output.Write(buffer, 0, result.Count); } while (!result.EndOfMessage);
    return JsonDocument.Parse(output.ToArray());
}
sealed class SlowContent(byte[] data) : HttpContent {
    protected override bool TryComputeLength(out long length) { length = data.Length; return true; }
    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context) {
        for (int i = 0; i < data.Length; i += 16384) { await stream.WriteAsync(data.AsMemory(i, Math.Min(16384, data.Length - i))); await stream.FlushAsync(); await Task.Delay(40); }
    }
}
