package com.yuzhounh.linkflow;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** One cancellable authenticated request. The caller owns the overall deadline. */
final class HostProbe {
    static final int OK = 200, UNPAIRED = 401;
    static final class Result {
        final int status;
        final String body;
        Result(int status, String body) { this.status = status; this.body = body; }
    }
    private volatile boolean cancelled;
    private HttpURLConnection connection;

    void cancel() {
        HttpURLConnection active;
        synchronized (this) { cancelled = true; active = connection; }
        // Disconnect may wait on a socket read; never delay the UI's overall deadline.
        if (active != null) new Thread(active::disconnect, "LinkFlowCancel").start();
    }

    Result run(String endpoint, String token) {
        HttpURLConnection request = null;
        try {
            request = (HttpURLConnection)new URL(endpoint).openConnection();
            request.setConnectTimeout(2000); request.setReadTimeout(2000);
            request.setInstanceFollowRedirects(false);
            request.setUseCaches(false);
            request.setRequestProperty("X-LinkFlow-Token", token);
            synchronized (this) {
                if (cancelled) return new Result(0, "");
                connection = request;
            }
            int status = request.getResponseCode();
            if (status != OK) return new Result(status, "");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = request.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while (!cancelled && (count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 262144) return new Result(0, "");
                    bytes.write(buffer, 0, count);
                }
            }
            return cancelled ? new Result(0, "") : new Result(status, bytes.toString(StandardCharsets.UTF_8.name()));
        } catch (Exception error) {
            return new Result(0, "");
        } finally {
            synchronized (this) { connection = null; }
            if (request != null) request.disconnect();
        }
    }
}
