import os
import sys
import json
import tempfile
import unittest
import urllib.parse
from tornado.testing import AsyncHTTPTestCase, gen_test
from tornado.websocket import websocket_connect

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.app import create_app

class TestServerApp(AsyncHTTPTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        super().setUp()

    def tearDown(self):
        super().tearDown()
        self.temp_dir.cleanup()

    def get_app(self):
        data_dir = os.path.join(self.temp_dir.name, "data")
        static_dir = os.path.join(BASE_DIR, "static")
        return create_app(data_dir=data_dir, static_dir=static_dir, port=self.get_http_port())

    def test_system_info(self):
        response = self.fetch("/api/system/info")
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertEqual(data["status"], "ok")
        self.assertIn("lan_ip", data)
        self.assertTrue(data["auto_clipboard"])

    def test_settings_update(self):
        payload = json.dumps({"auto_clipboard": False})
        response = self.fetch("/api/system/info", method="POST", body=payload, headers={"Content-Type": "application/json"})
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertFalse(data["auto_clipboard"])

    def test_static_files(self):
        resp = self.fetch("/")
        self.assertEqual(resp.code, 200)
        self.assertIn("文件传输助手", resp.body.decode("utf-8"))

        manifest = self.fetch("/manifest.json")
        self.assertEqual(manifest.code, 200)

        icon = self.fetch("/icon.png")
        self.assertEqual(icon.code, 200)

    def test_upload_file(self):
        # Construct multipart/form-data manually
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        filename = "test_note.txt"
        file_content = b"LinkFlow test content line 1\nline 2"

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="sender"\r\n\r\n'
            f"pc\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
        ).encode("utf-8") + file_content + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        }

        response = self.fetch("/api/upload", method="POST", headers=headers, body=body)
        self.assertEqual(response.code, 200)
        res_data = json.loads(response.body)
        self.assertEqual(res_data["status"], "ok")
        self.assertEqual(res_data["message"]["file_name"], filename)
        self.assertEqual(res_data["message"]["file_size"], len(file_content))

        # Query messages
        msg_resp = self.fetch("/api/messages")
        self.assertEqual(msg_resp.code, 200)
        msg_data = json.loads(msg_resp.body)
        self.assertEqual(len(msg_data["messages"]), 1)
        self.assertEqual(msg_data["messages"][0]["file_name"], filename)

    def test_months_api(self):
        # Months endpoint should return ok and a list
        response = self.fetch("/api/months")
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertEqual(data["status"], "ok")
        self.assertIsInstance(data["months"], list)

        # Query messages with month parameter
        msg_resp = self.fetch("/api/messages?month=2026-09")
        self.assertEqual(msg_resp.code, 200)
        msg_data = json.loads(msg_resp.body)
        self.assertEqual(msg_data["status"], "ok")
        self.assertIsInstance(msg_data["messages"], list)

    @gen_test
    async def test_websocket_chat(self):
        ws_url = f"ws://localhost:{self.get_http_port()}/ws"
        conn = await websocket_connect(ws_url)

        # First message is welcome/connected
        welcome = await conn.read_message()
        welcome_data = json.loads(welcome)
        self.assertEqual(welcome_data["type"], "connected")

        # Send text message
        msg_payload = {
            "type": "text",
            "sender": "phone",
            "content": "Redmi K80 Pro 发送的局域网消息",
            "timestamp": 1700000000000
        }
        await conn.write_message(json.dumps(msg_payload))

        # Receive broadcasted message
        reply = await conn.read_message()
        reply_data = json.loads(reply)
        self.assertEqual(reply_data["type"], "new_message")
        self.assertEqual(reply_data["message"]["content"], "Redmi K80 Pro 发送的局域网消息")
        self.assertEqual(reply_data["message"]["sender"], "phone")

        conn.close()

    def test_copy_file_api(self):
        # 1. Non-existent id returns 404
        bad_resp = self.fetch("/api/system/copy-file", method="POST", headers={"Content-Type": "application/json"}, body=json.dumps({"id": "non-existent"}))
        self.assertEqual(bad_resp.code, 404)

        # 2. Upload a file then copy it
        boundary = "----WebKitFormBoundaryCopyTest"
        file_content = b"copy test content"
        filename = "copy_test.txt"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="sender"\r\n\r\n'
            f"pc\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
        ).encode("utf-8") + file_content + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        upload_resp = self.fetch("/api/upload", method="POST", headers=headers, body=body)
        self.assertEqual(upload_resp.code, 200)
        msg_id = json.loads(upload_resp.body)["message"]["id"]

        # Call copy-file endpoint
        copy_resp = self.fetch("/api/system/copy-file", method="POST", headers={"Content-Type": "application/json"}, body=json.dumps({"id": msg_id}))
        self.assertEqual(copy_resp.code, 200)
        copy_data = json.loads(copy_resp.body)
        self.assertEqual(copy_data["status"], "ok")
        self.assertEqual(copy_data["file_name"], filename)

if __name__ == "__main__":
    unittest.main()
