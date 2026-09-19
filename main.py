import os
import sys
import webbrowser
import logging
import tornado.ioloop
import tornado.httpserver

from server.app import create_app
from server.network_utils import get_lan_ip, get_all_lan_ips, find_available_port

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LinkFlow")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    static_dir = os.path.join(base_dir, "static")

    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    port = find_available_port(8000)
    lan_ip = get_lan_ip()
    all_ips = get_all_lan_ips()

    app = create_app(data_dir=data_dir, static_dir=static_dir, port=port)
    server = tornado.httpserver.HTTPServer(app, max_buffer_size=2 * 1024 * 1024 * 1024)
    server.listen(port, address="0.0.0.0")

    pc_url = f"http://localhost:{port}"
    phone_url = f"http://{lan_ip}:{port}"

    print("=" * 60)
    print("  LinkFlow - 私人文件传输助手 (双向局域网聊天传输)")
    print("=" * 60)
    print(f" [PC 电脑端本地地址] : {pc_url}")
    print(f" [手机端局域网地址]   : {phone_url}")
    if len(all_ips) > 1:
        print(" [其他可用局域网 IP] :")
        for ip in all_ips:
            if ip != lan_ip:
                print(f"   - http://{ip}:{port}")
    print("=" * 60)
    print(" 手机与电脑连接同一 Wi-Fi，用手机浏览器打开上述地址即可直接使用！")
    print(" 正在打开电脑端界面...")
    print("=" * 60)

    # Automatically open local browser on launch
    try:
        webbrowser.open(pc_url)
    except Exception as e:
        logger.warning(f"Failed to auto-launch browser: {e}")

    try:
        tornado.ioloop.IOLoop.current().start()
    except KeyboardInterrupt:
        print("\nLinkFlow 服务已停止。")

if __name__ == "__main__":
    main()
