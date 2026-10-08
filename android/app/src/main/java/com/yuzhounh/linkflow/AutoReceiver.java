package com.yuzhounh.linkflow;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import org.json.*;
import java.net.HttpURLConnection;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Persistent catch-up cursor; Android DownloadManager owns transfers, including in background. */
final class AutoReceiver {
    private final Activity activity;
    private final FileDownloads downloads;
    private final SharedPreferences prefs;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean requested = new AtomicBoolean();
    private volatile boolean closed;
    private volatile String pairing = "", agent = "";
    AutoReceiver(Activity activity, FileDownloads downloads) {
        this.activity = activity; this.downloads = downloads;
        prefs = activity.getSharedPreferences("receive-cursors", Activity.MODE_PRIVATE);
    }
    void refresh(String link, String userAgent) {
        if (closed || link.isEmpty()) return;
        pairing = link; agent = userAgent; requested.set(true);
        if (!running.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                while (!closed && requested.getAndSet(false)) {
                    try { catchUp(pairing, agent); } catch (Exception ignored) { /* Next reconnect retries without advancing the cursor. */ }
                }
            } finally {
                running.set(false);
                if (!closed && requested.get()) refresh(pairing, agent);
            }
        }, "LinkFlowReceive").start();
    }
    private JSONObject get(Uri endpoint, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new java.net.URL(endpoint.toString()).openConnection();
        try {
            connection.setConnectTimeout(8000); connection.setReadTimeout(10000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("X-LinkFlow-Token", token);
            if (connection.getResponseCode() != 200) throw new java.io.IOException("receive sync unavailable");
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            try (java.io.InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 2097152) throw new java.io.IOException("response limit");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject result = new JSONObject(bytes.toString("UTF-8"));
            if (!"ok".equals(result.optString("status"))) throw new java.io.IOException("invalid response");
            return result;
        } finally { connection.disconnect(); }
    }
    private void catchUp(String link, String userAgent) throws Exception {
        Uri base = Uri.parse(link);
        String token = base.getQueryParameter("token");
        if (token == null) return;
        String key = android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256")
            .digest(link.getBytes(java.nio.charset.StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP);
        Uri api = base.buildUpon().path("/api/messages").clearQuery().fragment(null).build();
        long timestamp = prefs.getLong(key, -1);
        if (timestamp < 0) {
            long cursor = get(api.buildUpon().appendQueryParameter("receive_cursor", "1").build(), token).getLong("cursor");
            prefs.edit().putLong(key, cursor).commit();
            return; // Do not bulk-download pre-existing history on first enablement.
        }
        String afterId = "";
        while (!closed && pairing.equals(link)) {
            JSONArray rows = get(api.buildUpon().appendQueryParameter("receive_after", Long.toString(timestamp))
                .appendQueryParameter("after_id", afterId).build(), token).getJSONArray("messages");
            if (rows.length() == 0) return;
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                String path = row.getString("file_path");
                Uri file = base.buildUpon().path("/files/" + path).clearQuery().fragment(null).build();
                FutureTask<Boolean> enqueue = new FutureTask<>(() -> !closed && pairing.equals(link) && downloads.receive(file, token, userAgent));
                activity.runOnUiThread(enqueue);
                if (!enqueue.get(15, TimeUnit.SECONDS)) return;
                timestamp = row.getLong("timestamp"); afterId = row.getString("id");
                // Re-read the last millisecond next time; cached download IDs remove duplicates.
                prefs.edit().putLong(key, timestamp).commit();
            }
            if (rows.length() < 200) return;
        }
    }
    void close() { closed = true; }
}
