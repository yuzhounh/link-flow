using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LinkFlow;

internal static class JsonFile
{
    public static readonly object Lock = new();
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    public static JsonObject Read(string path)
    {
        try
        {
            if (File.Exists(path) && JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8)) is JsonObject obj)
                return obj;
        }
        catch
        {
            // Treat unreadable files as empty.
        }
        return new JsonObject();
    }

    public static void Write(string path, JsonObject obj)
    {
        string temp = path + ".tmp";
        File.WriteAllText(temp, obj.ToJsonString(Indented), new UTF8Encoding(false));
        File.Move(temp, path, true);
    }
}

/// <summary>Single-instance handling (named mutex + data/runtime.json + local HTTP API).</summary>
internal static class Instance
{
    private static readonly HttpClient Http = new(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) };

    public sealed record RuntimeInfo(int Pid, int Port);

    public static RuntimeInfo? ReadRuntime(AppPaths paths)
    {
        try
        {
            var obj = JsonFile.Read(paths.RuntimePath);
            int pid = (int?)obj["pid"] ?? 0;
            int port = (int?)obj["port"] ?? 0;
            return pid > 0 && port >= 1 && port <= 65535 ? new RuntimeInfo(pid, port) : null;
        }
        catch
        {
            return null;
        }
    }

    public static void WriteRuntime(AppPaths paths, int port)
    {
        try
        {
            JsonFile.Write(paths.RuntimePath, new JsonObject
            {
                ["pid"] = Environment.ProcessId,
                ["port"] = port,
                ["version"] = AppInfo.Version,
            });
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow", "Failed to write runtime.json", ex);
        }
    }

    public static void RemoveRuntime(AppPaths paths)
    {
        try
        {
            if (ReadRuntime(paths)?.Pid == Environment.ProcessId) File.Delete(paths.RuntimePath);
        }
        catch
        {
            // Ignore.
        }
    }

    private static bool IsRunning(int port)
    {
        try
        {
            using var cts = new CancellationTokenSource(800);
            string body = Http.GetStringAsync($"http://127.0.0.1:{port}/api/system/info", cts.Token).GetAwaiter().GetResult();
            return body.Contains("status") && body.Contains("auto_clipboard");
        }
        catch
        {
            return false;
        }
    }

    public static int? FindActivePort(AppPaths paths)
    {
        int port = ReadRuntime(paths)?.Port ?? AppInfo.DefaultPort;
        if (IsRunning(port)) return port;
        if (port != AppInfo.DefaultPort && IsRunning(AppInfo.DefaultPort)) return AppInfo.DefaultPort;
        return null;
    }

    public static void Activate(AppPaths paths, int port)
    {
        RuntimeInfo? runtime = null;
        for (int i = 0; i < 10 && runtime == null; i++)
        {
            runtime = ReadRuntime(paths);
            if (runtime == null) Thread.Sleep(100);
        }
        if (runtime != null)
        {
            if (IsRunning(runtime.Port)) port = runtime.Port;
            WinShell.AllowSetForegroundWindow(runtime.Pid);
        }

        try
        {
            using var content = new StringContent("{}", Encoding.UTF8, "application/json");
            using var response = Http.PostAsync($"http://127.0.0.1:{port}/api/system/wake", content).GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
            if (doc.RootElement.TryGetProperty("window_activated", out var activated) && activated.ValueKind == JsonValueKind.True)
                return;
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow", "Failed to wake the running instance", ex);
        }

        if (WinShell.ActivateWindowByTitle("文件传输助手")) return;
        WinShell.OpenUrl($"http://localhost:{port}");
    }

    /// <summary>Gracefully stops the LinkFlow instance recorded in runtime.json.</summary>
    public static bool Stop(AppPaths paths)
    {
        var runtime = ReadRuntime(paths);
        if (runtime == null) return false;
        try
        {
            using var content = new StringContent("{}", Encoding.UTF8, "application/json");
            using var response = Http.PostAsync($"http://127.0.0.1:{runtime.Port}/api/system/shutdown", content).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode) return false;
        }
        catch
        {
            return false;
        }

        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline && File.Exists(paths.RuntimePath)) Thread.Sleep(100);
        Thread.Sleep(300);
        return true;
    }
}
