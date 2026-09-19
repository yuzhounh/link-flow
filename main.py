import os
import sys

# Ensure UTF-8 and unbuffered output on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

import threading
import urllib.request
import webbrowser
import logging
import tornado.ioloop
import tornado.httpserver

from server.app import create_app
from server.network_utils import get_lan_ip, get_all_lan_ips, find_available_port
from server.tray_service import LinkFlowTray, HAS_PYQT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LinkFlow")

DEFAULT_PORT = 5837

def check_already_running(port: int = DEFAULT_PORT) -> bool:
    """Check if another LinkFlow instance is already running on port."""
    try:
        url = f"http://127.0.0.1:{port}/api/system/info"
        req = urllib.request.Request(url, headers={"User-Agent": "LinkFlow-Check"})
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            data = resp.read()
            if b"status" in data and b"auto_clipboard" in data:
                return True
    except Exception:
        pass
    return False

def main():
    # 1. Single-instance duplicate prevention
    if check_already_running(DEFAULT_PORT):
        print(f"LinkFlow 服务已在后台运行中 (端口 {DEFAULT_PORT})，正在为您唤醒浏览器界面...")
        try:
            webbrowser.open(f"http://localhost:{DEFAULT_PORT}")
        except Exception:
            pass
        return

    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    static_dir = os.path.join(base_dir, "static")

    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    port = find_available_port(DEFAULT_PORT)
    lan_ip = get_lan_ip()
    all_ips = get_all_lan_ips()

    app = create_app(data_dir=data_dir, static_dir=static_dir, port=port)
    server = tornado.httpserver.HTTPServer(app, max_buffer_size=2 * 1024 * 1024 * 1024)
    server.listen(port, address="0.0.0.0")

    pc_url = f"http://localhost:{port}"
    phone_url = f"http://{lan_ip}:{port}"

    print("=" * 60)
    print(f"  LinkFlow - 私人文件传输助手 (端口: {port})")
    print("=" * 60)
    print(f" [PC 电脑本地入口] : {pc_url}")
    print(f" [手机扫码访问入口] : {phone_url}")
    if len(all_ips) > 1:
        print(" [其他可用局域网 IP] :")
        for ip in all_ips:
            if ip != lan_ip:
                print(f"   - http://{ip}:{port}")
    print("=" * 60)
    print(" 手机（如 Redmi K80 Pro）与电脑连接同一 Wi-Fi，浏览器打开上述地址即可。")
    print(" 正在打开电脑端界面...")
    print("=" * 60)

    try:
        webbrowser.open(pc_url)
    except Exception as e:
        logger.warning(f"Failed to auto-launch browser: {e}")

    loop = tornado.ioloop.IOLoop.current()

    def stop_server():
        loop.add_callback(loop.stop)

    icon_path = os.path.join(static_dir, "icon.ico")
    if not os.path.exists(icon_path):
        icon_path = os.path.join(static_dir, "icon.png")

    files_dir = os.path.join(data_dir, "files")
    start_vbs_path = os.path.join(base_dir, "start.vbs")
    tray = LinkFlowTray(
        port=port,
        lan_ip=lan_ip,
        files_dir=files_dir,
        icon_path=icon_path,
        on_exit=stop_server,
        start_vbs_path=start_vbs_path
    )

    if HAS_PYQT:
        server_thread = threading.Thread(target=loop.start, name="TornadoServer", daemon=True)
        server_thread.start()
        print(" [系统托盘] 已常驻任务栏托盘 (右键唤出菜单，左键/双击打开主界面，支持一键退出)。")
        try:
            tray.run()
        except KeyboardInterrupt:
            pass
        finally:
            stop_server()
            print("\nLinkFlow 服务已停止。")
    else:
        try:
            loop.start()
        except KeyboardInterrupt:
            print("\nLinkFlow 服务已停止。")

if __name__ == "__main__":
    main()
