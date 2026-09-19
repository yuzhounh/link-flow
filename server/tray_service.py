import os
import sys
import time
import webbrowser
import logging
from typing import Optional, Callable

logger = logging.getLogger("LinkFlow.Tray")

try:
    from PyQt5 import QtWidgets, QtGui, QtCore
    HAS_PYQT = True
except ImportError:
    HAS_PYQT = False

class LinkFlowTray:
    def __init__(
        self,
        port: int,
        lan_ip: str,
        files_dir: str,
        icon_path: str,
        on_exit: Optional[Callable] = None
    ):
        self.port = port
        self.lan_ip = lan_ip
        self.files_dir = files_dir
        self.icon_path = icon_path
        self.on_exit = on_exit
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
                    "LinkFlow 私人传输",
                    f"手机连接地址已复制到剪贴板:\n{self.phone_url}",
                    QtWidgets.QSystemTrayIcon.Information,
                    2500
                )
        except Exception as e:
            logger.warning(f"Failed to copy phone URL: {e}")

    def open_files_folder(self):
        try:
            # Directly open the current month directory where latest files are stored
            month_str = time.strftime("%Y-%m")
            current_month_dir = os.path.join(self.files_dir, month_str)
            if not os.path.exists(current_month_dir):
                os.makedirs(current_month_dir, exist_ok=True)
            os.startfile(current_month_dir)
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

        self.tray.setToolTip(f"LinkFlow 私人文件传输助手 (端口: {self.port})")

        # Context Menu
        menu = QtWidgets.QMenu()
        menu.setStyleSheet("""
            QMenu {
                background-color: #ffffff;
                border: 1px solid #dcdcdc;
                padding: 4px 0px;
                font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
                font-size: 13px;
            }
            QMenu::item {
                padding: 6px 22px 6px 18px;
            }
            QMenu::item:selected {
                background-color: #e8f5fb;
                color: #24a1de;
            }
            QMenu::separator {
                height: 1px;
                background: #eeeeee;
                margin: 4px 8px;
            }
        """)

        act_open = menu.addAction("🚀 打开 LinkFlow")
        font = act_open.font()
        font.setBold(True)
        act_open.setFont(font)
        act_open.triggered.connect(self.open_web)

        act_copy = menu.addAction("📱 复制手机连接地址")
        act_copy.triggered.connect(self.copy_phone_url)

        act_folder = menu.addAction("📂 打开文件接收目录")
        act_folder.triggered.connect(self.open_files_folder)

        menu.addSeparator()

        act_exit = menu.addAction("❌ 退出 LinkFlow")
        act_exit.triggered.connect(self.quit)

        self.tray.setContextMenu(menu)

        def on_activated(reason):
            if reason in (QtWidgets.QSystemTrayIcon.Trigger, QtWidgets.QSystemTrayIcon.DoubleClick):
                self.open_web()

        self.tray.activated.connect(on_activated)
        self.tray.show()

        self.qapp.exec_()
