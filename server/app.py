import os
import json
import time
import uuid
import mimetypes
import logging
import hmac
import secrets
import shutil
from datetime import datetime
from typing import Set, Dict, Any, Optional, Callable
from urllib.parse import urlsplit

import tornado.web
import tornado.websocket
import tornado.ioloop

from .database import Database
from .network_utils import get_lan_ip, get_all_lan_ips
from .clipboard import set_clipboard_text, get_clipboard_text, set_clipboard_files
from .version import MAX_UPLOAD_BYTES, VERSION

logger = logging.getLogger(__name__)


def _managed_path(base_dir: str, relative_path: str) -> Optional[str]:
    """Resolve a stored relative path without allowing it to escape base_dir."""
    if not relative_path:
        return None
    base = os.path.abspath(base_dir)
    candidate = os.path.abspath(os.path.join(base, relative_path))
    try:
        if os.path.commonpath([base, candidate]) != base:
            return None
    except ValueError:
        return None
    return candidate


def _load_or_create_pairing_token(data_dir: str) -> str:
    config_path = os.path.join(data_dir, "config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            token = json.load(f).get("pairing_token", "")
        if isinstance(token, str) and len(token) >= 32:
            return token
    except (OSError, ValueError, AttributeError):
        pass

    token = secrets.token_urlsafe(32)
    temp_path = f"{config_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump({"pairing_token": token}, f, ensure_ascii=False, indent=2)
    os.replace(temp_path, config_path)
    return token


def request_origin_is_allowed(request) -> bool:
    origin = request.headers.get("Origin")
    if not origin:
        return True
    parsed = urlsplit(origin)
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() == request.host.lower()


def request_is_authorized(request, state: "AppState") -> bool:
    if state.is_host_ip(request.remote_ip):
        return True
    supplied = request.headers.get("X-LinkFlow-Token", "")
    if not supplied:
        raw_token = request.arguments.get("token", [b""])[0]
        supplied = raw_token.decode("utf-8", errors="ignore") if isinstance(raw_token, bytes) else str(raw_token)
    return bool(supplied) and hmac.compare_digest(supplied, state.pairing_token)

def delete_message_files(state, msg: Optional[Dict[str, Any]]):
    """Delete physical file and thumbnail from disk when a message is deleted."""
    if not msg:
        return
    file_path = msg.get("file_path")
    if file_path:
        full_path = _managed_path(state.files_dir, file_path)
        if full_path and os.path.isfile(full_path):
            try:
                os.remove(full_path)
                logger.info(f"Deleted physical file: {full_path}")
            except Exception as e:
                logger.error(f"Failed to delete physical file {full_path}: {e}")
    thumb_path = msg.get("thumb_path")
    if thumb_path:
        full_thumb = _managed_path(state.thumbs_dir, thumb_path)
        if full_thumb and os.path.isfile(full_thumb):
            try:
                os.remove(full_thumb)
                logger.info(f"Deleted physical thumb: {full_thumb}")
            except Exception as e:
                logger.error(f"Failed to delete physical thumb {full_thumb}: {e}")


def clear_all_data(state: "AppState") -> int:
    """Clear database records and all app-managed files as one user action."""
    backup_root = os.path.join(state.data_dir, f".clear-{uuid.uuid4().hex}")
    os.makedirs(backup_root, exist_ok=False)
    moved_directories = []

    try:
        for directory in (state.files_dir, state.thumbs_dir):
            if os.path.exists(directory):
                backup_path = os.path.join(backup_root, os.path.basename(directory))
                os.replace(directory, backup_path)
                moved_directories.append((directory, backup_path))
            os.makedirs(directory, exist_ok=True)
    except Exception:
        for directory, backup_path in reversed(moved_directories):
            shutil.rmtree(directory, ignore_errors=True)
            os.replace(backup_path, directory)
        shutil.rmtree(backup_root, ignore_errors=True)
        raise

    try:
        count = state.db.clear_all_messages()
    except Exception:
        for directory, backup_path in reversed(moved_directories):
            shutil.rmtree(directory, ignore_errors=True)
            os.replace(backup_path, directory)
        shutil.rmtree(backup_root, ignore_errors=True)
        raise

    try:
        shutil.rmtree(backup_root)
    except OSError as e:
        logger.warning(f"Cleared records but could not remove temporary file backup: {e}")
    return count

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
        self.local_ips = {"127.0.0.1", "::1"}.union(self.all_ips)
        self.pairing_token = _load_or_create_pairing_token(self.data_dir)
        self.auto_clipboard = True  # Automatically copy received text from phone to PC clipboard
        self.ws_clients: Set["WebSocketHandler"] = set()
        self.shutdown_callback: Optional[Callable[[], None]] = None

    def is_host_ip(self, client_ip: str) -> bool:
        return client_ip in self.local_ips

    def set_shutdown_callback(self, callback: Callable[[], None]):
        self.shutdown_callback = callback

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
        self.set_header("X-Content-Type-Options", "nosniff")
        self.set_header("Referrer-Policy", "no-referrer")

    def prepare(self):
        if not request_origin_is_allowed(self.request):
            raise tornado.web.HTTPError(403, reason="Cross-origin request rejected")
        if not request_is_authorized(self.request, self.state):
            raise tornado.web.HTTPError(401, reason="Pairing token required")

    def options(self, *args, **kwargs):
        self.set_status(204)
        self.finish()

    def require_host(self):
        if not self.state.is_host_ip(self.request.remote_ip):
            raise tornado.web.HTTPError(403, reason="This operation is only available on the host PC")

    @property
    def state(self) -> AppState:
        return self.application.settings["state"]


class WebSocketHandler(tornado.websocket.WebSocketHandler):
    def check_origin(self, origin):
        return request_origin_is_allowed(self.request)

    @property
    def state(self) -> AppState:
        return self.application.settings["state"]

    def prepare(self):
        if not request_origin_is_allowed(self.request):
            raise tornado.web.HTTPError(403, reason="Cross-origin WebSocket rejected")
        if not request_is_authorized(self.request, self.state):
            raise tornado.web.HTTPError(401, reason="Pairing token required")

    def open(self):
        self.state.ws_clients.add(self)
        client_ip = self.request.remote_ip
        is_host = self.state.is_host_ip(client_ip)
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

                sender = "pc" if self.state.is_host_ip(self.request.remote_ip) else "phone"
                msg_id = str(uuid.uuid4())
                ts = int(time.time() * 1000)

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
                if not self.state.is_host_ip(self.request.remote_ip):
                    self.write_message(json.dumps({
                        "type": "error",
                        "error": "Clearing all data is only available on the host PC"
                    }))
                    return
                clear_all_data(self.state)
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
        limit = min(max(int(self.get_argument("limit", "50")), 1), 500)
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
            self.require_host()
            count = clear_all_data(self.state)
            self.state.broadcast({"type": "messages_cleared"})
            self.write({"status": "ok", "cleared_count": count})


class UploadHandler(BaseHandler):
    def post(self):
        sender = "pc" if self.state.is_host_ip(self.request.remote_ip) else "phone"
        note = self.get_argument("note", "").strip()

        if "file" not in self.request.files:
            self.set_status(400)
            self.write({"error": "No file uploaded"})
            return

        uploaded_file = self.request.files["file"][0]
        raw_filename = uploaded_file["filename"]
        filename = os.path.basename(raw_filename) or "unnamed_file"
        body = uploaded_file["body"]
        file_size = len(body)
        if file_size > MAX_UPLOAD_BYTES:
            self.set_status(413)
            self.write({
                "error": f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit"
            })
            return

        # Categorize by month: data/files/YYYY-MM/
        month_str = datetime.now().strftime("%Y-%m")
        target_dir = os.path.join(self.state.files_dir, month_str)
        os.makedirs(target_dir, exist_ok=True)

        # Retain original filename if no collision; append 13-digit Unix millisecond timestamp if duplicate exists: {stem}-{timestamp}{ext}
        candidate_path = os.path.join(target_dir, filename)
        if not os.path.exists(candidate_path):
            safe_name = filename
        else:
            stem, ext = os.path.splitext(filename)
            ts = int(time.time() * 1000)
            safe_name = f"{stem}-{ts}{ext}"
            while os.path.exists(os.path.join(target_dir, safe_name)):
                ts += 1
                safe_name = f"{stem}-{ts}{ext}"

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
            "file_name": safe_name,
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
        is_host = self.state.is_host_ip(client_ip)
        response = {
            "status": "ok",
            "version": VERSION,
            "lan_ip": self.state.lan_ip,
            "all_ips": self.state.all_ips,
            "port": self.state.port,
            "auto_clipboard": self.state.auto_clipboard,
            "is_host": is_host,
            "max_upload_bytes": MAX_UPLOAD_BYTES,
            "stats": stats
        }
        if is_host:
            response["pairing_token"] = self.state.pairing_token
        self.write(response)

    def post(self):
        self.require_host()
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
        self.require_host()
        try:
            data = json.loads(self.request.body)
            text = data.get("text", "")
            success = set_clipboard_text(text)
            self.write({"status": "ok" if success else "failed"})
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})

    def get(self):
        self.require_host()
        text = get_clipboard_text()
        self.write({"status": "ok", "text": text})


from .window_utils import reveal_in_explorer



class OpenFileHandler(BaseHandler):
    def post(self):
        self.require_host()
        try:
            data = json.loads(self.request.body)
            msg_id = data.get("id")
            msg = self.state.db.get_message_by_id(msg_id)
            if not msg or not msg.get("file_path"):
                self.set_status(404)
                self.write({"error": "File not found"})
                return

            full_path = _managed_path(self.state.files_dir, msg["file_path"])
            if full_path and os.path.exists(full_path):
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
        self.require_host()
        try:
            data = json.loads(self.request.body)
            msg_id = data.get("id")
            msg = self.state.db.get_message_by_id(msg_id)
            if not msg or not msg.get("file_path"):
                self.set_status(404)
                self.write({"error": "未找到对应的文件记录"})
                return

            full_path = _managed_path(self.state.files_dir, msg["file_path"])
            if full_path and os.path.isfile(full_path):
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


class WakeHandler(BaseHandler):
    def post(self):
        self.require_host()
        local_ips = {"127.0.0.1", "::1", "localhost"}
        local_clients = [c for c in self.state.ws_clients if c.request.remote_ip in local_ips]
        has_client = len(local_clients) > 0
        if has_client:
            payload = json.dumps({"type": "wake_tab"})
            for client in local_clients:
                try:
                    client.write_message(payload)
                except Exception:
                    pass
        self.write({
            "status": "ok",
            "has_client": has_client,
            "client_count": len(local_clients)
        })

    def get(self):
        self.post()


class ShutdownHandler(BaseHandler):
    def post(self):
        self.require_host()
        if not self.state.shutdown_callback:
            self.set_status(503)
            self.write({"error": "Shutdown is not available"})
            return
        self.write({"status": "ok", "message": "LinkFlow is shutting down"})
        self.finish()
        tornado.ioloop.IOLoop.current().call_later(0.05, self.state.shutdown_callback)


class NoCacheStaticFileHandler(tornado.web.StaticFileHandler):
    def set_extra_headers(self, path):
        self.set_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.set_header("Pragma", "no-cache")
        self.set_header("Expires", "0")
        self.set_header("X-Content-Type-Options", "nosniff")
        self.set_header("Referrer-Policy", "no-referrer")


class ProtectedStaticFileHandler(tornado.web.StaticFileHandler):
    @property
    def state(self) -> AppState:
        return self.application.settings["state"]

    def prepare(self):
        if not request_origin_is_allowed(self.request):
            raise tornado.web.HTTPError(403, reason="Cross-origin request rejected")
        if not request_is_authorized(self.request, self.state):
            raise tornado.web.HTTPError(401, reason="Pairing token required")

    def set_extra_headers(self, path):
        self.set_header("X-Content-Type-Options", "nosniff")
        self.set_header("Referrer-Policy", "no-referrer")


def create_app(data_dir: str, static_dir: str, port: int) -> tornado.web.Application:
    state = AppState(data_dir=data_dir, port=port)
    settings = {
        "state": state,
        "debug": False,
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
        (r"/api/system/wake", WakeHandler),
        (r"/api/system/shutdown", ShutdownHandler),
        # Files and thumbnails static route
        (r"/files/(.*)", ProtectedStaticFileHandler, {"path": state.files_dir}),
        (r"/thumbs/(.*)", ProtectedStaticFileHandler, {"path": state.thumbs_dir}),
        # Frontend UI static route (disable cache for immediate updates)
        (r"/(.*)", NoCacheStaticFileHandler, {"path": static_dir, "default_filename": "index.html"}),
    ]

    return tornado.web.Application(handlers, **settings)
