import os
import sys

base_dir = os.path.dirname(os.path.abspath(__file__))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

# Ensure UTF-8 and unbuffered output on Windows, handle pythonw None streams
if sys.platform == "win32":
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

import threading
import urllib.request
import urllib.parse
import webbrowser
import logging
import time
import tornado.ioloop
import tornado.httpserver

from server.app import create_app
from server.instance import SingleInstanceLock, read_runtime_info, remove_runtime_info, write_runtime_info
from server.logging_utils import configure_logging
from server.network_utils import get_lan_ip, get_all_lan_ips, find_available_port
from server.tray_service import LinkFlowTray, HAS_PYQT
from server.version import MAX_REQUEST_BYTES, VERSION

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


def activate_existing_instance(data_dir: str, fallback_port: int = DEFAULT_PORT):
    runtime = None
    for _ in range(10):
        runtime = read_runtime_info(data_dir)
        if runtime:
            break
        time.sleep(0.1)
    runtime_port = runtime["port"] if runtime else None
    port = runtime_port if runtime_port and check_already_running(runtime_port) else fallback_port
    logger.info("LinkFlow is already running on port %s; activating the browser", port)
    try:
        from server.window_utils import open_or_activate_linkflow
        open_or_activate_linkflow(port)
    except Exception as e:
        logger.warning("Failed to activate the existing LinkFlow window: %s", e)
        webbrowser.open(f"http://localhost:{port}")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    static_dir = os.path.join(base_dir, "static")

    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    runtime = read_runtime_info(data_dir)
    runtime_port = runtime["port"] if runtime else DEFAULT_PORT
    active_port = runtime_port if check_already_running(runtime_port) else None
    if active_port is None and runtime_port != DEFAULT_PORT and check_already_running(DEFAULT_PORT):
        active_port = DEFAULT_PORT
    if active_port is not None:
        activate_existing_instance(data_dir, active_port)
        return

    instance_lock = SingleInstanceLock()
    if not instance_lock.acquire():
        activate_existing_instance(data_dir)
        return

    log_path = configure_logging(data_dir)
    runtime_written = False
    server_thread = None
    try:
        port = find_available_port(DEFAULT_PORT)
        lan_ip = get_lan_ip()
        all_ips = get_all_lan_ips()

        app = create_app(data_dir=data_dir, static_dir=static_dir, port=port)
        server = tornado.httpserver.HTTPServer(app, max_buffer_size=MAX_REQUEST_BYTES)
        server.listen(port, address="0.0.0.0")
        write_runtime_info(data_dir, port, VERSION)
        runtime_written = True

        pc_url = f"http://localhost:{port}"
        pairing_token = app.settings["state"].pairing_token
        encoded_token = urllib.parse.quote(pairing_token, safe="")
        phone_url = f"http://{lan_ip}:{port}/?token={encoded_token}"

        print("=" * 60)
        print(f"  LinkFlow v{VERSION} - 私人文件传输助手 (端口: {port})")
        print("=" * 60)
        print(f" [PC 电脑本地入口] : {pc_url}")
        print(f" [手机扫码访问入口] : {phone_url}")
        if len(all_ips) > 1:
            print(" [其他可用局域网 IP] :")
            for ip in all_ips:
                if ip != lan_ip:
                    print(f"   - http://{ip}:{port}/?token={encoded_token}")
        print("=" * 60)
        print(" 手机（如 Redmi K80 Pro）与电脑连接同一 Wi-Fi，浏览器打开上述地址即可。")
        print(" 正在打开电脑端界面...")
        print("=" * 60)
        logger.info("LinkFlow v%s started on port %s", VERSION, port)

        loop = tornado.ioloop.IOLoop.current()

        def stop_server():
            def stop_on_loop():
                server.stop()
                loop.stop()
            loop.add_callback(stop_on_loop)

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
            start_vbs_path=start_vbs_path,
            pairing_token=pairing_token,
            log_path=log_path,
            data_dir=data_dir,
        )
        app.settings["state"].set_shutdown_callback(tray.request_quit if HAS_PYQT else stop_server)
        app.settings["state"].set_wake_callback(tray.request_wake)

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
                if server_thread:
                    server_thread.join(timeout=2)
                print("\nLinkFlow 服务已停止。")
        else:
            try:
                from server.window_utils import open_or_activate_linkflow
                open_or_activate_linkflow(port)
            except Exception as e:
                logger.warning(f"Failed to auto-launch browser: {e}")
            try:
                loop.start()
            except KeyboardInterrupt:
                stop_server()
                print("\nLinkFlow 服务已停止。")
    finally:
        if runtime_written:
            remove_runtime_info(data_dir, expected_pid=os.getpid())
        instance_lock.release()
        logger.info("LinkFlow stopped")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        logger.exception("LinkFlow crashed")
        log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "crash.log")
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "w", encoding="utf-8") as f:
            traceback.print_exc(file=f)
