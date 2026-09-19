import socket
from typing import List

def is_valid_physical_lan_ip(ip: str) -> bool:
    """Check if IP belongs to real physical LAN and not virtual/TUN adapter."""
    if not ip or ip.startswith("127.") or ip.startswith("169.254."):
        return False
    # Filter out Clash / Proxy TUN adapter ranges
    if ip.startswith("198.18.") or ip.startswith("198.19."):
        return False
    return True

def get_lan_ip() -> str:
    """
    Detect the most appropriate LAN IPv4 address for local network access
    (prioritizing 192.168.x.x, 10.x.x.x, 172.16-31.x.x).
    """
    all_ips = get_all_lan_ips()
    if not all_ips:
        return "127.0.0.1"

    # Prioritize 192.168.x.x (standard home Wi-Fi)
    for ip in all_ips:
        if ip.startswith("192.168."):
            return ip

    # Next prioritize 10.x.x.x
    for ip in all_ips:
        if ip.startswith("10."):
            return ip

    # Next prioritize 172.16-31.x.x
    for ip in all_ips:
        if ip.startswith("172."):
            try:
                second = int(ip.split(".")[1])
                if 16 <= second <= 31:
                    return ip
            except Exception:
                pass

    return all_ips[0]

def get_all_lan_ips() -> List[str]:
    """Get all non-loopback, non-virtual IPv4 addresses sorted by priority."""
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if is_valid_physical_lan_ip(ip) and ip not in ips:
                ips.append(ip)
    except Exception:
        pass

    # Method 2: Try UDP connect to gateway or public DNS if empty
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.5)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            if is_valid_physical_lan_ip(ip) and ip not in ips:
                ips.append(ip)
        except Exception:
            pass

    if not ips:
        ips.append("127.0.0.1")

    # Sort: 192.168.* first, then 10.*, then 172.*, then others
    def sort_key(ip_addr: str) -> int:
        if ip_addr.startswith("192.168."):
            return 0
        if ip_addr.startswith("10."):
            return 1
        if ip_addr.startswith("172."):
            return 2
        return 3

    ips.sort(key=sort_key)
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
