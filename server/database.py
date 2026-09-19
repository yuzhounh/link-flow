import sqlite3
import os
import time
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

from contextlib import contextmanager

class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.init_db()

    @contextmanager
    def get_conn(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def init_db(self):
        with self.get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    timestamp INTEGER NOT NULL,
                    sender TEXT NOT NULL,
                    msg_type TEXT NOT NULL,
                    content TEXT,
                    file_name TEXT,
                    file_path TEXT,
                    file_size INTEGER DEFAULT 0,
                    mime_type TEXT,
                    thumb_path TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp DESC)")
            conn.commit()

    def insert_message(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        with self.get_conn() as conn:
            conn.execute("""
                INSERT INTO messages (id, timestamp, sender, msg_type, content, file_name, file_path, file_size, mime_type, thumb_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg["id"],
                msg.get("timestamp", int(time.time() * 1000)),
                msg.get("sender", "pc"),
                msg.get("msg_type", "text"),
                msg.get("content", ""),
                msg.get("file_name", ""),
                msg.get("file_path", ""),
                msg.get("file_size", 0),
                msg.get("mime_type", ""),
                msg.get("thumb_path", "")
            ))
            conn.commit()
        return msg

    def get_messages(self, limit: int = 50, before_ts: Optional[int] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
        query = "SELECT * FROM messages WHERE 1=1"
        params: List[Any] = []

        if before_ts:
            query += " AND timestamp < ?"
            params.append(before_ts)

        if search:
            query += " AND (content LIKE ? OR file_name LIKE ?)"
            search_param = f"%{search}%"
            params.extend([search_param, search_param])

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            messages = [dict(row) for row in rows]
            # Return in chronological order (oldest first for chat timeline display)
            messages.reverse()
            return messages

    def get_message_by_id(self, msg_id: str) -> Optional[Dict[str, Any]]:
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def delete_message(self, msg_id: str) -> Optional[Dict[str, Any]]:
        msg = self.get_message_by_id(msg_id)
        if msg:
            with self.get_conn() as conn:
                conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
                conn.commit()
        return msg

    def clear_all_messages(self) -> int:
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages")
            count = cursor.rowcount
            conn.commit()
            return count

    def get_stats(self) -> Dict[str, Any]:
        with self.get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*), SUM(file_size) FROM messages")
            row = cursor.fetchone()
            count = row[0] if row and row[0] is not None else 0
            total_size = row[1] if row and row[1] is not None else 0
            return {
                "total_messages": count,
                "total_file_size": total_size
            }
