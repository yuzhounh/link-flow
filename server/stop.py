import os
import sys
import subprocess
import re

def stop_linkflow():
    print("正在查找正在运行的 LinkFlow 服务...")
    killed = 0
    # Find processes by listening port (default 8000 and 8001)
    try:
        output = subprocess.check_output("netstat -ano", shell=True, text=True)
        pids = set()
        target_ports = [":5837 ", ":8000 ", ":8001 ", ":8002 "]
        for line in output.splitlines():
            if any(p in line for p in target_ports):
                parts = line.strip().split()
                if len(parts) >= 5 and parts[3] == "LISTENING":
                    pids.add(parts[-1])
        
        for pid in pids:
            if pid != "0" and pid != str(os.getpid()):
                res = subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True, text=True)
                if res.returncode == 0:
                    print(f"成功终止 LinkFlow 进程 (PID: {pid})")
                    killed += 1
    except Exception as e:
        print("停止服务时出错:", e)

    if killed == 0:
        print("未检测到运行中的 LinkFlow 服务进程。")
    else:
        print(f"已停止 {killed} 个 LinkFlow 服务。")

if __name__ == "__main__":
    stop_linkflow()
