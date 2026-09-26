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

/// <summary>Locates the LinkFlow project root (the folder containing static\index.html).</summary>
internal sealed class AppPaths
{
    private AppPaths(string root) => Root = root;

    public string Root { get; }
    public string DataDir => Path.Combine(Root, "data");
    public string StaticDir => Path.Combine(Root, "static");
    public string FilesDir => Path.Combine(DataDir, "files");
    public string ThumbsDir => Path.Combine(DataDir, "thumbs");
    public string DbPath => Path.Combine(DataDir, "messages.db");
    public string ConfigPath => Path.Combine(DataDir, "config.json");
    public string RuntimePath => Path.Combine(DataDir, "runtime.json");
    public string LogPath => Path.Combine(DataDir, "linkflow.log");
    public string IconPath => Path.Combine(StaticDir, "icon.ico");

    public static AppPaths? Find()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "static", "index.html")))
                return new AppPaths(dir.FullName);
            dir = dir.Parent;
        }
        return null;
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var paths = AppPaths.Find();
        if (paths == null)
        {
            MessageBox.Show("未找到 static\\index.html。请把 LinkFlow 放在 LinkFlow 项目目录内运行。", "LinkFlow",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        Directory.CreateDirectory(paths.DataDir);
        AppLog.Init(paths.LogPath);

        if (args.Contains("--stop", StringComparer.OrdinalIgnoreCase))
            return Instance.Stop(paths) ? 0 : 1;

        int? activePort = Instance.FindActivePort(paths);
        if (activePort != null)
        {
            Instance.Activate(paths, activePort.Value);
            return 0;
        }

        using var mutex = new Mutex(false, AppInfo.MutexName, out bool createdNew);
        if (!createdNew)
        {
            Instance.Activate(paths, Instance.ReadRuntime(paths)?.Port ?? AppInfo.DefaultPort);
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.ThreadException += (_, e) => AppLog.Error("LinkFlow", "Unhandled UI exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            AppLog.Error("LinkFlow", "LinkFlow crashed", e.ExceptionObject as Exception);

        var host = new WinHost();
        var server = new LinkFlowServer(paths, host);
        try
        {
            Task.Run(() => server.StartAsync()).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            AppLog.Error("LinkFlow", "Failed to start the LinkFlow server", ex);
            MessageBox.Show("LinkFlow 服务启动失败：" + ex.Message, "LinkFlow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        Instance.WriteRuntime(paths, server.Port);
        AppLog.Info("LinkFlow", $"LinkFlow v{AppInfo.Version} started on port {server.Port}");

        try
        {
            using var tray = new TrayContext(paths, server, args.Contains("--devtools", StringComparer.OrdinalIgnoreCase));
            host.Attach(tray);
            Application.Run(tray);
        }
        finally
        {
            try
            {
                Task.Run(() => server.StopAsync()).Wait(TimeSpan.FromSeconds(3));
            }
            catch
            {
                // Ignore shutdown errors.
            }
            Instance.RemoveRuntime(paths);
            AppLog.Info("LinkFlow", "LinkFlow stopped");
        }
        return 0;
    }
}
