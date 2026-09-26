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

/// <summary>IHostBridge implementation: runs clipboard / window work on the WinForms UI thread.</summary>
internal sealed class WinHost : IHostBridge
{
    private readonly Control _ui;
    private TrayContext? _tray;

    public WinHost()
    {
        _ui = new Control();
        _ = _ui.Handle; // create the handle on the UI thread so BeginInvoke works from server threads
    }

    public void Attach(TrayContext tray) => _tray = tray;

    private Task<T> OnUi<T>(Func<T> action)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _ui.BeginInvoke(new Action(() =>
            {
                try { tcs.SetResult(action()); }
                catch (Exception ex) { tcs.SetException(ex); }
            }));
        }
        catch (Exception ex)
        {
            tcs.SetException(ex);
        }
        return tcs.Task;
    }

    public Task<bool> SetClipboardText(string text) => OnUi(() =>
    {
        try
        {
            if (text.Length == 0) Clipboard.Clear();
            else Clipboard.SetDataObject(text, true, 20, 50);
            return true;
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.Clipboard", "Could not set clipboard text", ex);
            return false;
        }
    });

    public Task<string> GetClipboardText() => OnUi(() =>
    {
        try
        {
            return Clipboard.ContainsText() ? Clipboard.GetText() : "";
        }
        catch
        {
            return "";
        }
    });

    public Task<bool> SetClipboardFile(string path) => OnUi(() =>
    {
        try
        {
            var data = new DataObject();
            data.SetFileDropList(new StringCollection { path });
            Clipboard.SetDataObject(data, true, 20, 50);
            return true;
        }
        catch (Exception ex)
        {
            AppLog.Warn("LinkFlow.Clipboard", "Could not copy file to clipboard", ex);
            return false;
        }
    });

    public void RevealInExplorer(string path) => WinShell.RevealInExplorer(path);

    public bool Wake()
    {
        var tray = _tray;
        if (tray == null) return false;
        _ui.BeginInvoke(new Action(tray.ShowMainWindow));
        return true;
    }

    public void RequestShutdown()
    {
        _ui.BeginInvoke(new Action(() =>
        {
            if (_tray != null) _tray.Exit();
            else Application.Exit();
        }));
    }
}
