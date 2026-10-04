using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LinkFlow;

/// <summary>Tray icon, tray menu actions and main window lifetime.</summary>
internal sealed class TrayContext : ApplicationContext
{
    private readonly AppPaths _paths;
    private readonly LinkFlowServer _server;
    private readonly bool _devTools;
    private readonly NotifyIcon _icon;
    private readonly TrayMenu _menu;
    private readonly ToolStripMenuItem _autostartItem;
    private MainWindow? _window;
    private bool _useBrowser;
    private bool _exiting;

    public TrayContext(AppPaths paths, LinkFlowServer server, bool devTools)
    {
        _paths = paths;
        _server = server;
        _devTools = devTools;

        _menu = new TrayMenu();
        _menu.AddItem("打开 LinkFlow", ShowMainWindow);
        _menu.AddItem("在浏览器中打开", () => WinShell.OpenUrl(_server.PcUrl));
        _menu.AddItem("复制连接地址", CopyPhoneUrl);
        _menu.AddItem("打开文件接收目录", OpenFilesFolder);
        _menu.AddItem("查看运行日志", OpenLog);
        _menu.AddSeparator();
        _autostartItem = _menu.AddItem("开机自启动", ToggleAutostart);
        _menu.AddSeparator();
        _menu.AddItem("退出", Exit);
        _menu.Opening += (_, _) => _menu.SetChecked(_autostartItem, Autostart.IsEnabled());

        _icon = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = $"LinkFlow v{AppInfo.Version} (端口: {_server.Port})",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ShowMainWindow();
        };
        _icon.MouseDoubleClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ShowMainWindow();
        };

        ShowMainWindow();
    }

    private Icon LoadTrayIcon()
    {
        try
        {
            if (File.Exists(_paths.IconPath)) return new Icon(_paths.IconPath, SystemInformation.SmallIconSize);
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.Tray", "Failed to load tray icon", ex);
        }
        return SystemIcons.Application;
    }

    public void ShowMainWindow()
    {
        if (_exiting) return;
        if (_useBrowser)
        {
            WinShell.OpenUrl(_server.PcUrl);
            return;
        }
        if (_window == null || _window.IsDisposed)
        {
            _window = new MainWindow(_paths, _server.PcUrl, _devTools);
            _window.WebViewUnavailable += OnWebViewUnavailable;
            _window.SessionEnding += OnSessionEnding;
        }
        _window.ShowAndActivate();
    }

    private void OnWebViewUnavailable(Exception ex)
    {
        AppLog.Error("LinkFlow.Tray", "WebView2 is unavailable; falling back to the default browser", ex);
        _useBrowser = true;
        _window?.Hide();
        ShowBalloon("未能加载 WebView2 运行时，已改用默认浏览器打开 LinkFlow。", ToolTipIcon.Warning);
        WinShell.OpenUrl(_server.PcUrl);
    }

    private void CopyPhoneUrl()
    {
        try
        {
            string url = _server.PhoneUrl;
            Clipboard.SetDataObject(url, true, 10, 50);
            ShowBalloon($"连接地址已复制到剪贴板:\n{url}");
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.Tray", "Failed to copy phone URL", ex);
        }
    }

    private void OpenFilesFolder() =>
        WinShell.OpenFolder(Path.Combine(_paths.FilesDir, DateTime.Now.ToString("yyyy-MM")));

    private void OpenLog()
    {
        string? path = AppLog.FilePath;
        if (path != null && File.Exists(path))
        {
            WinShell.OpenUrl(path);
            return;
        }
        ShowBalloon("暂时无法打开运行日志。", ToolTipIcon.Warning);
    }

    private void ToggleAutostart()
    {
        bool enable = !Autostart.IsEnabled();
        if (Autostart.Set(enable)) ShowBalloon(enable ? "已开启开机自启动" : "已关闭开机自启动");
    }

    private void ShowBalloon(string text, ToolTipIcon icon = ToolTipIcon.Info)
    {
        try
        {
            _icon.ShowBalloonTip(2500, "LinkFlow", text, icon);
        }
        catch
        {
            // Ignore.
        }
    }

    public void Exit()
    {
        if (_exiting) return;
        _exiting = true;
        try
        {
            if (_window != null && !_window.IsDisposed) _window.CloseForExit();
        }
        catch
        {
            // Ignore.
        }
        _icon.Visible = false;
        ExitThread();
    }

    private void OnSessionEnding()
    {
        if (_exiting) return;
        _exiting = true;
        _icon.Visible = false;
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _icon.Dispose();
            _menu.Dispose();
            if (_window != null && !_window.IsDisposed) _window.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "LinkFlow";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) != null;
        }
        catch
        {
            return false;
        }
    }

    public static bool Set(bool enable)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enable) key.SetValue(ValueName, $"\"{Application.ExecutablePath}\"");
            else key.DeleteValue(ValueName, false);
            return true;
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.Tray", "Failed to update autostart", ex);
            return false;
        }
    }
}

/// <summary>
/// Tray context menu with 14 DIP text, 32 DIP rows, full-width separators and
/// trailing check marks, drawn with native GDI text at the monitor's real DPI.
/// </summary>
internal sealed class TrayMenu : ContextMenuStrip
{
    internal static readonly Color TextColor = Color.FromArgb(0x1F, 0x23, 0x28);
    internal static readonly Color HoverColor = Color.FromArgb(0xF3, 0xF4, 0xF6);
    internal static readonly Color BorderColor = Color.FromArgb(0xDC, 0xE0, 0xE5);
    internal static readonly Color SeparatorColor = Color.FromArgb(0xD3, 0xE3, 0xFD);
    internal static readonly Color CheckColor = TextColor;

    private readonly HashSet<ToolStripItem> _checked = new();
    private Font _menuFont = new("Microsoft YaHei UI", 14f, GraphicsUnit.Pixel);
    private int _dpi;

    public TrayMenu()
    {
        ShowImageMargin = false;
        ShowCheckMargin = false;
        BackColor = Color.White;
        ForeColor = TextColor;
        Renderer = new TrayMenuRenderer(this);
        DropShadowEnabled = !WinShell.IsWindows11;
    }

    private float _uiScale = 1f;

    internal float UiScale => _uiScale;
    internal Font MenuFont => _menuFont;

    public ToolStripMenuItem AddItem(string text, Action onClick)
    {
        var item = new ToolStripMenuItem(text) { AutoSize = false };
        item.Click += (_, _) => onClick();
        Items.Add(item);
        return item;
    }

    public void AddSeparator() => Items.Add(new ToolStripSeparator { AutoSize = false });

    public void SetChecked(ToolStripItem item, bool isChecked)
    {
        if (isChecked) _checked.Add(item);
        else _checked.Remove(item);
        item.Invalidate();
    }

    internal bool IsChecked(ToolStripItem item) => _checked.Contains(item);

    // Let DWM provide the same soft popup shadow as other Windows 11 applications.
    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            if (WinShell.IsWindows11) parameters.Style |= 0x00040000; // WS_THICKFRAME
            return parameters;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (WinShell.IsWindows11 && m.Msg == 0x0083 && m.WParam != IntPtr.Zero) // WM_NCCALCSIZE
        {
            m.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref m);
        if (!WinShell.IsWindows11) return;
        if (m.Msg == 0x0024) // WM_GETMINMAXINFO: do not impose a normal window's minimum width.
        {
            System.Runtime.InteropServices.Marshal.WriteInt32(m.LParam, 24, 1);
            System.Runtime.InteropServices.Marshal.WriteInt32(m.LParam, 28, 1);
        }
        if (m.Msg == 0x0084 && m.Result.ToInt32() is >= 10 and <= 18) m.Result = new IntPtr(1);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        WinShell.StyleMenuWindow(Handle);
    }

    protected override void OnOpening(CancelEventArgs e)
    {
        ApplyMetrics(WinShell.GetDpiAtCursor());
        base.OnOpening(e);
    }

    private int Px(float value) => (int)Math.Round(value * UiScale);

    /// <summary>Sizes everything in physical pixels for the monitor the menu opens on.</summary>
    private void ApplyMetrics(int dpi)
    {
        if (dpi == _dpi) return;
        _dpi = dpi;
        _uiScale = dpi / 96f;

        var oldFont = _menuFont;
        _menuFont = new Font("Microsoft YaHei UI", 14f * UiScale, GraphicsUnit.Pixel);
        Font = _menuFont;
        oldFont.Dispose();

        AutoSize = false; // ToolStripDropDownMenu otherwise replaces the measured width.
        SuspendLayout();
        Padding = new Padding(0, Px(8), 0, Px(8));

        int textWidth = 0;
        foreach (ToolStripItem item in Items)
        {
            if (item is ToolStripSeparator) continue;
            var size = TextRenderer.MeasureText(item.Text ?? "", _menuFont, Size.Empty,
                TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
            textWidth = Math.Max(textWidth, size.Width);
        }

        int width = Math.Max(Px(188), textWidth + Px(64));
        int height = Padding.Vertical;
        foreach (ToolStripItem item in Items)
        {
            bool separator = item is ToolStripSeparator;
            item.Margin = separator ? Padding.Empty : new Padding(Px(4), 0, Px(4), 0);
            item.Padding = Padding.Empty;
            item.Size = new Size(separator ? width : width - Px(8), separator ? Px(17) : Px(32));
            height += item.Height;
        }
        Size = new Size(width, height);
        ResumeLayout(true);
    }
}

internal sealed class TrayMenuRenderer : ToolStripRenderer
{
    private readonly TrayMenu _menu;

    public TrayMenuRenderer(TrayMenu menu) => _menu = menu;

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
    {
        e.Graphics.Clear(Color.White);
    }

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        if (WinShell.IsWindows11) return; // DWM draws the rounded border on Windows 11
        using var pen = new Pen(TrayMenu.BorderColor);
        e.Graphics.DrawRectangle(pen, 0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
    }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (!e.Item.Selected || !e.Item.Enabled) return;
        float s = _menu.UiScale;
        var rect = new RectangleF(0, 0, e.Item.Width, e.Item.Height);
        var g = e.Graphics;
        var previous = g.SmoothingMode;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = RoundedRect(rect, 6 * s))
        using (var brush = new SolidBrush(TrayMenu.HoverColor))
        {
            g.FillPath(brush, path);
        }
        g.SmoothingMode = previous;
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        float s = _menu.UiScale;
        var item = e.Item;
        int left = (int)Math.Round(16 * s);
        var rect = new Rectangle(left, 0, Math.Max(0, item.Width - left - (int)Math.Round(26 * s)), item.Height);
        TextRenderer.DrawText(e.Graphics, e.Text, _menu.MenuFont, rect,
            item.Enabled ? TrayMenu.TextColor : Color.FromArgb(104, 113, 125),
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine |
            TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);

        if (_menu.IsChecked(item)) DrawCheckMark(e.Graphics, item, s);
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        float s = _menu.UiScale;
        int inset = 0;
        int thickness = Math.Max(1, (int)Math.Round(s));
        int y = (e.Item.Height - thickness) / 2;
        using var brush = new SolidBrush(TrayMenu.SeparatorColor);
        e.Graphics.FillRectangle(brush, inset, y, Math.Max(0, e.Item.Width - inset * 2), thickness);
    }

    private static void DrawCheckMark(Graphics g, ToolStripItem item, float s)
    {
        float cx = item.Width - 20 * s;
        float cy = item.Height / 2f;
        var previous = g.SmoothingMode;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var pen = new Pen(TrayMenu.CheckColor, Math.Max(1.5f, 1.7f * s)))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            g.DrawLines(pen, new[]
            {
                new PointF(cx - 4 * s, cy),
                new PointF(cx - 1.3f * s, cy + 2.8f * s),
                new PointF(cx + 4 * s, cy - 3.2f * s),
            });
        }
        g.SmoothingMode = previous;
    }

    private static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        float d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
