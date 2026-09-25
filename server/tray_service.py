import os
import sys
import time
import winreg
import ctypes
from ctypes import wintypes
import webbrowser
import urllib.parse
import logging
from typing import Optional, Callable

from .version import VERSION

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
    class MARGINS(ctypes.Structure):
        _fields_ = [
            ("cxLeftWidth", ctypes.c_int),
            ("cxRightWidth", ctypes.c_int),
            ("cyTopHeight", ctypes.c_int),
            ("cyBottomHeight", ctypes.c_int),
        ]

    class ModernTrayMenu(QtWidgets.QMenu):
        def __init__(self, parent=None):
            super().__init__(parent)
            self.autostart_act = None
            self.is_autostart_checked = False

        def showEvent(self, event):
            super().showEvent(event)
            try:
                hwnd = int(self.winId())
                user32 = ctypes.windll.user32
                dwmapi = ctypes.windll.dwmapi

                # 1. Enable WS_THICKFRAME to activate modern Windows DWM system shadow
                GWL_STYLE = -16
                WS_THICKFRAME = 0x00040000
                style = user32.GetWindowLongW(hwnd, GWL_STYLE)
                user32.SetWindowLongW(hwnd, GWL_STYLE, style | WS_THICKFRAME)

                # 2. Extend frame into client area for DWM shadow
                margins = MARGINS(1, 1, 1, 1)
                dwmapi.DwmExtendFrameIntoClientArea(hwnd, ctypes.byref(margins))

                # 3. Windows 11 DWM native rounded corners (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2)
                val = ctypes.c_int(2)
                dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(val), ctypes.sizeof(val))

                # 4. Windows 11 DWM border color (#dce0e5 -> 0x00E5E0DC)
                color = ctypes.c_int(0x00E5E0DC)
                dwmapi.DwmSetWindowAttribute(hwnd, 34, ctypes.byref(color), ctypes.sizeof(color))

                # 5. CS_DROPSHADOW fallback
                try:
                    CS_DROPSHADOW = 0x00020000
                    GCL_STYLE = -26
                    cstyle = user32.GetClassLongW(hwnd, GCL_STYLE)
                    user32.SetClassLongW(hwnd, GCL_STYLE, cstyle | CS_DROPSHADOW)
                except Exception:
                    pass

                user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0020 | 0x0040)
            except Exception:
                pass

        def nativeEvent(self, eventType, message):
            if eventType in (b"windows_generic_MSG", "windows_generic_MSG"):
                msg = wintypes.MSG.from_address(message.__int__())
                if msg.message == 0x0083:  # WM_NCCALCSIZE
                    if msg.wParam:
                        return True, 0
            return super().nativeEvent(eventType, message)

        def paintEvent(self, event):
            super().paintEvent(event)
            if self.autostart_act and self.is_autostart_checked:
                geo = self.actionGeometry(self.autostart_act)
                if not geo.isEmpty():
                    painter = QtGui.QPainter(self)
                    painter.setRenderHint(QtGui.QPainter.Antialiasing)
                    painter.setPen(QtGui.QColor("#24A1DE"))
                    font = QtGui.QFont("Segoe UI Variable Text", -1)
                    font.setPixelSize(20)
                    font.setBold(True)
                    painter.setFont(font)
                    right_rect = QtCore.QRect(geo.right() - 46, geo.top(), 28, geo.height())
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
        start_vbs_path: Optional[str] = None,
        pairing_token: str = "",
        log_path: Optional[str] = None,
    ):
        self.port = port
        self.lan_ip = lan_ip
        self.files_dir = files_dir
        self.icon_path = icon_path
        self.on_exit = on_exit
        self.log_path = log_path
        
        if start_vbs_path:
            self.start_vbs_path = start_vbs_path
        else:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.start_vbs_path = os.path.join(base_dir, "start.vbs")

        self.pc_url = f"http://localhost:{port}"
        encoded_token = urllib.parse.quote(pairing_token, safe="")
        token_query = f"?token={encoded_token}" if encoded_token else ""
        self.phone_url = f"http://{lan_ip}:{port}/{token_query}"
        self.qapp = None
        self.tray = None

    def open_web(self):
        try:
            from .window_utils import open_or_activate_linkflow
            open_or_activate_linkflow(self.port)
        except Exception as e:
            logger.warning(f"Failed to activate/open browser: {e}")
            try:
                webbrowser.open(self.pc_url)
            except Exception:
                pass

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

    def open_log(self):
        try:
            if not self.log_path or not os.path.isfile(self.log_path):
                raise FileNotFoundError("LinkFlow log file is not available")
            os.startfile(self.log_path)
        except Exception as e:
            logger.warning(f"Failed to open log file: {e}")
            if self.tray:
                self.tray.showMessage(
                    "LinkFlow",
                    "暂时无法打开运行日志。",
                    QtWidgets.QSystemTrayIcon.Warning,
                    2500,
                )

    def request_quit(self):
        """Request QApplication shutdown safely from the Tornado server thread."""
        if HAS_PYQT and self.qapp:
            QtCore.QMetaObject.invokeMethod(self.qapp, "quit", QtCore.Qt.QueuedConnection)
        elif self.on_exit:
            self.on_exit()

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

        self.tray.setToolTip(f"LinkFlow v{VERSION} (端口: {self.port})")

        # Context Menu
        menu = ModernTrayMenu()
        menu.setWindowFlags(menu.windowFlags() | QtCore.Qt.FramelessWindowHint)

        # Style matching Windows 11 modern context menus with font size 20 and system drop shadow
        menu.setStyleSheet("""
            QMenu {
                background-color: #ffffff;
                border: 1px solid #dce0e5;
                border-radius: 8px;
                padding: 8px 6px;
                font-family: "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif;
                font-size: 20px;
                color: #1f2328;
                min-width: 260px;
            }
            QMenu::item {
                padding: 12px 48px 12px 22px;
                border-radius: 6px;
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

        act_log = menu.addAction("查看运行日志")
        act_log.triggered.connect(self.open_log)

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
