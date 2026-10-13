using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace LinkFlow;

/// <summary>Finite startup announcements and authenticated replies; no periodic availability polling.</summary>
internal sealed class HostDiscovery : IDisposable
{
    internal const int PcPort = 5840, PhonePort = 5839;
    private readonly UdpClient _socket;
    private readonly CancellationTokenSource _stop = new();
    private readonly byte[] _key;
    private readonly string _hostId, _bootId = Guid.NewGuid().ToString("N");
    private readonly int _httpPort;
    private readonly HashSet<string> _addresses;

    public HostDiscovery(string token, int httpPort, IEnumerable<string> addresses)
    {
        _key = Encoding.UTF8.GetBytes(token);
        _hostId = Convert.ToHexString(SHA256.HashData(_key)).ToLowerInvariant().Substring(0, 32);
        _httpPort = httpPort;
        _addresses = new HashSet<string>(addresses);
        _socket = new UdpClient(new IPEndPoint(IPAddress.Any, PcPort));
    }

    public void Start()
    {
        _ = ReceiveAsync();
        _ = AnnounceStartupAsync();
    }

    private byte[] Announcement() => JsonSerializer.SerializeToUtf8Bytes(new { type = "lf-online-v1", host = _hostId, boot = _bootId });

    // Also used by the emulator fixture, which forwards UDP instead of joining physical Wi-Fi.
    public void AnnounceTo(IPEndPoint endpoint) => _socket.Send(Announcement(), endpoint);

    private async Task AnnounceStartupAsync()
    {
        try {
            for (int attempt = 0; attempt < 3; attempt++) {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces()) {
                    if (_stop.IsCancellationRequested) return;
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    foreach (var address in nic.GetIPProperties().UnicastAddresses) {
                        if (address.Address.AddressFamily != AddressFamily.InterNetwork || !_addresses.Contains(address.Address.ToString())) continue;
                        byte[] ip = address.Address.GetAddressBytes(), mask = address.IPv4Mask.GetAddressBytes();
                        byte[] broadcast = ip.Select((b, i) => (byte)(b | ~mask[i])).ToArray();
                        try {
                            using var sender = new UdpClient(new IPEndPoint(address.Address, 0)) { EnableBroadcast = true };
                            await sender.SendAsync(Announcement(), new IPEndPoint(new IPAddress(broadcast), PhonePort), _stop.Token);
                        } catch (SocketException) { /* Other adapters and manual connection remain available. */ }
                    }
                }
                if (attempt < 2) await Task.Delay(attempt == 0 ? 300 : 1000, _stop.Token);
            }
        } catch (OperationCanceledException) { }
        catch (Exception error) { AppLog.Warn("LinkFlow.Discovery", "Startup announcement unavailable", error); }
    }

    private async Task ReceiveAsync()
    {
        try {
            while (!_stop.IsCancellationRequested) {
                var request = await _socket.ReceiveAsync(_stop.Token);
                if (request.Buffer.Length > 1024) continue;
                try {
                    using var document = JsonDocument.Parse(request.Buffer);
                    var data = document.RootElement;
                    if (data.GetProperty("type").GetString() != "lf-challenge-v1" ||
                        data.GetProperty("host").GetString() != _hostId || data.GetProperty("boot").GetString() != _bootId) continue;
                    string? nonce = data.GetProperty("nonce").GetString();
                    if (nonce == null || nonce.Length != 32 || !nonce.All(Uri.IsHexDigit)) continue;
                    string content = $"linkflow-ready-v1\n{_hostId}\n{_bootId}\n{nonce}\n{_httpPort}";
                    string signature = Convert.ToHexString(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(content))).ToLowerInvariant();
                    var proof = JsonSerializer.SerializeToUtf8Bytes(new {
                        type = "lf-ready-v1", host = _hostId, boot = _bootId, nonce, port = _httpPort, signature,
                    });
                    await _socket.SendAsync(proof, request.RemoteEndPoint, _stop.Token);
                } catch (JsonException) { }
                catch (KeyNotFoundException) { }
                catch (InvalidOperationException) { }
            }
        } catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (Exception error) { if (!_stop.IsCancellationRequested) AppLog.Warn("LinkFlow.Discovery", "Availability listener stopped", error); }
    }

    public void Dispose() { _stop.Cancel(); _socket.Dispose(); }
}
