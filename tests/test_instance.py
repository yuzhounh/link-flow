import logging
import os
import sys
import tempfile
import unittest
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.instance import (
    SingleInstanceLock,
    read_runtime_info,
    remove_runtime_info,
    runtime_path,
    write_runtime_info,
)
from server.logging_utils import configure_logging
from server.stop import stop_linkflow


class TestInstanceLifecycle(unittest.TestCase):
    def test_runtime_info_roundtrip_and_guarded_removal(self):
        with tempfile.TemporaryDirectory() as data_dir:
            path = write_runtime_info(data_dir, 5838, "0.2.1")
            payload = read_runtime_info(data_dir)
            self.assertEqual(payload["pid"], os.getpid())
            self.assertEqual(payload["port"], 5838)
            self.assertEqual(payload["version"], "0.2.1")
            self.assertEqual(path, runtime_path(data_dir))

            self.assertFalse(remove_runtime_info(data_dir, expected_pid=os.getpid() + 1))
            self.assertTrue(os.path.exists(path))
            self.assertTrue(remove_runtime_info(data_dir, expected_pid=os.getpid()))
            self.assertFalse(os.path.exists(path))

    @unittest.skipUnless(sys.platform == "win32", "Windows named mutex test")
    def test_named_mutex_allows_only_one_holder(self):
        name = rf"Local\LinkFlow.Test.{uuid.uuid4()}"
        first = SingleInstanceLock(name)
        second = SingleInstanceLock(name)
        third = SingleInstanceLock(name)
        try:
            self.assertTrue(first.acquire())
            self.assertFalse(second.acquire())
            first.release()
            self.assertTrue(third.acquire())
        finally:
            first.release()
            second.release()
            third.release()

    def test_persistent_log_is_written(self):
        with tempfile.TemporaryDirectory() as data_dir:
            path = configure_logging(data_dir)
            logging.getLogger("LinkFlow.Test").info("persistent-log-check")
            for handler in logging.getLogger().handlers:
                if getattr(handler, "_linkflow_managed", False):
                    handler.flush()
            with open(path, "r", encoding="utf-8") as stream:
                self.assertIn("persistent-log-check", stream.read())
            self._close_managed_handlers()

    def test_stop_without_runtime_never_kills_by_port(self):
        with tempfile.TemporaryDirectory() as data_dir:
            self.assertFalse(stop_linkflow(data_dir))

    @staticmethod
    def _close_managed_handlers():
        root = logging.getLogger()
        for handler in list(root.handlers):
            if getattr(handler, "_linkflow_managed", False):
                root.removeHandler(handler)
                handler.close()

    def tearDown(self):
        self._close_managed_handlers()


if __name__ == "__main__":
    unittest.main()
