import os
import sys
import time
import threading
import subprocess
import ctypes
from ctypes import wintypes

logger = None
try:
    import logging
    logger = logging.getLogger("LinkFlow.WindowUtils")
except Exception:
    pass

if sys.platform == "win32":
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL

    HWND_TOPMOST = -1
    HWND_NOTOPMOST = -2
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_SHOWWINDOW = 0x0040
    SW_RESTORE = 9
    SW_SHOW = 5
    VK_MENU = 0x12
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_EXTENDEDKEY = 0x0001
    SPI_GETFOREGROUNDLOCKTIMEOUT = 0x2000
    SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001
    SPIF_SENDWININICHANGE = 0x0002


def get_visible_cabinet_hwnds():
    """Return a list of all visible CabinetWClass (Explorer) window handles."""
    if sys.platform != "win32":
        return []
    hwnds = []

    def enum_cb(h, _):
        if user32.IsWindowVisible(h):
            cls = ctypes.create_unicode_buffer(64)
            user32.GetClassNameW(h, cls, 64)
            if cls.value == "CabinetWClass":
                hwnds.append(h)
        return True

    cb = WNDENUMPROC(enum_cb)
    user32.EnumWindows(cb, 0)
    return hwnds


def get_window_title(hwnd: int) -> str:
    """Get the window title for a given HWND."""
    if sys.platform != "win32" or not hwnd:
        return ""
    txt = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, txt, 512)
    return txt.value


def force_foreground_window(hwnd: int) -> bool:
    """Force a window to the front of all windows and activate it, bypassing Windows foreground lock."""
    if sys.platform != "win32" or not hwnd or not user32.IsWindow(hwnd):
        return False

    try:
        # 1. Unminimize / restore if iconic
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        else:
            user32.ShowWindow(hwnd, SW_SHOW)

        # 2. Get foreground and target thread IDs
        fore_hwnd = user32.GetForegroundWindow()
        fore_tid = user32.GetWindowThreadProcessId(fore_hwnd, None) if fore_hwnd else 0
        cur_tid = kernel32.GetCurrentThreadId()
        target_tid = user32.GetWindowThreadProcessId(hwnd, None)

        attached_fore = False
        attached_target = False
        if fore_tid and fore_tid != cur_tid:
            attached_fore = bool(user32.AttachThreadInput(cur_tid, fore_tid, True))
        if target_tid and target_tid != cur_tid:
            attached_target = bool(user32.AttachThreadInput(cur_tid, target_tid, True))

        # 3. Disable foreground lock timeout temporarily
        old_timeout = wintypes.DWORD()
        try:
            user32.SystemParametersInfoW(SPI_GETFOREGROUNDLOCKTIMEOUT, 0, ctypes.byref(old_timeout), 0)
            user32.SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, None, SPIF_SENDWININICHANGE)
        except Exception:
            pass

        # 4. Simulate ALT key press and release to break Windows focus stealing prevention
        try:
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY, 0)
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
        except Exception:
            pass

        # 5. Physically lift Z-order above all windows (TOPMOST then NOTOPMOST)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)

        # 6. Bring to Top and SetForegroundWindow
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        try:
            user32.SwitchToThisWindow(hwnd, True)
        except Exception:
            pass

        # 7. Detach thread input
        if attached_fore:
            user32.AttachThreadInput(cur_tid, fore_tid, False)
        if attached_target:
            user32.AttachThreadInput(cur_tid, target_tid, False)

        # 8. Restore lock timeout
        try:
            if old_timeout.value:
                user32.SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, ctypes.c_void_p(old_timeout.value), SPIF_SENDWININICHANGE)
        except Exception:
            pass

        # 9. WScript.Shell AppActivate secondary fallback
        try:
            import win32com.client
            wscript = win32com.client.Dispatch("WScript.Shell")
            wscript.AppActivate(hwnd)
        except Exception:
            pass

        return True
    except Exception as e:
        if logger:
            logger.warning(f"Error in force_foreground_window: {e}")
        return False


def find_explorer_hwnd(folder_path: str, before_hwnds: set = None) -> int:
    """Find the HWND of the Explorer window displaying the folder."""
    if sys.platform != "win32":
        return 0

    norm_folder = os.path.normpath(folder_path).lower().rstrip("\\/")
    folder_name = os.path.basename(norm_folder)

    # Strategy 1: Use Shell.Application COM interface to check exact LocationURL
    try:
        import win32com.client
        import urllib.parse
        shell = win32com.client.Dispatch("Shell.Application")
        for i in range(shell.Windows().Count):
            w = shell.Windows().Item(i)
            loc_url = getattr(w, "LocationURL", "") or ""
            if loc_url:
                parsed = urllib.parse.unquote(
                    loc_url.replace("file:///", "").replace("file://", "")
                ).replace("/", "\\").lower().rstrip("\\/")
                if parsed == norm_folder or norm_folder.startswith(parsed) or parsed.startswith(norm_folder):
                    return w.HWND
    except Exception:
        pass

    current_hwnds = get_visible_cabinet_hwnds()

    # Strategy 2: Check for a newly created CabinetWClass window
    if before_hwnds:
        new_hwnds = [h for h in current_hwnds if h not in before_hwnds]
        if new_hwnds:
            return new_hwnds[0]

    # Strategy 3: Check window title matching folder_name
    if folder_name:
        for h in current_hwnds:
            title = get_window_title(h).lower()
            if folder_name in title:
                return h

    # Strategy 4: Fallback to the first available Explorer window
    if current_hwnds:
        return current_hwnds[0]

    return 0


def reveal_in_explorer(file_path: str):
    """Open Windows Explorer, select the file, and bring the window to the foreground."""
    if sys.platform != "win32":
        return

    full_path = os.path.normpath(os.path.abspath(file_path))
    if not os.path.exists(full_path):
        return

    folder_path = full_path if os.path.isdir(full_path) else os.path.dirname(full_path)

    def _worker():
        try:
            user32.AllowSetForegroundWindow(-1)
        except Exception:
            pass

        before_hwnds = set(get_visible_cabinet_hwnds())

        # Launch Explorer to select the file or open the directory
        if os.path.isdir(full_path):
            try:
                os.startfile(full_path)
            except Exception:
                subprocess.Popen(f'explorer.exe "{full_path}"')
        else:
            subprocess.Popen(f'explorer.exe /select,"{full_path}"')

        # Poll for the window to appear and bring it to the foreground
        target_hwnd = 0
        for _ in range(20):
            time.sleep(0.1)
            target_hwnd = find_explorer_hwnd(folder_path, before_hwnds)
            if target_hwnd:
                break

        if target_hwnd:
            force_foreground_window(target_hwnd)
            # Re-assert foreground after a short delay to ensure it stays on top after Explorer animation
            time.sleep(0.25)
            force_foreground_window(target_hwnd)

    threading.Thread(target=_worker, daemon=True).start()


def open_folder_in_explorer(folder_path: str):
    """Open a folder in Windows Explorer and bring the window to the foreground."""
    if sys.platform != "win32":
        return

    full_path = os.path.normpath(os.path.abspath(folder_path))
    if not os.path.exists(full_path):
        os.makedirs(full_path, exist_ok=True)

    def _worker():
        try:
            user32.AllowSetForegroundWindow(-1)
        except Exception:
            pass

        before_hwnds = set(get_visible_cabinet_hwnds())

        try:
            os.startfile(full_path)
        except Exception:
            subprocess.Popen(f'explorer.exe "{full_path}"')

        target_hwnd = 0
        for _ in range(20):
            time.sleep(0.1)
            target_hwnd = find_explorer_hwnd(full_path, before_hwnds)
            if target_hwnd:
                break

        if target_hwnd:
            force_foreground_window(target_hwnd)
            time.sleep(0.25)
            force_foreground_window(target_hwnd)

    threading.Thread(target=_worker, daemon=True).start()
