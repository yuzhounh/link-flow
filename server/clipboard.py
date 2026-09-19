import ctypes
from ctypes import wintypes
import sys
import time
import logging

logger = logging.getLogger(__name__)

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

user32 = None
kernel32 = None

if sys.platform == "win32":
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        user32.OpenClipboard.argtypes = [wintypes.HWND]
        user32.OpenClipboard.restype = wintypes.BOOL
        user32.EmptyClipboard.argtypes = []
        user32.EmptyClipboard.restype = wintypes.BOOL
        user32.CloseClipboard.argtypes = []
        user32.CloseClipboard.restype = wintypes.BOOL
        user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
        user32.SetClipboardData.restype = wintypes.HANDLE
        user32.GetClipboardData.argtypes = [wintypes.UINT]
        user32.GetClipboardData.restype = wintypes.HANDLE

        kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
        kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalLock.restype = wintypes.LPVOID
        kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalUnlock.restype = wintypes.BOOL
    except Exception as e:
        logger.error(f"Failed to bind Win32 clipboard APIs: {e}")

def set_clipboard_text(text: str) -> bool:
    """Set text into Windows clipboard with retry mechanism."""
    if not user32 or not kernel32:
        return False

    opened = False
    for _ in range(10):
        if user32.OpenClipboard(0):
            opened = True
            break
        time.sleep(0.02)

    if not opened:
        logger.warning("Could not open Windows clipboard (locked by another app)")
        return False

    try:
        user32.EmptyClipboard()
        data = text.encode("utf-16le") + b"\x00\x00"
        h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        if not h_mem:
            return False
        p_mem = kernel32.GlobalLock(h_mem)
        if not p_mem:
            return False
        ctypes.memmove(p_mem, data, len(data))
        kernel32.GlobalUnlock(h_mem)
        res = user32.SetClipboardData(CF_UNICODETEXT, h_mem)
        return bool(res)
    except Exception as e:
        logger.error(f"Error setting clipboard: {e}")
        return False
    finally:
        user32.CloseClipboard()

def get_clipboard_text() -> str:
    """Retrieve text from Windows clipboard with retry mechanism."""
    if not user32 or not kernel32:
        return ""

    opened = False
    for _ in range(10):
        if user32.OpenClipboard(0):
            opened = True
            break
        time.sleep(0.02)

    if not opened:
        return ""

    try:
        h_mem = user32.GetClipboardData(CF_UNICODETEXT)
        if not h_mem:
            return ""
        p_mem = kernel32.GlobalLock(h_mem)
        if not p_mem:
            return ""
        text = ctypes.wstring_at(p_mem)
        kernel32.GlobalUnlock(h_mem)
        return text
    except Exception as e:
        logger.error(f"Error getting clipboard: {e}")
        return ""
    finally:
        user32.CloseClipboard()
