import os
import sys
import unittest
from unittest import mock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.window_utils import (
    get_visible_cabinet_hwnds,
    get_window_title,
    force_foreground_window,
    find_explorer_hwnd,
    reveal_in_explorer,
    open_folder_in_explorer,
    select_in_open_explorer,
    activate_open_explorer_folder,
)
from server import window_utils

class TestWindowUtils(unittest.TestCase):
    def test_imports_and_types(self):
        self.assertTrue(callable(get_visible_cabinet_hwnds))
        self.assertTrue(callable(get_window_title))
        self.assertTrue(callable(force_foreground_window))
        self.assertTrue(callable(find_explorer_hwnd))
        self.assertTrue(callable(reveal_in_explorer))
        self.assertTrue(callable(open_folder_in_explorer))
        self.assertTrue(callable(select_in_open_explorer))
        self.assertTrue(callable(activate_open_explorer_folder))

    def test_invalid_hwnd_handling(self):
        self.assertFalse(force_foreground_window(0))
        self.assertFalse(force_foreground_window(-1))
        self.assertEqual(get_window_title(0), "")

    def test_find_explorer_hwnd_nonexistent(self):
        hwnd = find_explorer_hwnd(r"C:\non_existent_folder_path_12345")
        self.assertIsInstance(hwnd, int)

    def test_select_in_nonexistent_folder(self):
        hwnd = select_in_open_explorer(r"C:\non_existent_folder_xyz", "none.txt")
        self.assertIsNone(hwnd)

    def test_activate_nonexistent_folder(self):
        hwnd = activate_open_explorer_folder(r"C:\non_existent_folder_xyz")
        self.assertIsNone(hwnd)

    def test_open_linkflow_keeps_new_tab_when_existing_tab_is_hidden(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":"ok","has_client":true}'
        with mock.patch.object(window_utils, "activate_linkflow_window", side_effect=[False, False]), \
             mock.patch("urllib.request.urlopen", return_value=response), \
             mock.patch("webbrowser.open", return_value=True) as browser_open, \
             mock.patch("time.sleep"):
            self.assertTrue(window_utils.open_or_activate_linkflow(5837))
        browser_open.assert_called_once_with("http://localhost:5837")

    def test_open_linkflow_reuses_visible_window(self):
        with mock.patch.object(window_utils, "activate_linkflow_window", return_value=True), \
             mock.patch("urllib.request.urlopen") as urlopen, \
             mock.patch("webbrowser.open") as browser_open:
            self.assertTrue(window_utils.open_or_activate_linkflow(5837))
        urlopen.assert_not_called()
        browser_open.assert_not_called()
