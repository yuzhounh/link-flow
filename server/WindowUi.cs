using System;
using System.Drawing;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LinkFlow;

/// <summary>Main window: a native window hosting the web UI (static/) in WebView2.</summary>
internal sealed class MainWindow : Form
{
    private const string PlacementKey = "window_native";

    private readonly AppPaths _paths;
    private readonly string _url;
    private readonly bool _devTools;
    private readonly WebView2 _webView;
    private readonly System.Windows.Forms.Timer _saveTimer;
    private bool _allowClose;

    public event Action<Exception>? WebViewUnavailable;
    public event Action? SessionEnding;

    public MainWindow(AppPaths paths, string url, bool devTools)
    {
        _paths = paths;
        _url = url;
        _devTools = devTools;

        Text = AppInfo.WindowTitle;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.FromArgb(0xED, 0xED, 0xED);
        try
        {
            if (File.Exists(paths.IconPath)) Icon = new Icon(paths.IconPath);
        }
        catch
        {
            // Keep the default icon.
        }

        _webView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(_webView);

        _saveTimer = new System.Windows.Forms.Timer { Interval = 400 };
        _saveTimer.Tick += (_, _) =>
        {
            _saveTimer.Stop();
            SavePlacement();
        };

        RestorePlacement();
    }

    // ------------------------------------------------------------------ WebView2

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            string userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LinkFlow", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);

            var core = _webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = _devTools;
            core.Settings.AreBrowserAcceleratorKeysEnabled = _devTools;
            core.Settings.IsStatusBarEnabled = false;

            // Links that leave LinkFlow open in the default browser.
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                WinShell.OpenUrl(args.Uri);
            };
            core.NavigationStarting += (_, args) =>
            {
                if (IsLocalUrl(args.Uri)) return;
                args.Cancel = true;
                if (args.IsUserInitiated) WinShell.OpenUrl(args.Uri);
            };
            core.ProcessFailed += (_, args) =>
            {
                if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                    args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                {
                    BeginInvoke(new Action(() =>
                    {
                        try { _webView.Reload(); } catch { }
                    }));
                }
            };

            core.Navigate(_url);
        }
        catch (Exception ex)
        {
            WebViewUnavailable?.Invoke(ex);
        }
    }

    private static bool IsLocalUrl(string url) =>
        url.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase) ||
        url.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
        url.StartsWith("about:", StringComparison.OrdinalIgnoreCase) ||
        url.StartsWith("data:", StringComparison.OrdinalIgnoreCase);

    // ------------------------------------------------------------------ show / hide / close

    public void ShowAndActivate()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WinShell.RestoreWindow(Handle);
        Activate();
        WinShell.ForceForeground(Handle);
        _webView.Focus();
    }

    /// <summary>Closing the window hides it to the tray.</summary>
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        SavePlacement();
        if (!_allowClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        if (e.CloseReason == CloseReason.WindowsShutDown) SessionEnding?.Invoke();
        base.OnFormClosing(e);
    }

    public void CloseForExit()
    {
        _allowClose = true;
        Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _saveTimer.Dispose();
        base.Dispose(disposing);
    }

    // ------------------------------------------------------------------ size and position

    protected override void OnMove(EventArgs e)
    {
        base.OnMove(e);
        ScheduleSave();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        ScheduleSave();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        float scale = e.DeviceDpiNew / 96f;
        MinimumSize = new Size((int)(380 * scale), (int)(500 * scale));
        Bounds = e.SuggestedRectangle;
    }

    private void ScheduleSave()
    {
        if (!Visible || WindowState == FormWindowState.Minimized) return;
        _saveTimer.Stop();
        _saveTimer.Start();
    }

    private void RestorePlacement()
    {
        float scale = DeviceDpi / 96f;
        MinimumSize = new Size((int)(380 * scale), (int)(500 * scale));

        try
        {
            JsonObject? saved;
            lock (JsonFile.Lock) saved = JsonFile.Read(_paths.ConfigPath)[PlacementKey] as JsonObject;
            if (saved != null)
            {
                var rect = new Rectangle((int?)saved["x"] ?? 0, (int?)saved["y"] ?? 0,
                    (int?)saved["width"] ?? 0, (int?)saved["height"] ?? 0);
                if (rect.Width > 0 && rect.Height > 0 && TitleBarVisible(rect, scale))
                {
                    Bounds = rect;
                    if ((bool?)saved["maximized"] == true) WindowState = FormWindowState.Maximized;
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.WindowUI", "Failed to restore window state", ex);
        }

        // Default: 520x780 companion window on the right side of the primary screen.
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        int width = (int)(520 * scale);
        int height = (int)(780 * scale);
        int x = area.Right - (int)(560 * scale);
        int y = area.Top + (area.Height - height) / 2;
        if (x < area.Left) x = area.Left + (area.Width - width) / 2;
        y = Math.Max(area.Top + (int)(40 * scale), y);
        Bounds = new Rectangle(x, y, width, height);
    }

    private static bool TitleBarVisible(Rectangle rect, float scale)
    {
        var titleBar = new Rectangle(rect.X, rect.Y, Math.Min(rect.Width, (int)(120 * scale)), (int)(40 * scale));
        foreach (var screen in Screen.AllScreens)
        {
            if (screen.WorkingArea.IntersectsWith(titleBar)) return true;
        }
        return false;
    }

    private void SavePlacement()
    {
        if (!IsHandleCreated || WindowState == FormWindowState.Minimized) return;
        try
        {
            var rect = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            lock (JsonFile.Lock)
            {
                var config = JsonFile.Read(_paths.ConfigPath);
                config[PlacementKey] = new JsonObject
                {
                    ["x"] = rect.X,
                    ["y"] = rect.Y,
                    ["width"] = rect.Width,
                    ["height"] = rect.Height,
                    ["maximized"] = WindowState == FormWindowState.Maximized,
                };
                JsonFile.Write(_paths.ConfigPath, config);
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.WindowUI", "Failed to save window state", ex);
        }
    }
}
