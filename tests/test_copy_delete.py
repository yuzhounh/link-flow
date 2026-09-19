import os
import sys
import unittest
import tempfile
import time
import json
import ctypes

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.clipboard import set_clipboard_files
from server.database import Database
from server.app import delete_message_files, AppState

class TestCopyAndDelete(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = os.path.join(self.temp_dir.name, "data")
        self.state = AppState(data_dir=self.data_dir, port=5837)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_set_clipboard_files(self):
        test_file = os.path.join(self.temp_dir.name, "测试文件.txt")
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("test content")

        ok = set_clipboard_files([test_file])
        self.assertTrue(ok)

        # Read back via CF_HDROP
        CF_HDROP = 15
        user32 = ctypes.windll.user32
        shell32 = ctypes.windll.shell32
        from ctypes import wintypes
        shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
        shell32.DragQueryFileW.restype = wintypes.UINT
        if user32.OpenClipboard(0):
            try:
                h_drop = user32.GetClipboardData(CF_HDROP)
                self.assertTrue(h_drop)
                count = shell32.DragQueryFileW(h_drop, 0xFFFFFFFF, None, 0)
                self.assertEqual(count, 1)
                buf = ctypes.create_unicode_buffer(1024)
                shell32.DragQueryFileW(h_drop, 0, buf, 1024)
                self.assertEqual(os.path.normpath(buf.value), os.path.normpath(test_file))
            finally:
                user32.CloseClipboard()

    def test_delete_message_files(self):
        # Create a mock file and thumbnail
        rel_file = "2026-09/test_doc.pdf"
        full_file = os.path.join(self.state.files_dir, rel_file)
        os.makedirs(os.path.dirname(full_file), exist_ok=True)
        with open(full_file, "w", encoding="utf-8") as f:
            f.write("pdf content")

        rel_thumb = "thumb_test_doc.webp"
        full_thumb = os.path.join(self.state.thumbs_dir, rel_thumb)
        os.makedirs(os.path.dirname(full_thumb), exist_ok=True)
        with open(full_thumb, "w", encoding="utf-8") as f:
            f.write("thumb content")

        self.assertTrue(os.path.isfile(full_file))
        self.assertTrue(os.path.isfile(full_thumb))

        msg = {
            "id": "msg-file-1",
            "file_path": rel_file,
            "thumb_path": rel_thumb
        }

        delete_message_files(self.state, msg)

        self.assertFalse(os.path.exists(full_file))
        self.assertFalse(os.path.exists(full_thumb))

if __name__ == "__main__":
    unittest.main()
