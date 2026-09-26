using System;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LinkFlow;

/// <summary>Small Win32 / Shell helpers.</summary>
internal static class WinShell
{
    public static bool IsWindows11 => Environment.OSVersion.Version.Build >= 22000;

    public static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow", $"Failed to open {url}", ex);
        }
    }

    /// <summary>Opens Explorer with the file selected (reuses an Explorer window already showing that folder).</summary>
    public static void RevealInExplorer(string path)
    {
        RunSta(() =>
        {
            AllowSetForegroundWindow(ASFW_ANY);
            if (SHParseDisplayName(path, IntPtr.Zero, out IntPtr pidl, 0, out _) == 0 && pidl != IntPtr.Zero)
            {
                try
                {
                    if (SHOpenFolderAndSelectItems(pidl, 0, IntPtr.Zero, 0) == 0) return;
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pidl);
                }
            }
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
        });
    }

    /// <summary>Opens a folder, bringing an existing Explorer window for it to the front when there is one.</summary>
    public static void OpenFolder(string folder)
    {
        try { Directory.CreateDirectory(folder); } catch { }
        RunSta(() =>
        {
            AllowSetForegroundWindow(ASFW_ANY);
            if (ActivateExistingExplorer(folder)) return;
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = false });
        });
    }

    private static bool ActivateExistingExplorer(string folder)
    {
        try
        {
            Type? shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) return false;
            dynamic shell = Activator.CreateInstance(shellType)!;
            string target = NormalizePath(folder);
            dynamic windows = shell.Windows();
            int count = windows.Count;
            for (int i = 0; i < count; i++)
            {
                try
                {
                    dynamic window = windows.Item(i);
                    if (window == null) continue;
                    string current = window.Document.Folder.Self.Path;
                    if (NormalizePath(current) != target) continue;
                    ForceForeground(new IntPtr(Convert.ToInt64(window.HWND)));
                    return true;
                }
                catch
                {
                    // Not a file-system Explorer window.
                }
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow", "Could not enumerate Explorer windows", ex);
        }
        return false;
    }

    private static string NormalizePath(string path) =>
        Path.GetFullPath(path).TrimEnd('\\', '/').ToLowerInvariant();

    private static void RunSta(Action action)
    {
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception ex) { AppLog.Warn("LinkFlow", "Shell operation failed", ex); }
        })
        { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }

    public static void ForceForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return;

        IntPtr foreground = GetForegroundWindow();
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread &&
                        AttachThreadInput(currentThread, foregroundThread, true);
        try
        {
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
        }
        finally
        {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    public static void RestoreWindow(IntPtr hwnd) => ShowWindow(hwnd, SW_RESTORE);

    /// <summary>Finds a visible window (e.g. a browser tab) whose title contains the text and activates it.</summary>
    public static bool ActivateWindowByTitle(string fragment)
    {
        IntPtr match = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) && !IsIconic(hwnd)) return true;
            var title = new StringBuilder(512);
            GetWindowText(hwnd, title, title.Capacity);
            string text = title.ToString();
            if (text.Contains(fragment) && !text.Contains("Visual Studio") && !text.Contains(".py") &&
                !text.Contains(".md") && !text.Contains(".json") && !text.Contains(".html"))
            {
                match = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);

        if (match == IntPtr.Zero) return false;
        ForceForeground(match);
        return true;
    }

    public static int GetDpiAtCursor()
    {
        try
        {
            var pos = Cursor.Position;
            IntPtr monitor = MonitorFromPoint(new POINT { X = pos.X, Y = pos.Y }, MONITOR_DEFAULTTONEAREST);
            if (GetDpiForMonitor(monitor, 0, out uint dpiX, out _) == 0 && dpiX > 0) return (int)dpiX;
        }
        catch
        {
            // Fall back below.
        }
        return 96;
    }

    /// <summary>Windows 11 rounded corners and light border for the tray menu.</summary>
    public static void StyleMenuWindow(IntPtr hwnd)
    {
        try
        {
            int round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int));
            int border = 0x00E5E0DC; // #dce0e5 as COLORREF
            DwmSetWindowAttribute(hwnd, 34, ref border, sizeof(int));
        }
        catch
        {
            // Not supported before Windows 11.
        }
    }

    // ------------------------------------------------------------------ P/Invoke

    private const int ASFW_ANY = -1;
    private const int SW_RESTORE = 9;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr processId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int cmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHParseDisplayName(string name, IntPtr bindingContext, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);

    [DllImport("shell32.dll")]
    private static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint cidl, IntPtr apidl, uint flags);
}
