import ctypes
import json
import os
import sys
from typing import Any, Dict, Optional


RUNTIME_FILENAME = "runtime.json"
DEFAULT_MUTEX_NAME = r"Local\LinkFlow.SingleInstance"
ERROR_ALREADY_EXISTS = 183


class SingleInstanceLock:
    """Hold a process-wide single-instance lock for the lifetime of LinkFlow."""

    def __init__(self, name: str = DEFAULT_MUTEX_NAME):
        self.name = name
        self._handle = None

    def acquire(self) -> bool:
        if self._handle is not None:
            return True
        if sys.platform != "win32":
            return True

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        self._handle = handle
        return True

    def release(self):
        if self._handle is None or sys.platform != "win32":
            self._handle = None
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        kernel32.CloseHandle(self._handle)
        self._handle = None


def runtime_path(data_dir: str) -> str:
    return os.path.join(os.path.abspath(data_dir), RUNTIME_FILENAME)


def write_runtime_info(data_dir: str, port: int, version: str) -> str:
    os.makedirs(data_dir, exist_ok=True)
    path = runtime_path(data_dir)
    temp_path = f"{path}.tmp"
    payload = {
        "pid": os.getpid(),
        "port": int(port),
        "version": str(version),
    }
    with open(temp_path, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)
    return path


def read_runtime_info(data_dir: str) -> Optional[Dict[str, Any]]:
    try:
        with open(runtime_path(data_dir), "r", encoding="utf-8") as stream:
            payload = json.load(stream)
        pid = int(payload["pid"])
        port = int(payload["port"])
        if pid <= 0 or not 1 <= port <= 65535:
            return None
        return {
            "pid": pid,
            "port": port,
            "version": str(payload.get("version", "")),
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def remove_runtime_info(data_dir: str, expected_pid: Optional[int] = None) -> bool:
    path = runtime_path(data_dir)
    if expected_pid is not None:
        payload = read_runtime_info(data_dir)
        if not payload or payload["pid"] != expected_pid:
            return False
    try:
        os.remove(path)
        return True
    except FileNotFoundError:
        return False
