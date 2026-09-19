import os
import sys
import time
import winreg
import ctypes
from ctypes import wintypes
import webbrowser
import logging
from typing import Optional, Callable

logger = logging.getLogger("LinkFlow.Tray")

try:
    from PyQt5 import QtWidgets, QtGui, QtCore
    HAS_PYQT = True
except ImportError:
    HAS_PYQT = False

REG_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
REG_RUN_NAME = "LinkFlow"

def is_autostart_enabled() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_RUN_KEY, 0, winreg.KEY_READ) as key:
            winreg.QueryValueEx(key, REG_RUN_NAME)
            return True
    except Exception:
        return False

def set_autostart(enable: bool, start_vbs_path: str) -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enable:
                cmd = f'wscript.exe "{os.path.abspath(start_vbs_path)}"'
                winreg.SetValueEx(key, REG_RUN_NAME, 0, winreg.REG_SZ, cmd)
            else:
                try:
                    winreg.DeleteValue(key, REG_RUN_NAME)
                except FileNotFoundError:
                    pass
        return True
    except Exception as e:
        logger.warning(f"Failed to set autostart in registry: {e}")
        return False


if HAS_PYQT:
    class ModernTrayMenu(QtWidgets.QMenu):
        def __init__(self, parent=None):
            super().__init__(parent)
            self.autostart_act = None
            self.is_autostart_checked = False

        def paintEvent(self, event):
            super().paintEvent(event)
            if self.autostart_act and self.is_autostart_checked:
                geo = self.actionGeometry(self.autostart_act)
                if not geo.isEmpty():
                    painter = QtGui.QPainter(self)
                    painter.setRenderHint(QtGui.QPainter.Antialiasing)
                    painter.setPen(QtGui.QColor("#24A1DE"))
                    font = QtGui.QFont("Segoe UI Variable Text", -1)
                    font.setPixelSize(18)
                    font.setBold(True)
                    painter.setFont(font)
                    right_rect = QtCore.QRect(geo.right() - 42, geo.top(), 28, geo.height())
                    painter.drawText(right_rect, QtCore.Qt.AlignCenter, "✓")
                    painter.end()
else:
    ModernTrayMenu = object


class LinkFlowTray:
    def __init__(
        self,
        port: int,
        lan_ip: str,
        files_dir: str,
        icon_path: str,
        on_exit: Optional[Callable] = None,
        start_vbs_path: Optional[str] = None
    ):
        self.port = port
        self.lan_ip = lan_ip
        self.files_dir = files_dir
        self.icon_path = icon_path
        self.on_exit = on_exit
        
        if start_vbs_path:
            self.start_vbs_path = start_vbs_path
        else:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.start_vbs_path = os.path.join(base_dir, "start.vbs")

        self.pc_url = f"http://localhost:{port}"
        self.phone_url = f"http://{lan_ip}:{port}"
        self.qapp = None
        self.tray = None

    def open_web(self):
        try:
            webbrowser.open(self.pc_url)
        except Exception as e:
            logger.warning(f"Failed to open browser: {e}")

    def copy_phone_url(self):
        try:
            if self.qapp:
                self.qapp.clipboard().setText(self.phone_url)
            if self.tray:
                self.tray.showMessage(
                    "LinkFlow",
                    f"手机连接地址已复制到剪贴板:\n{self.phone_url}",
                    QtWidgets.QSystemTrayIcon.Information,
                    2500
                )
        except Exception as e:
            logger.warning(f"Failed to copy phone URL: {e}")

    def open_files_folder(self):
        try:
            from .window_utils import open_folder_in_explorer
            month_str = time.strftime("%Y-%m")
            current_month_dir = os.path.join(self.files_dir, month_str)
            open_folder_in_explorer(current_month_dir)
        except Exception as e:
            logger.warning(f"Failed to open folder: {e}")

    def quit(self):
        if self.tray:
            self.tray.hide()
        if self.on_exit:
            try:
                self.on_exit()
            except Exception:
                pass
        if self.qapp:
            self.qapp.quit()

    def run(self):
        if not HAS_PYQT:
            logger.warning("PyQt5 not installed; system tray disabled.")
            return

        self.qapp = QtWidgets.QApplication.instance()
        if not self.qapp:
            self.qapp = QtWidgets.QApplication(sys.argv)
        self.qapp.setQuitOnLastWindowClosed(False)

        self.tray = QtWidgets.QSystemTrayIcon()
        if os.path.exists(self.icon_path):
            self.tray.setIcon(QtGui.QIcon(self.icon_path))
        else:
            self.tray.setIcon(self.qapp.style().standardIcon(QtWidgets.QStyle.SP_ComputerIcon))

        self.tray.setToolTip(f"LinkFlow (端口: {self.port})")

        # Context Menu
        menu = ModernTrayMenu()
        menu.setWindowFlags(menu.windowFlags() | QtCore.Qt.FramelessWindowHint)
        menu.setAttribute(QtCore.Qt.WA_TranslucentBackground, True)

        # Style matching Windows 11 modern context menus (Screenshots 4 & 5, enlarged DSH style)
        menu.setStyleSheet("""
            QMenu {
                background-color: #ffffff;
                border: 1px solid #dce0e5;
                border-radius: 12px;
                padding: 8px 6px;
                font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif;
                font-size: 18px;
                color: #1f2328;
                min-width: 240px;
            }
            QMenu::item {
                padding: 11px 42px 11px 20px;
                border-radius: 8px;
                margin: 2px 4px;
            }
            QMenu::item:selected {
                background-color: #f2f4f7;
                color: #1f2328;
            }
            QMenu::separator {
                height: 1px;
                background-color: #eaedf1;
                margin: 6px 12px;
            }
        """)

        # 1. 打开 LinkFlow (Bold item)
        act_open = menu.addAction("打开 LinkFlow")
        font = act_open.font()
        font.setBold(True)
        act_open.setFont(font)
        act_open.triggered.connect(self.open_web)

        # 2. 复制手机连接地址
        act_copy = menu.addAction("复制手机连接地址")
        act_copy.triggered.connect(self.copy_phone_url)

        # 3. 打开文件接收目录
        act_folder = menu.addAction("打开文件接收目录")
        act_folder.triggered.connect(self.open_files_folder)

        menu.addSeparator()

        # 4. 开机自启动 (Clean right-side checkmark, strictly left-aligned)
        act_autostart = menu.addAction("开机自启动")
        menu.autostart_act = act_autostart
        menu.is_autostart_checked = is_autostart_enabled()

        def sync_autostart():
            menu.is_autostart_checked = is_autostart_enabled()
            menu.update()

        menu.aboutToShow.connect(sync_autostart)

        def on_toggle_autostart():
            menu.is_autostart_checked = not menu.is_autostart_checked
            set_autostart(menu.is_autostart_checked, self.start_vbs_path)
            menu.update()
            if self.tray:
                msg = "已开启开机自启动" if menu.is_autostart_checked else "已关闭开机自启动"
                self.tray.showMessage("LinkFlow", msg, QtWidgets.QSystemTrayIcon.Information, 2000)

        act_autostart.triggered.connect(on_toggle_autostart)

        menu.addSeparator()

        # 5. 退出
        act_exit = menu.addAction("退出")
        act_exit.triggered.connect(self.quit)

        self.tray.setContextMenu(menu)

        def on_activated(reason):
            if reason in (QtWidgets.QSystemTrayIcon.Trigger, QtWidgets.QSystemTrayIcon.DoubleClick):
                self.open_web()

        self.tray.activated.connect(on_activated)
        self.tray.show()

        self.qapp.exec_()
