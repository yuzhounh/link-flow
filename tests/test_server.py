import os
import sys
import json
import tempfile
import unittest
import urllib.parse
from tornado.testing import AsyncHTTPTestCase, gen_test
from tornado.websocket import websocket_connect
from tornado import gen

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
        self.assertEqual(data["version"], "0.2.1")
        self.assertIn("lan_ip", data)
        self.assertGreaterEqual(len(data["pairing_token"]), 32)
        self.assertEqual(data["max_upload_bytes"], 256 * 1024 * 1024)
        self.assertTrue(data["auto_clipboard"])

    def test_settings_update(self):
        payload = json.dumps({"auto_clipboard": False})
        response = self.fetch("/api/system/info", method="POST", body=payload, headers={"Content-Type": "application/json"})
        self.assertEqual(response.code, 200)
        data = json.loads(response.body)
        self.assertFalse(data["auto_clipboard"])

    def test_cross_origin_api_request_is_rejected(self):
        response = self.fetch(
            "/api/system/info",
            headers={"Origin": "https://example.invalid"},
        )
        self.assertEqual(response.code, 403)

    def test_shutdown_requires_registered_callback(self):
        response = self.fetch(
            "/api/system/shutdown",
            method="POST",
            headers={"Content-Type": "application/json"},
            body="{}",
        )
        self.assertEqual(response.code, 503)

    @gen_test
    async def test_shutdown_invokes_registered_callback(self):
        called = []
        self._app.settings["state"].set_shutdown_callback(lambda: called.append(True))
        response = await self.get_http_client().fetch(
            self.get_url("/api/system/shutdown"),
            method="POST",
            headers={"Content-Type": "application/json"},
            body="{}",
        )
        self.assertEqual(response.code, 200)
        await gen.sleep(0.1)
        self.assertEqual(called, [True])

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

    def test_upload_file_duplicate_naming(self):
        # Upload a file named README.MD, then upload it again to check collision handling
        boundary = "----WebKitFormBoundaryDupTest"
        filename = "README.MD"
        content_1 = b"# First Readme"
        content_2 = b"# Second Readme"

        def make_body(content):
            return (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="sender"\r\n\r\n'
                f"pc\r\n"
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: text/markdown\r\n\r\n"
            ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}

        # 1. First upload: must keep original name without timestamp
        res1 = self.fetch("/api/upload", method="POST", headers=headers, body=make_body(content_1))
        self.assertEqual(res1.code, 200)
        data1 = json.loads(res1.body)["message"]
        self.assertEqual(data1["file_name"], "README.MD")
        self.assertTrue(data1["file_path"].endswith("/README.MD"))

        # 2. Second upload: should append 13-digit timestamp, e.g. README-1789837483029.MD
        res2 = self.fetch("/api/upload", method="POST", headers=headers, body=make_body(content_2))
        self.assertEqual(res2.code, 200)
        data2 = json.loads(res2.body)["message"]
        import re
        self.assertTrue(re.match(r"^README-\d{13}\.MD$", data2["file_name"]), f"Expected timestamp suffix, got {data2['file_name']}")
        self.assertTrue(data2["file_path"].endswith(f"/{data2['file_name']}"))

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

    def test_clear_all_removes_records_and_physical_files(self):
        boundary = "----WebKitFormBoundaryClearTest"
        filename = "clear_me.txt"
        file_content = b"clear all should remove this file"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
        ).encode("utf-8") + file_content + f"\r\n--{boundary}--\r\n".encode("utf-8")
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}

        upload = self.fetch("/api/upload", method="POST", headers=headers, body=body)
        self.assertEqual(upload.code, 200)
        record = json.loads(upload.body)["message"]
        full_path = os.path.join(self.temp_dir.name, "data", "files", record["file_path"])
        self.assertTrue(os.path.isfile(full_path))

        cleared = self.fetch("/api/messages", method="DELETE")
        self.assertEqual(cleared.code, 200)
        self.assertEqual(json.loads(cleared.body)["cleared_count"], 1)
        self.assertFalse(os.path.exists(full_path))
        remaining = json.loads(self.fetch("/api/messages").body)["messages"]
        self.assertEqual(remaining, [])

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
        # Sender identity is derived from the connection, not trusted client input.
        self.assertEqual(reply_data["message"]["sender"], "pc")

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

    def test_system_wake_callback(self):
        # 1. Wake without callback
        resp = self.fetch("/api/system/wake", method="POST", headers={"Content-Type": "application/json"}, body="{}")
        self.assertEqual(resp.code, 200)
        data = json.loads(resp.body)
        self.assertFalse(data.get("window_activated"))

        # 2. Wake with callback
        called = False
        def on_wake():
            nonlocal called
            called = True

        self._app.settings["state"].set_wake_callback(on_wake)
        resp2 = self.fetch("/api/system/wake", method="POST", headers={"Content-Type": "application/json"}, body="{}")
        self.assertEqual(resp2.code, 200)
        data2 = json.loads(resp2.body)
        self.assertTrue(data2.get("window_activated"))
        self.assertTrue(called)


if __name__ == "__main__":
    unittest.main()
