import socket
import subprocess
import re
from typing import List, Tuple

def get_lan_ip() -> str:
    """
    Detect the most appropriate LAN IPv4 address for local network access
    (e.g., 192.168.x.x, 10.x.x.x, 172.16-31.x.x).
    Falls back to 127.0.0.1 if no active network is found.
    """
    candidates: List[str] = []
    
    # Method 1: Try connecting a dummy UDP socket to a public DNS IP (doesn't send packets)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
            return ip
    except Exception:
        pass

    # Method 2: Inspect host by name
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                # Prioritize typical local ranges
                if ip.startswith("192.168."):
                    return ip
                candidates.append(ip)
    except Exception:
        pass

    if candidates:
        return candidates[0]
    return "127.0.0.1"

def get_all_lan_ips() -> List[str]:
    """Get all non-loopback IPv4 addresses."""
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127.") and not ip.startswith("169.254."):
                ips.append(ip)
    except Exception:
        pass
    if not ips:
        ips.append("127.0.0.1")
    return ips

def find_available_port(start_port: int = 8000, max_attempts: int = 50) -> int:
    """Find an available TCP port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    return start_port
