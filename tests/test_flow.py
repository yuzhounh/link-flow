import os
import sys
import unittest
import tempfile
import time
import json
from io import BytesIO
from PIL import Image

# Ensure project root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.network_utils import get_lan_ip, find_available_port
from server.clipboard import set_clipboard_text, get_clipboard_text
from server.database import Database
from server.thumb_service import generate_thumbnail
import fitz

class TestLinkFlow(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "messages.db")
        self.thumbs_dir = os.path.join(self.temp_dir.name, "thumbs")
        self.db = Database(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_network_utils(self):
        ip = get_lan_ip()
        self.assertTrue(isinstance(ip, str))
        self.assertGreater(len(ip), 0)
        port = find_available_port(5837)
        self.assertGreaterEqual(port, 5837)

    def test_clipboard(self):
        test_str = "LinkFlow 测试剪切板同步 12345"
        success = set_clipboard_text(test_str)
        self.assertTrue(success)
        read_back = get_clipboard_text()
        self.assertEqual(read_back, test_str)

    def test_database_crud(self):
        # 1. Insert text message
        msg1 = {
            "id": "msg-001",
            "timestamp": int(time.time() * 1000),
            "sender": "phone",
            "msg_type": "text",
            "content": "待会把这行代码拷进论文",
            "file_name": "",
            "file_path": "",
            "file_size": 100,
            "mime_type": "text/plain",
            "thumb_path": ""
        }
        self.db.insert_message(msg1)

        # 2. Insert file message
        msg2 = {
            "id": "msg-002",
            "timestamp": int(time.time() * 1000) + 100,
            "sender": "pc",
            "msg_type": "pdf",
            "content": "论文初稿",
            "file_name": "manuscript.pdf",
            "file_path": "2026-09/manuscript.pdf",
            "file_size": 2048000,
            "mime_type": "application/pdf",
            "thumb_path": "thumb_manuscript.webp"
        }
        self.db.insert_message(msg2)

        # 3. Query
        messages = self.db.get_messages(limit=10)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["id"], "msg-001")
        self.assertEqual(messages[1]["id"], "msg-002")

        # 4. Search
        search_res = self.db.get_messages(search="论文")
        self.assertEqual(len(search_res), 2)

        search_res2 = self.db.get_messages(search="manuscript")
        self.assertEqual(len(search_res2), 1)

        # 5. Stats
        stats = self.db.get_stats()
        self.assertEqual(stats["total_messages"], 2)
        self.assertEqual(stats["total_file_size"], 2048100)

        # 6. Delete
        deleted = self.db.delete_message("msg-001")
        self.assertIsNotNone(deleted)
        self.assertEqual(len(self.db.get_messages()), 1)

    def test_image_no_thumbnail(self):
        # Images are treated as files and do not generate thumbnails
        img_path = os.path.join(self.temp_dir.name, "test_photo.jpg")
        img = Image.new("RGB", (1920, 1080), color=(100, 150, 200))
        img.save(img_path, "JPEG")

        thumb_name = generate_thumbnail(img_path, self.thumbs_dir, "image/jpeg")
        self.assertIsNone(thumb_name)

    def test_pdf_no_thumbnail(self):
        # PDFs are also treated uniformly as files without thumbnails
        pdf_path = os.path.join(self.temp_dir.name, "test_doc.pdf")
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 100), "LinkFlow Test PDF Document", fontsize=24)
        doc.save(pdf_path)
        doc.close()

        thumb_name = generate_thumbnail(pdf_path, self.thumbs_dir, "application/pdf")
        self.assertIsNone(thumb_name)


    def test_months_query(self):
        # Insert messages in different months
        t_sep = 1788220800000  # 2026-09-01 16:00:00 (approx)
        t_aug = 1785542400000  # 2026-08-01 16:00:00 (approx)

        self.db.insert_message({
            "id": "m-aug",
            "timestamp": t_aug,
            "sender": "pc",
            "msg_type": "text",
            "content": "8月旧消息"
        })
        self.db.insert_message({
            "id": "m-sep",
            "timestamp": t_sep,
            "sender": "phone",
            "msg_type": "text",
            "content": "9月新消息"
        })

        months = self.db.get_recorded_months()
        self.assertGreaterEqual(len(months), 2)
        month_names = [m["month"] for m in months]
        self.assertIn("2026-08", month_names)
        self.assertIn("2026-09", month_names)

        # Query specific month
        aug_msgs = self.db.get_messages(month="2026-08")
        self.assertEqual(len(aug_msgs), 1)
        self.assertEqual(aug_msgs[0]["id"], "m-aug")

        sep_msgs = self.db.get_messages(month="2026-09")
        self.assertEqual(len(sep_msgs), 1)
        self.assertEqual(sep_msgs[0]["id"], "m-sep")

if __name__ == "__main__":
    unittest.main()
