import os
import sys
import json
import time
import uuid
import mimetypes
import logging
import subprocess
import ctypes
from ctypes import wintypes
import threading
from datetime import datetime
from typing import Set, Dict, Any, Optional

import tornado.web
import tornado.websocket
import tornado.ioloop

from .database import Database
from .network_utils import get_lan_ip, get_all_lan_ips
from .clipboard import set_clipboard_text, get_clipboard_text, set_clipboard_files
from .thumb_service import generate_thumbnail

logger = logging.getLogger(__name__)

def delete_message_files(state, msg: Optional[Dict[str, Any]]):
    """Delete physical file and thumbnail from disk when a message is deleted."""
    if not msg:
        return
    file_path = msg.get("file_path")
    if file_path:
        full_path = os.path.normpath(os.path.join(state.files_dir, file_path))
        if full_path.startswith(os.path.normpath(state.files_dir)) and os.path.isfile(full_path):
            try:
                os.remove(full_path)
                logger.info(f"Deleted physical file: {full_path}")
            except Exception as e:
                logger.error(f"Failed to delete physical file {full_path}: {e}")
    thumb_path = msg.get("thumb_path")
    if thumb_path:
        full_thumb = os.path.normpath(os.path.join(state.thumbs_dir, thumb_path))
        if full_thumb.startswith(os.path.normpath(state.thumbs_dir)) and os.path.isfile(full_thumb):
            try:
                os.remove(full_thumb)
                logger.info(f"Deleted physical thumb: {full_thumb}")
            except Exception as e:
                logger.error(f"Failed to delete physical thumb {full_thumb}: {e}")

class AppState:
    def __init__(self, data_dir: str, port: int):
        self.data_dir = os.path.abspath(data_dir)
        self.files_dir = os.path.join(self.data_dir, "files")
        self.thumbs_dir = os.path.join(self.data_dir, "thumbs")
        self.db_path = os.path.join(self.data_dir, "messages.db")
        os.makedirs(self.files_dir, exist_ok=True)
        os.makedirs(self.thumbs_dir, exist_ok=True)

        self.db = Database(self.db_path)
        self.port = port
        self.lan_ip = get_lan_ip()
        self.all_ips = get_all_lan_ips()
        self.auto_clipboard = True  # Automatically copy received text from phone to PC clipboard
        self.ws_clients: Set["WebSocketHandler"] = set()

    def broadcast(self, data: dict):
        payload = json.dumps(data, ensure_ascii=False)
        dead_clients = set()
        for client in self.ws_clients:
            try:
                client.write_message(payload)
            except Exception:
                dead_clients.add(client)
        self.ws_clients.difference_update(dead_clients)


class BaseHandler(tornado.web.RequestHandler):
    def set_default_headers(self):
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")

    def options(self, *args, **kwargs):
        self.set_status(204)
        self.finish()

    @property
    def state(self) -> AppState:
        return self.application.settings["state"]


class WebSocketHandler(tornado.websocket.WebSocketHandler):
    def check_origin(self, origin):
        return True

    @property
    def state(self) -> AppState:
        return self.application.settings["state"]

    def open(self):
        self.state.ws_clients.add(self)
        client_ip = self.request.remote_ip
        local_ips = {"127.0.0.1", "::1"}.union(self.state.all_ips)
        is_host = client_ip in local_ips
        # Send welcome / connected status
        self.write_message(json.dumps({
            "type": "connected",
            "lan_ip": self.state.lan_ip,
            "port": self.state.port,
            "auto_clipboard": self.state.auto_clipboard,
            "is_host": is_host
        }))

    def on_message(self, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "text":
                content = data.get("content", "").strip()
                if not content:
                    return

                sender = data.get("sender", "pc")
                msg_id = data.get("id") or str(uuid.uuid4())
                ts = data.get("timestamp") or int(time.time() * 1000)

                record = {
                    "id": msg_id,
                    "timestamp": ts,
                    "sender": sender,
                    "msg_type": "text",
                    "content": content,
                    "file_name": "",
                    "file_path": "",
                    "file_size": len(content.encode("utf-8")),
                    "mime_type": "text/plain",
                    "thumb_path": ""
                }
                self.state.db.insert_message(record)

                # If phone sent text and auto_clipboard is active, copy to PC clipboard
                if sender == "phone" and self.state.auto_clipboard:
                    set_clipboard_text(content)

                # Broadcast to all clients
                self.state.broadcast({
                    "type": "new_message",
                    "message": record
                })

            elif msg_type == "delete":
                msg_id = data.get("id")
                if msg_id:
                    deleted = self.state.db.delete_message(msg_id)
                    if deleted:
                        delete_message_files(self.state, deleted)
                    self.state.broadcast({
                        "type": "message_deleted",
                        "id": msg_id
                    })

            elif msg_type == "clear_all":
                self.state.db.clear_all_messages()
                self.state.broadcast({
                    "type": "messages_cleared"
                })

            elif msg_type == "ping":
                self.write_message(json.dumps({"type": "pong"}))

        except Exception as e:
            logger.error(f"Error processing WS message: {e}", exc_info=True)

    def on_close(self):
        self.state.ws_clients.discard(self)


class MessagesHandler(BaseHandler):
    def get(self):
        limit = int(self.get_argument("limit", "50"))
        before_ts = self.get_argument("before_ts", None)
        search = self.get_argument("search", None)
        month = self.get_argument("month", None)
        before_ts_int = int(before_ts) if before_ts else None

        messages = self.state.db.get_messages(limit=limit, before_ts=before_ts_int, search=search, month=month)
        self.write({"status": "ok", "messages": messages, "month": month})

    def delete(self):
        msg_id = self.get_argument("id", None)
        if msg_id:
            deleted = self.state.db.delete_message(msg_id)
            if deleted:
                delete_message_files(self.state, deleted)
                self.state.broadcast({"type": "message_deleted", "id": msg_id})
                self.write({"status": "ok", "deleted": msg_id})
            else:
                self.set_status(404)
                self.write({"error": "Message not found"})
        else:
            count = self.state.db.clear_all_messages()
            self.state.broadcast({"type": "messages_cleared"})
            self.write({"status": "ok", "cleared_count": count})


class UploadHandler(BaseHandler):
    def post(self):
        sender = self.get_argument("sender", "pc")
        note = self.get_argument("note", "").strip()

        if "file" not in self.request.files:
            self.set_status(400)
            self.write({"error": "No file uploaded"})
            return

        uploaded_file = self.request.files["file"][0]
        filename = uploaded_file["filename"]
        body = uploaded_file["body"]
        file_size = len(body)

        # Categorize by month: data/files/YYYY-MM/
        month_str = datetime.now().strftime("%Y-%m")
        target_dir = os.path.join(self.state.files_dir, month_str)
        os.makedirs(target_dir, exist_ok=True)

        # Unique file name to prevent collision
        prefix = int(time.time() * 1000)
        safe_name = f"{prefix}_{filename}"
        full_path = os.path.join(target_dir, safe_name)
        rel_path = f"{month_str}/{safe_name}"

        with open(full_path, "wb") as f:
            f.write(body)

        # Determine mime type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        # All files (PDF, images, videos, audios, archives, etc.) are treated uniformly as standard files without previews
        msg_type = "file"
        thumb_path = ""


        msg_id = str(uuid.uuid4())
        record = {
            "id": msg_id,
            "timestamp": int(time.time() * 1000),
            "sender": sender,
            "msg_type": msg_type,
            "content": note,
            "file_name": filename,
            "file_path": rel_path,
            "file_size": file_size,
            "mime_type": mime_type,
            "thumb_path": thumb_path
        }
        self.state.db.insert_message(record)

        # Broadcast via WebSocket
        self.state.broadcast({
            "type": "new_message",
            "message": record
        })

        self.write({"status": "ok", "message": record})


class MonthsHandler(BaseHandler):
    def get(self):
        months = self.state.db.get_recorded_months()
        self.write({"status": "ok", "months": months})


class SystemInfoHandler(BaseHandler):
    def get(self):
        stats = self.state.db.get_stats()
        client_ip = self.request.remote_ip
        local_ips = {"127.0.0.1", "::1"}.union(self.state.all_ips)
        is_host = client_ip in local_ips
        self.write({
            "status": "ok",
            "lan_ip": self.state.lan_ip,
            "all_ips": self.state.all_ips,
            "port": self.state.port,
            "auto_clipboard": self.state.auto_clipboard,
            "is_host": is_host,
            "stats": stats
        })

    def post(self):
        try:
            data = json.loads(self.request.body)
            if "auto_clipboard" in data:
                self.state.auto_clipboard = bool(data["auto_clipboard"])
            self.write({
                "status": "ok",
                "auto_clipboard": self.state.auto_clipboard
            })
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})


class ClipboardHandler(BaseHandler):
    def post(self):
        try:
            data = json.loads(self.request.body)
            text = data.get("text", "")
            success = set_clipboard_text(text)
            self.write({"status": "ok" if success else "failed"})
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})

    def get(self):
        text = get_clipboard_text()
        self.write({"status": "ok", "text": text})


def reveal_in_explorer(file_path: str):
    """Open Windows Explorer, select the file, and bring the window to the foreground."""
    if sys.platform != "win32":
        return

    full_path = os.path.normpath(os.path.abspath(file_path))
    if not os.path.exists(full_path):
        return

    folder_path = os.path.dirname(full_path)
    folder_name = os.path.basename(folder_path)

    def _worker():
        try:
            ctypes.windll.user32.AllowSetForegroundWindow(-1)
        except Exception:
            pass

        opened = False
        try:
            ctypes.windll.ole32.CoInitialize(None)
            ILCreateFromPathW = ctypes.windll.shell32.ILCreateFromPathW
            ILCreateFromPathW.restype = ctypes.c_void_p
            ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]

            ILFree = ctypes.windll.shell32.ILFree
            ILFree.argtypes = [ctypes.c_void_p]

            SHOpenFolderAndSelectItems = ctypes.windll.shell32.SHOpenFolderAndSelectItems
            SHOpenFolderAndSelectItems.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p, wintypes.DWORD]

            pidl = ILCreateFromPathW(full_path)
            if pidl:
                try:
                    hr = SHOpenFolderAndSelectItems(pidl, 0, None, 0)
                    if hr == 0:
                        opened = True
                finally:
                    ILFree(pidl)
            ctypes.windll.ole32.CoUninitialize()
        except Exception:
            pass

        if not opened:
            subprocess.Popen(f'explorer /select,"{full_path}"')

        # Poll and bring the Explorer window to foreground
        user32 = ctypes.windll.user32
        for _ in range(12):
            time.sleep(0.12)
            found = []

            def enum_cb(h, _):
                if user32.IsWindowVisible(h):
                    cls = ctypes.create_unicode_buffer(64)
                    user32.GetClassNameW(h, cls, 64)
                    if cls.value == "CabinetWClass":
                        txt = ctypes.create_unicode_buffer(512)
                        user32.GetWindowTextW(h, txt, 512)
                        if folder_name.lower() in txt.value.lower() or not folder_name:
                            found.append(h)
                return True

            cb_func = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(enum_cb)
            user32.EnumWindows(cb_func, 0)
            if found:
                hwnd = found[0]
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.BringWindowToTop(hwnd)
                user32.SetForegroundWindow(hwnd)
                try:
                    user32.SwitchToThisWindow(hwnd, True)
                except Exception:
                    pass
                break

    threading.Thread(target=_worker, daemon=True).start()


class OpenFileHandler(BaseHandler):
    def post(self):
        try:
            data = json.loads(self.request.body)
            msg_id = data.get("id")
            msg = self.state.db.get_message_by_id(msg_id)
            if not msg or not msg.get("file_path"):
                self.set_status(404)
                self.write({"error": "File not found"})
                return

            full_path = os.path.normpath(os.path.join(self.state.files_dir, msg["file_path"]))
            if os.path.exists(full_path):
                reveal_in_explorer(full_path)
                self.write({"status": "ok", "path": full_path})
            else:
                self.set_status(404)
                self.write({"error": "File does not exist on disk"})
        except Exception as e:
            self.set_status(500)
            self.write({"error": str(e)})


class CopyFileHandler(BaseHandler):
    def post(self):
        try:
            data = json.loads(self.request.body)
            msg_id = data.get("id")
            msg = self.state.db.get_message_by_id(msg_id)
            if not msg or not msg.get("file_path"):
                self.set_status(404)
                self.write({"error": "未找到对应的文件记录"})
                return

            full_path = os.path.normpath(os.path.join(self.state.files_dir, msg["file_path"]))
            if os.path.isfile(full_path):
                ok = set_clipboard_files([full_path])
                if ok:
                    self.write({"status": "ok", "path": full_path, "file_name": msg.get("file_name", "")})
                else:
                    self.set_status(500)
                    self.write({"error": "Windows 剪贴板被其他应用占用，复制失败，请稍后重试"})
            else:
                self.set_status(404)
                self.write({"error": "本地磁盘上未找到该物理文件"})
        except Exception as e:
            self.set_status(500)
            self.write({"error": f"复制异常: {str(e)}"})


class NoCacheStaticFileHandler(tornado.web.StaticFileHandler):
    def set_extra_headers(self, path):
        self.set_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.set_header("Pragma", "no-cache")
        self.set_header("Expires", "0")


def create_app(data_dir: str, static_dir: str, port: int) -> tornado.web.Application:
    state = AppState(data_dir=data_dir, port=port)
    settings = {
        "state": state,
        "debug": False,
        "max_buffer_size": 2 * 1024 * 1024 * 1024,  # 2GB max upload
    }

    handlers = [
        (r"/ws", WebSocketHandler),
        (r"/api/messages", MessagesHandler),
        (r"/api/months", MonthsHandler),
        (r"/api/upload", UploadHandler),
        (r"/api/system/info", SystemInfoHandler),
        (r"/api/system/clipboard", ClipboardHandler),
        (r"/api/system/open-file", OpenFileHandler),
        (r"/api/system/copy-file", CopyFileHandler),
        # Files and thumbnails static route
        (r"/files/(.*)", tornado.web.StaticFileHandler, {"path": state.files_dir}),
        (r"/thumbs/(.*)", tornado.web.StaticFileHandler, {"path": state.thumbs_dir}),
        # Frontend UI static route (disable cache for immediate updates)
        (r"/(.*)", NoCacheStaticFileHandler, {"path": static_dir, "default_filename": "index.html"}),
    ]

    return tornado.web.Application(handlers, **settings)
