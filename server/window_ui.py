import os
import sys
import json
import logging
from typing import Optional

logger = logging.getLogger("LinkFlow.WindowUI")

try:
    from PyQt5 import QtCore, QtGui, QtWidgets
    from PyQt5 import QtWebEngineWidgets
    HAS_WEBENGINE = True
except ImportError as e:
    logger.warning("PyQtWebEngine is not available: %s", e)
    HAS_WEBENGINE = False


if HAS_WEBENGINE:
    class LinkFlowWebPage(QtWebEngineWidgets.QWebEnginePage):
        """Custom WebEnginePage that opens external links in the default browser."""

        def acceptNavigationRequest(self, url: QtCore.QUrl, nav_type: int, is_main_frame: bool) -> bool:
            if nav_type == QtWebEngineWidgets.QWebEnginePage.NavigationTypeLinkClicked:
                url_str = url.toString()
                # Open external links in default OS browser
                if not (url_str.startswith("http://localhost") or url_str.startswith("http://127.0.0.1")):
                    QtGui.QDesktopServices.openUrl(url)
                    return False
            return super().acceptNavigationRequest(url, nav_type, is_main_frame)

        def createWindow(self, window_type: int):
            """Handle links targeting _blank or new windows by opening in external browser."""
            temp_page = LinkFlowWebPage(self.profile(), self)

            def on_url_changed(url: QtCore.QUrl):
                url_str = url.toString()
                if url_str and url_str != "about:blank":
                    if not (url_str.startswith("http://localhost") or url_str.startswith("http://127.0.0.1")):
                        QtGui.QDesktopServices.openUrl(url)
                    else:
                        # Internal link requested in new window, open in default browser
                        QtGui.QDesktopServices.openUrl(url)
                    temp_page.deleteLater()

            temp_page.urlChanged.connect(on_url_changed)
            return temp_page


    class LinkFlowMainWindow(QtWidgets.QMainWindow):
        """Standalone desktop window for LinkFlow with persistent size, position, and tray integration."""

        def __init__(self, port: int, icon_path: str, data_dir: str, tray=None):
            super().__init__()
            self.port = port
            self.icon_path = icon_path
            self.data_dir = os.path.abspath(data_dir)
            self.config_path = os.path.join(self.data_dir, "config.json")
            self.tray = tray

            self.setWindowTitle("LinkFlow - 文件传输助手")
            if os.path.isfile(self.icon_path):
                self.setWindowIcon(QtGui.QIcon(self.icon_path))

            self.setMinimumSize(380, 500)

            # WebEngine view setup
            self.view = QtWebEngineWidgets.QWebEngineView(self)
            self.page = LinkFlowWebPage(self.view)
            self.view.setPage(self.page)
            self.setCentralWidget(self.view)

            # Debounce timer for saving position and size
            self._save_timer = QtCore.QTimer(self)
            self._save_timer.setSingleShot(True)
            self._save_timer.setInterval(400)
            self._save_timer.timeout.connect(self.save_window_state)

            # Restore geometry from local config
            self.restore_window_state()

            # Load the local URL
            target_url = QtCore.QUrl(f"http://localhost:{self.port}")
            self.view.load(target_url)

        def restore_window_state(self):
            """Restore window geometry from config.json, checking screen boundaries."""
            restored = False
            try:
                if os.path.isfile(self.config_path):
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                    win_cfg = cfg.get("window", {})
                    
                    # 1. Try restoring via Qt native geometry hex string if available
                    geom_hex = win_cfg.get("geometry")
                    if geom_hex and isinstance(geom_hex, str):
                        geom_bytes = QtCore.QByteArray.fromHex(geom_hex.encode("ascii"))
                        if self.restoreGeometry(geom_bytes):
                            restored = True

                    # 2. Or fallback to explicit x, y, width, height
                    if not restored:
                        x = win_cfg.get("x")
                        y = win_cfg.get("y")
                        w = win_cfg.get("width")
                        h = win_cfg.get("height")
                        if x is not None and y is not None and w and h:
                            self.resize(max(w, 380), max(h, 500))
                            self.move(x, y)
                            restored = True

                    # Boundary safety validation: ensure title bar is within at least one visible screen
                    if restored:
                        cur_pos = self.pos()
                        title_rect = QtCore.QRect(cur_pos.x(), cur_pos.y(), min(self.width(), 120), 40)
                        intersects_screen = False
                        for screen in QtWidgets.QApplication.screens():
                            if screen.availableGeometry().intersects(title_rect):
                                intersects_screen = True
                                break
                        if not intersects_screen:
                            logger.info("Saved window position is outside visible screens; resetting to center.")
                            restored = False

                    if restored and win_cfg.get("maximized"):
                        self.showMaximized()
                        return
            except Exception as e:
                logger.warning("Failed to restore window state: %s", e)
                restored = False

            if not restored:
                # Default appearance: companion style (520x780), right-biased or centered on primary screen
                self.resize(520, 780)
                try:
                    primary = QtWidgets.QApplication.primaryScreen()
                    if primary:
                        screen_geom = primary.availableGeometry()
                        # Place towards the right side of the screen like a companion tool
                        target_x = screen_geom.x() + screen_geom.width() - 560
                        target_y = screen_geom.y() + (screen_geom.height() - 780) // 2
                        if target_x < screen_geom.x():
                            target_x = screen_geom.x() + (screen_geom.width() - 520) // 2
                        self.move(target_x, max(screen_geom.y() + 40, target_y))
                except Exception:
                    pass

        def save_window_state(self):
            """Save window position, size, and maximized status to config.json."""
            try:
                is_max = self.isMaximized()
                if is_max:
                    normal_geom = self.normalGeometry()
                    pos = normal_geom.topLeft()
                    size = normal_geom.size()
                else:
                    pos = self.pos()
                    size = self.size()

                geom_hex = self.saveGeometry().toHex().data().decode("ascii")

                win_data = {
                    "x": pos.x(),
                    "y": pos.y(),
                    "width": size.width(),
                    "height": size.height(),
                    "maximized": is_max,
                    "geometry": geom_hex,
                }

                cfg = {}
                if os.path.isfile(self.config_path):
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)

                cfg["window"] = win_data
                temp_path = f"{self.config_path}.tmp"
                with open(temp_path, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                os.replace(temp_path, self.config_path)
            except Exception as e:
                logger.warning("Failed to save window state: %s", e)

        def showEvent(self, event):
            super().showEvent(event)
            try:
                if os.path.isfile(self.config_path):
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                    if "window" not in cfg:
                        self.save_window_state()
                else:
                    self.save_window_state()
            except Exception:
                pass

        def moveEvent(self, event):
            if not self.isMaximized() and not self.isMinimized() and self.isVisible():
                self._save_timer.start()
            super().moveEvent(event)

        def resizeEvent(self, event):
            if not self.isMaximized() and not self.isMinimized() and self.isVisible():
                self._save_timer.start()
            super().resizeEvent(event)

        def changeEvent(self, event):
            if event.type() == QtCore.QEvent.WindowStateChange:
                self._save_timer.start()
            super().changeEvent(event)

        def closeEvent(self, event):
            """Intercept close button to hide to tray silently instead of quitting."""
            self.save_window_state()
            event.ignore()
            self.hide()

        @QtCore.pyqtSlot()
        def show_and_activate(self):
            """Show the window, restore if minimized, and bring to foreground."""
            if self.isMinimized():
                self.showNormal()
            else:
                self.show()

            self.raise_()
            self.activateWindow()

            # Bypass Windows foreground lock if needed
            try:
                hwnd = int(self.winId())
                if hwnd:
                    from .window_utils import force_foreground_window
                    force_foreground_window(hwnd)
            except Exception:
                pass
else:
    # Dummy class if PyQtWebEngine is missing
    class LinkFlowMainWindow:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("PyQtWebEngine is not installed.")
