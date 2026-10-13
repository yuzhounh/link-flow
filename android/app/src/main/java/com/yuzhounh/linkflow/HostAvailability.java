package com.yuzhounh.linkflow;

import android.content.Context;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Foreground-only passive listener. A signed fresh challenge gates each startup event. */
final class HostAvailability implements AutoCloseable {
    private volatile boolean closed;
    private DatagramSocket socket;
    private WifiManager.MulticastLock lock;
    private final String pairing;

    HostAvailability(Context context, String pairing, java.util.function.Consumer<String> available) {
        this.pairing = pairing;
        try {
            WifiManager wifi = (WifiManager)context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("LinkFlowAvailability");
                lock.setReferenceCounted(false); lock.acquire();
            }
        } catch (RuntimeException ignored) { /* Manual connection remains usable. */ }
        new Thread(() -> listen(available), "LinkFlowAvailability").start();
    }

    private void listen(java.util.function.Consumer<String> available) {
        try {
            Uri link = Uri.parse(pairing);
            byte[] key = link.getQueryParameter("token").getBytes(StandardCharsets.UTF_8);
            String hostId = hex(MessageDigest.getInstance("SHA-256").digest(key)).substring(0, 32);
            // Keep discovery within the original paired address. Address changes still require re-pairing.
            InetAddress expected = InetAddress.getByName(link.getHost());
            if (!(expected instanceof Inet4Address)) return;
            DatagramSocket receiver = new DatagramSocket(null);
            synchronized (this) {
                if (closed) { receiver.close(); return; }
                socket = receiver;
            }
            receiver.bind(new InetSocketAddress(5839));
            byte[] buffer = new byte[1025];
            String nonce = "", pendingBoot = "", deliveredBoot = "";
            long issued = 0;
            while (!closed) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                receiver.receive(packet); // Blocks until a packet or close(); no status polling.
                if (packet.getLength() > 1024 || !expected.equals(packet.getAddress())) continue;
                try {
                    JSONObject data = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                    if (!hostId.equals(data.optString("host"))) continue;
                    String boot = data.optString("boot");
                    if (!boot.matches("[a-f0-9]{32}") || boot.equals(deliveredBoot)) continue;
                    if ("lf-online-v1".equals(data.optString("type"))) {
                        if (!boot.equals(pendingBoot) || SystemClock.elapsedRealtime() - issued > 2000) {
                            byte[] random = new byte[16]; new SecureRandom().nextBytes(random);
                            nonce = hex(random); pendingBoot = boot; issued = SystemClock.elapsedRealtime();
                        }
                        JSONObject challenge = new JSONObject().put("type", "lf-challenge-v1").put("host", hostId).put("boot", boot).put("nonce", nonce);
                        byte[] bytes = challenge.toString().getBytes(StandardCharsets.UTF_8);
                        receiver.send(new DatagramPacket(bytes, bytes.length, expected, 5840));
                    } else if ("lf-ready-v1".equals(data.optString("type")) && !nonce.isEmpty()
                            && boot.equals(pendingBoot) && nonce.equals(data.optString("nonce"))
                            && SystemClock.elapsedRealtime() - issued <= 5000) {
                        int port = data.optInt("port", -1);
                        if (port <= 0 || port > 65535) continue;
                        String signature = data.optString("signature");
                        Mac hmac = Mac.getInstance("HmacSHA256"); hmac.init(new SecretKeySpec(key, "HmacSHA256"));
                        String content = "linkflow-ready-v1\n" + hostId + "\n" + boot + "\n" + nonce + "\n" + port;
                        byte[] signed = hex(hmac.doFinal(content.getBytes(StandardCharsets.UTF_8))).getBytes(StandardCharsets.US_ASCII);
                        if (!MessageDigest.isEqual(signed, signature.getBytes(StandardCharsets.US_ASCII))) continue;
                        deliveredBoot = boot;
                        String target = link.buildUpon().encodedAuthority(link.getHost() + ":" + port).path("/")
                            .clearQuery().appendQueryParameter("token", link.getQueryParameter("token")).fragment(null).build().toString();
                        if (!closed) available.accept(target);
                    }
                } catch (Exception ignored) { /* Ignore unrelated, malformed or unauthenticated LAN traffic. */ }
            }
        } catch (Exception ignored) { /* Unsupported network or occupied port: retain manual retry. */ }
        finally { close(); }
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte b : value) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }

    @Override public synchronized void close() {
        closed = true;
        if (socket != null) { socket.close(); socket = null; }
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
    }
}
