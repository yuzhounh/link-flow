import os
import sys
import json
import time
import uuid
import mimetypes
import logging
import subprocess
from datetime import datetime
from typing import Set, Dict, Any, Optional

import tornado.web
import tornado.websocket
import tornado.ioloop

from .database import Database
from .network_utils import get_lan_ip, get_all_lan_ips
from .clipboard import set_clipboard_text, get_clipboard_text
from .thumb_service import generate_thumbnail

logger = logging.getLogger(__name__)

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
        # Send welcome / connected status
        self.write_message(json.dumps({
            "type": "connected",
            "lan_ip": self.state.lan_ip,
            "port": self.state.port,
            "auto_clipboard": self.state.auto_clipboard
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
                    self.state.db.delete_message(msg_id)
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
        before_ts_int = int(before_ts) if before_ts else None

        messages = self.state.db.get_messages(limit=limit, before_ts=before_ts_int, search=search)
        self.write({"status": "ok", "messages": messages})

    def delete(self):
        msg_id = self.get_argument("id", None)
        if msg_id:
            deleted = self.state.db.delete_message(msg_id)
            if deleted:
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

        # Determine mime type & message type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"

        if mime_type.startswith("video/"):
            msg_type = "video"
        elif mime_type.startswith("audio/"):
            msg_type = "audio"
        elif mime_type == "application/pdf":
            msg_type = "pdf"
        else:
            # Images and generic documents are treated directly as files
            msg_type = "file"

        # Generate thumbnail for PDFs
        thumb_file = generate_thumbnail(full_path, self.state.thumbs_dir, mime_type) if msg_type == "pdf" else None
        thumb_path = thumb_file if thumb_file else ""

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


class SystemInfoHandler(BaseHandler):
    def get(self):
        stats = self.state.db.get_stats()
        self.write({
            "status": "ok",
            "lan_ip": self.state.lan_ip,
            "all_ips": self.state.all_ips,
            "port": self.state.port,
            "auto_clipboard": self.state.auto_clipboard,
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
            if os.path.exists(full_path) and sys.platform == "win32":
                # Reveal file in Windows Explorer
                subprocess.Popen(f'explorer /select,"{full_path}"')
                self.write({"status": "ok", "path": full_path})
            else:
                self.set_status(404)
                self.write({"error": "File does not exist on disk"})
        except Exception as e:
            self.set_status(500)
            self.write({"error": str(e)})


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
        (r"/api/upload", UploadHandler),
        (r"/api/system/info", SystemInfoHandler),
        (r"/api/system/clipboard", ClipboardHandler),
        (r"/api/system/open-file", OpenFileHandler),
        # Files and thumbnails static route
        (r"/files/(.*)", tornado.web.StaticFileHandler, {"path": state.files_dir}),
        (r"/thumbs/(.*)", tornado.web.StaticFileHandler, {"path": state.thumbs_dir}),
        # Frontend UI static route
        (r"/(.*)", tornado.web.StaticFileHandler, {"path": static_dir, "default_filename": "index.html"}),
    ]

    return tornado.web.Application(handlers, **settings)
