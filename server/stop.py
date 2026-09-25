import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from server.instance import read_runtime_info, runtime_path


def stop_linkflow(data_dir: str = None) -> bool:
    data_dir = data_dir or os.path.join(BASE_DIR, "data")
    runtime = read_runtime_info(data_dir)
    if not runtime:
        print("未检测到可验证的 LinkFlow 运行实例。")
        return False

    port = runtime["port"]
    url = f"http://127.0.0.1:{port}/api/system/shutdown"
    request = urllib.request.Request(
        url,
        data=b"{}",
        headers={"Content-Type": "application/json", "User-Agent": "LinkFlow-Stop"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("status") != "ok":
            print("LinkFlow 拒绝了停止请求。")
            return False
    except (OSError, ValueError, urllib.error.URLError) as e:
        print(f"无法安全停止 LinkFlow：{e}")
        print("未强制结束任何进程，以免影响其他本地服务。")
        return False

    deadline = time.monotonic() + 5
    path = runtime_path(data_dir)
    while time.monotonic() < deadline:
        if not os.path.exists(path):
            print(f"LinkFlow 已安全停止 (PID: {runtime['pid']})。")
            return True
        time.sleep(0.1)

    print("停止请求已发送，LinkFlow 仍在完成退出流程。")
    return True

if __name__ == "__main__":
    raise SystemExit(0 if stop_linkflow() else 1)
