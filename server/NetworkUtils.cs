using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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
    public static List<string> GetLanIps()
    {
        var found = new List<(string Ip, bool HasGateway)>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;

                var props = nic.GetIPProperties();
                bool hasGateway = props.GatewayAddresses.Any(g =>
                    g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                foreach (var address in props.UnicastAddresses)
                {
                    if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string ip = address.Address.ToString();
                    if (IsPhysicalLanIp(ip) && !found.Any(f => f.Ip == ip)) found.Add((ip, hasGateway));
                }
            }
        }
        catch
        {
            // Fall through to the default below.
        }

        // Prefer the adapter that actually has a gateway (real Wi-Fi/Ethernet over virtual adapters),
        // then 192.168.* > 10.* > 172.16-31.*.
        var ips = found.OrderBy(f => f.HasGateway ? 0 : 1).ThenBy(f => Rank(f.Ip)).Select(f => f.Ip).ToList();
        if (ips.Count == 0) ips.Add("127.0.0.1");
        return ips;
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
