import os
import sys
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from server.window_utils import (
    get_visible_cabinet_hwnds,
    get_window_title,
    force_foreground_window,
    find_explorer_hwnd,
    reveal_in_explorer,
    open_folder_in_explorer,
)

class TestWindowUtils(unittest.TestCase):
    def test_imports_and_types(self):
        self.assertTrue(callable(get_visible_cabinet_hwnds))
        self.assertTrue(callable(get_window_title))
        self.assertTrue(callable(force_foreground_window))
        self.assertTrue(callable(find_explorer_hwnd))
        self.assertTrue(callable(reveal_in_explorer))
        self.assertTrue(callable(open_folder_in_explorer))

    def test_invalid_hwnd_handling(self):
        self.assertFalse(force_foreground_window(0))
        self.assertFalse(force_foreground_window(-1))
        self.assertEqual(get_window_title(0), "")

    def test_find_explorer_hwnd_nonexistent(self):
        hwnd = find_explorer_hwnd(r"C:\non_existent_folder_path_12345")
        # Should return an integer HWND (or 0) without raising exception
        self.assertIsInstance(hwnd, int)
