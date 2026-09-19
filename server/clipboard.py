import ctypes
from ctypes import wintypes
import sys
import time
import logging

import struct
import os
from typing import List

logger = logging.getLogger(__name__)

CF_UNICODETEXT = 13
CF_HDROP = 15
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
        kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalFree.restype = wintypes.HGLOBAL
    except Exception as e:
        logger.error(f"Failed to bind Win32 clipboard APIs: {e}")

def set_clipboard_text(text: str) -> bool:
    """Set text into Windows clipboard with retry mechanism."""
    if not user32 or not kernel32:
        return False

    opened = False
    for i in range(20):
        if user32.OpenClipboard(0):
            opened = True
            break
        time.sleep(0.02 + i * 0.005)

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
            if hasattr(kernel32, "GlobalFree"):
                kernel32.GlobalFree(h_mem)
            return False
        ctypes.memmove(p_mem, data, len(data))
        kernel32.GlobalUnlock(h_mem)
        res = user32.SetClipboardData(CF_UNICODETEXT, h_mem)
        if not res and hasattr(kernel32, "GlobalFree"):
            kernel32.GlobalFree(h_mem)
            return False
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
    for i in range(20):
        if user32.OpenClipboard(0):
            opened = True
            break
        time.sleep(0.02 + i * 0.005)

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

def set_clipboard_files(file_paths: List[str]) -> bool:
    """Set physical files into Windows clipboard via CF_HDROP."""
    if not user32 or not kernel32:
        return False
    if not file_paths:
        return False

    # Standard DROPFILES struct:
    # DWORD pFiles = 20 (offset to file list)
    # POINT pt = (0, 0)
    # BOOL fNC = 0
    # BOOL fWide = 1 (wide chars, UTF-16LE)
    header = struct.pack("IIIII", 20, 0, 0, 0, 1)
    file_str = "\0".join(os.path.normpath(os.path.abspath(p)) for p in file_paths) + "\0\0"
    data = header + file_str.encode("utf-16le")

    opened = False
    for i in range(20):
        if user32.OpenClipboard(0):
            opened = True
            break
        time.sleep(0.02 + i * 0.005)

    if not opened:
        logger.warning("Could not open Windows clipboard for file copying (locked)")
        return False

    try:
        user32.EmptyClipboard()
        h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        if not h_mem:
            return False
        p_mem = kernel32.GlobalLock(h_mem)
        if not p_mem:
            if hasattr(kernel32, "GlobalFree"):
                kernel32.GlobalFree(h_mem)
            return False
        ctypes.memmove(p_mem, data, len(data))
        kernel32.GlobalUnlock(h_mem)
        res = user32.SetClipboardData(CF_HDROP, h_mem)
        if not res and hasattr(kernel32, "GlobalFree"):
            kernel32.GlobalFree(h_mem)
            return False
        return bool(res)
    except Exception as e:
        logger.error(f"Error setting clipboard files: {e}")
        return False
    finally:
        user32.CloseClipboard()

