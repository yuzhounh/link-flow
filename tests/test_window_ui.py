import os
import sys
import json
import tempfile
import unittest
from unittest import mock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.window_ui import LinkFlowMainWindow, HAS_WEBENGINE
from PyQt5 import QtCore, QtGui, QtWidgets


class TestWindowUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QtWidgets.QApplication.instance()
        if not cls.app:
            cls.app = QtWidgets.QApplication(sys.argv)

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = self.temp_dir.name
        self.config_path = os.path.join(self.data_dir, "config.json")
        # Prepopulate with pairing_token
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump({"pairing_token": "test_token_1234567890_abcdef12345"}, f)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_window_creation_and_config_preservation(self):
        if not HAS_WEBENGINE:
            self.skipTest("PyQtWebEngine is not available")

        win = LinkFlowMainWindow(
            port=5837,
            icon_path="",
            data_dir=self.data_dir,
        )
        self.assertIsNotNone(win)
        self.assertEqual(win.windowTitle(), "LinkFlow - 文件传输助手")

        # Set specific position and size
        win.resize(550, 750)
        win.move(100, 120)
        win.save_window_state()

        # Check config file
        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        self.assertEqual(cfg["pairing_token"], "test_token_1234567890_abcdef12345")
        self.assertIn("window", cfg)
        win_cfg = cfg["window"]
        self.assertEqual(win_cfg["width"], 550)
        self.assertEqual(win_cfg["height"], 750)
        self.assertEqual(win_cfg["x"], 100)
        self.assertEqual(win_cfg["y"], 120)
        self.assertFalse(win_cfg["maximized"])
        self.assertIn("geometry", win_cfg)

        win.hide()
        win.deleteLater()

    def test_window_restore_from_config(self):
        if not HAS_WEBENGINE:
            self.skipTest("PyQtWebEngine is not available")

        # Save specific window config first
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump({
                "pairing_token": "token_abc",
                "window": {
                    "x": 150,
                    "y": 180,
                    "width": 620,
                    "height": 820,
                    "maximized": False
                }
            }, f)

        win = LinkFlowMainWindow(
            port=5837,
            icon_path="",
            data_dir=self.data_dir,
        )
        self.assertEqual(win.width(), 620)
        self.assertEqual(win.height(), 820)
        self.assertEqual(win.x(), 150)
        self.assertEqual(win.y(), 180)

        win.hide()
        win.deleteLater()

    def test_window_close_event_hides_instead_of_destroying(self):
        if not HAS_WEBENGINE:
            self.skipTest("PyQtWebEngine is not available")

        mock_tray = mock.MagicMock()
        win = LinkFlowMainWindow(
            port=5837,
            icon_path="",
            data_dir=self.data_dir,
            tray=mock_tray,
        )
        win.show()
        self.assertTrue(win.isVisible())

        # Trigger close
        close_event = QtGui.QCloseEvent() if hasattr(QtCore, "QtGui") else mock.MagicMock()
        win.closeEvent(close_event)

        self.assertFalse(win.isVisible())
        mock_tray.showMessage.assert_called_once()

        win.deleteLater()


if __name__ == "__main__":
    unittest.main()
