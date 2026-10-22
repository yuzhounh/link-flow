using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace LinkFlow;

internal static class NetworkHelper
{
    private static readonly object WifiLock = new();
    private static string? _wifiName;
    private static string? _wifiForIp;
    private static DateTime _wifiCheckedUtc = DateTime.MinValue;

    // Name of the Wi-Fi network that the given LAN address belongs to; null when the address is on a wired
    // adapter or the name cannot be read. The answer is cached for a minute (it spawns netsh).
    public static string? GetWifiName(string lanIp)
    {
        lock (WifiLock)
        {
            if (_wifiForIp == lanIp && DateTime.UtcNow - _wifiCheckedUtc < TimeSpan.FromSeconds(60)) return _wifiName;
            _wifiForIp = lanIp;
            _wifiCheckedUtc = DateTime.UtcNow;
            _wifiName = ReadWifiName(lanIp);
            return _wifiName;
        }
    }

    private static string? ReadWifiName(string lanIp)
    {
        try
        {
            var nic = NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n =>
                n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 &&
                n.GetIPProperties().UnicastAddresses.Any(a => a.Address.ToString() == lanIp));
            if (nic == null) return null;
            using var process = Process.Start(new ProcessStartInfo("netsh", "wlan show interfaces")
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true
            });
            if (process == null) return null;
            var reading = process.StandardOutput.ReadToEndAsync();
            if (!process.WaitForExit(2000))
            {
                try { process.Kill(); } catch { /* already gone */ }
                return null;
            }
            string? current = null;
            foreach (string line in reading.Result.Split('\n'))
            {
                int colon = line.IndexOf(':');
                if (colon <= 0) continue;
                string key = line[..colon].Trim(), value = line[(colon + 1)..].Trim();
                if (key is "Name" or "名称") current = value;
                else if (key == "SSID" && current == nic.Name) return value.Length > 0 ? value : null;
            }
        }
        catch
        {
            // No wireless adapter, or netsh is unavailable.
        }
        return null;
    }

    public static List<string> GetLanIps()
    {
        var found = new List<(string Ip, bool HasGateway, bool Virtual)>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;

                bool isVirtual = IsVirtualAdapter(nic);
                var props = nic.GetIPProperties();
                bool hasGateway = props.GatewayAddresses.Any(g =>
                    g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                foreach (var address in props.UnicastAddresses)
                {
                    if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string ip = address.Address.ToString();
                    if (IsPhysicalLanIp(ip) && !found.Any(f => f.Ip == ip)) found.Add((ip, hasGateway, isVirtual));
                }
            }
        }
        catch
        {
            // Fall through to the default below.
        }

        // Prefer the adapter that actually has a gateway (real Wi-Fi/Ethernet over virtual adapters),
        // then 192.168.* > 10.* > 172.16-31.*.
        // Virtual adapters (VPN, tunnels, virtual machines) are hidden: a phone cannot use them. They are only
        // kept when nothing else is available, so the list is never empty.
        var usable = found.Where(f => !f.Virtual).ToList();
        if (usable.Count == 0) usable = found;
        var ips = usable.OrderBy(f => f.HasGateway ? 0 : 1).ThenBy(f => Rank(f.Ip)).Select(f => f.Ip).ToList();
        if (ips.Count == 0) ips.Add("127.0.0.1");
        return ips;
    }

    private static readonly string[] VirtualAdapterMarkers =
    {
        "tunnel", "wintun", "tap-", "vpn", "virtual", "vmware", "vmnet", "hyper-v", "vethernet", "wsl",
        "zerotier", "tailscale", "wireguard", "easytier", "clash"
    };

    // The adapter name and description reveal tunnels and virtual switches (for example "AICompute Tunnel").
    private static bool IsVirtualAdapter(NetworkInterface nic)
    {
        string text = (nic.Name + " " + nic.Description).ToLowerInvariant();
        foreach (string marker in VirtualAdapterMarkers)
            if (text.Contains(marker, StringComparison.Ordinal)) return true;
        return false;
    }

    private static bool IsPhysicalLanIp(string ip) =>
        !string.IsNullOrEmpty(ip) && !ip.StartsWith("127.", StringComparison.Ordinal) &&
        !ip.StartsWith("169.254.", StringComparison.Ordinal) &&
        !ip.StartsWith("198.18.", StringComparison.Ordinal) && !ip.StartsWith("198.19.", StringComparison.Ordinal);

    private static int Rank(string ip)
    {
        if (ip.StartsWith("192.168.", StringComparison.Ordinal)) return 0;
        if (ip.StartsWith("10.", StringComparison.Ordinal)) return 1;
        if (ip.StartsWith("172.", StringComparison.Ordinal))
        {
            string[] parts = ip.Split('.');
            if (parts.Length > 1 && int.TryParse(parts[1], out int second) && second >= 16 && second <= 31) return 2;
        }
        return 3;
    }

    public static int FindFreePort(int start)
    {
        for (int port = start; port < start + 50; port++)
        {
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                socket.ExclusiveAddressUse = true;
                socket.Bind(new IPEndPoint(IPAddress.Any, port));
                return port;
            }
            catch (SocketException)
            {
                // Port in use; try the next one.
            }
        }
        return start;
    }
}
