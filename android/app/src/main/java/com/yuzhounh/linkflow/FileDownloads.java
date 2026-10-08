package com.yuzhounh.linkflow;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.MimeTypeMap;
import java.util.Locale;

/** Retains actual server filenames and reuses completed downloads for system ACTION_VIEW. */
final class FileDownloads {
    private static final String APK = "application/vnd.android.package-archive";
    private final Activity activity;
    private final DownloadManager manager;
    private final SharedPreferences prefs;
    interface ProgressListener { void onProgress(org.json.JSONObject progress); }
    private final ProgressListener listener;
    private final java.util.Map<Long, String> tracked = new java.util.LinkedHashMap<>();
    private final java.util.Set<Long> active = new java.util.HashSet<>();
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!foreground) return;
            for (long id : new java.util.ArrayList<>(active)) report(id);
            checkPendingOpen();
            if (!active.isEmpty()) handler.postDelayed(this, 500);
        }
    };
    private boolean foreground;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (tracked.containsKey(id)) report(id);
                checkPendingOpen();
            }
        }
    };
    FileDownloads(Activity activity, ProgressListener listener) {
        this.activity = activity;
        this.listener = listener;
        manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        prefs = activity.getSharedPreferences("downloads", Context.MODE_PRIVATE);
        for (java.util.Map.Entry<String, ?> entry : prefs.getAll().entrySet())
            if (entry.getKey().startsWith("file:") && entry.getValue() instanceof Long)
                tracked.put((Long) entry.getValue(), entry.getKey().substring(5));
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // Only opens an app-tracked, completed download following the user's earlier tap.
        androidx.core.content.ContextCompat.registerReceiver(activity, receiver, filter,
            androidx.core.content.ContextCompat.RECEIVER_EXPORTED);
    }
    static String filename(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "download";
        return name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
    }
    static String mime(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (ext.equals("apk")) return APK;
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return type == null ? "application/octet-stream" : type;
    }
    boolean receive(Uri uri, String token, String userAgent) {
        String key = "file:" + uri.buildUpon().clearQuery().fragment(null).build();
        long id = prefs.getLong(key, -1);
        if (id != -1 && status(id) == DownloadManager.STATUS_SUCCESSFUL && localFileExists(id)) {
            report(id); return true;
        }
        if (id != -1) {
            int state = status(id);
            if (state == DownloadManager.STATUS_PENDING || state == DownloadManager.STATUS_RUNNING || state == DownloadManager.STATUS_PAUSED || state == DownloadManager.STATUS_SUCCESSFUL) {
                active.add(id); report(id); schedulePoll(); return true;
            }
        }
        return request(uri, token, userAgent, false);
    }
    boolean request(Uri uri, String token, String userAgent, boolean openWhenReady) {
        String key = "file:" + uri.buildUpon().clearQuery().fragment(null).build();
        long previous = prefs.getLong(key, -1);
        if (previous != -1) {
            int status = status(previous);
            if (status == DownloadManager.STATUS_SUCCESSFUL && localFileExists(previous)) {
                report(previous);
                open(previous); return true;
            }
            if (status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED) {
                active.add(previous); report(previous); schedulePoll();
                return true;
            }
            tracked.remove(previous); active.remove(previous);
        }
        String name = filename(uri), mime = mime(name);
        try {
            DownloadManager.Request request = new DownloadManager.Request(uri).setTitle(name).setMimeType(mime)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "LinkFlow/" + System.currentTimeMillis() + "-" + name);
            if (token != null) request.addRequestHeader("X-LinkFlow-Token", token);
            request.addRequestHeader("User-Agent", userAgent);
            long id = manager.enqueue(request);
            tracked.put(id, key.substring(5));
            active.add(id);
            SharedPreferences.Editor edit = prefs.edit().putLong(key, id).putString("mime:" + id, mime).putBoolean("watch:" + id, true);
            if (openWhenReady && !APK.equals(mime)) edit.putLong("pendingOpen", id);
            edit.apply();
            emit(id, "running", 0, 0, 0, "");
            schedulePoll();
            return true;
        } catch (RuntimeException error) {
            // Show the failure on the card (status row) instead of a toast that covers it.
            try {
                listener.onProgress(new org.json.JSONObject().put("url", key.substring(5)).put("downloadId", "0").put("status", "failed")
                    .put("percent", 0).put("received", 0).put("total", 0).put("detail", "请检查网络与存储空间后重试"));
            } catch (org.json.JSONException ignored) { }
            return false;
        }
    }
    private int status(long id) {
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            return cursor != null && cursor.moveToFirst() ? cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) : -1;
        }
    }
    private boolean localFileExists(long id) {
        try (android.os.ParcelFileDescriptor file = manager.openDownloadedFile(id)) { return file != null; }
        catch (java.io.IOException | RuntimeException error) { return false; }
    }
    void share(Uri source) {
        long id = prefs.getLong("file:" + source.buildUpon().clearQuery().fragment(null).build(), -1);
        if (id == -1 || status(id) != DownloadManager.STATUS_SUCCESSFUL || !localFileExists(id)) {
            if (id != -1) report(id);
            toast("本地文件不存在，请先接收文件", true); return;
        }
        Uri file = manager.getUriForDownloadedFile(id);
        Intent send = new Intent(Intent.ACTION_SEND).setType(prefs.getString("mime:" + id, "application/octet-stream"))
            .putExtra(Intent.EXTRA_STREAM, file).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri("文件", file));
        try { activity.startActivity(Intent.createChooser(send, "分享文件")); }
        catch (ActivityNotFoundException error) { toast("未找到可以分享此文件的应用", true); }
    }
    void redownload(Uri source, String token, String userAgent) {
        String key = "file:" + source.buildUpon().clearQuery().fragment(null).build();
        long id = prefs.getLong(key, -1);
        if (id != -1) {
            int state = status(id);
            if (state == DownloadManager.STATUS_PENDING || state == DownloadManager.STATUS_RUNNING || state == DownloadManager.STATUS_PAUSED) {
                report(id); toast("文件正在接收，无需重复开始", false); return;
            }
            tracked.remove(id); active.remove(id);
        }
        prefs.edit().remove(key).apply();
        request(source, token, userAgent, false);
    }
    private void schedulePoll() {
        handler.removeCallbacks(poll);
        if (foreground && !active.isEmpty()) handler.postDelayed(poll, 500);
    }
    void refreshAll() {
        for (long id : new java.util.ArrayList<>(tracked.keySet())) report(id);
        schedulePoll();
    }
    private void report(long id) {
        if (!tracked.containsKey(id)) return;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) { active.remove(id); emit(id, "missing", 0, 0, 0, "本地文件不存在"); return; }
            int state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int percent = total > 0 ? (int)Math.min(99, Math.max(0, done * 100.0 / total)) : -1;
            String status = "running", detail = "";
            if (state == DownloadManager.STATUS_SUCCESSFUL && !localFileExists(id)) {
                status = "missing"; percent = 0; active.remove(id);
            } else if (state == DownloadManager.STATUS_SUCCESSFUL) {
                status = "complete"; percent = 100; active.remove(id);
            } else if (state == DownloadManager.STATUS_FAILED) {
                status = "failed"; active.remove(id);
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                detail = reason == DownloadManager.ERROR_INSUFFICIENT_SPACE ? "存储空间不足"
                    : reason >= 400 && reason < 600 ? "服务器返回 HTTP " + reason : "网络或文件错误，请点击重试";
            } else {
                active.add(id);
                if (state == DownloadManager.STATUS_PAUSED) { status = "paused"; detail = "等待网络或系统继续下载"; }
            }
            emit(id, status, percent, done, total, detail);
            if (foreground && (status.equals("complete") || status.equals("failed")) && prefs.getBoolean("watch:" + id, false) && !prefs.getBoolean("notified:" + id, false)) {
                prefs.edit().putBoolean("notified:" + id, true).apply();
            }
        } catch (RuntimeException error) { active.remove(id); }
    }
    private void emit(long id, String status, int percent, long done, long total, String detail) {
        try {
            listener.onProgress(new org.json.JSONObject().put("url", tracked.get(id)).put("downloadId", Long.toString(id)).put("status", status)
                .put("percent", percent).put("received", done).put("total", total).put("detail", detail));
        } catch (org.json.JSONException ignored) { }
    }
    private void open(long id) {
        Uri uri = manager.getUriForDownloadedFile(id);
        if (uri == null) { toast("文件已被删除，请重新下载", true); return; }
        String mime = prefs.getString("mime:" + id, "application/octet-stream");
        if (APK.equals(mime) && !activity.getPackageManager().canRequestPackageInstalls()) {
            prefs.edit().putLong("pendingInstall", id).apply();
            android.app.AlertDialog prompt = new android.app.AlertDialog.Builder(activity).setMessage("请允许 LinkFlow 安装未知来源应用。开启后将返回系统安装界面，由您确认安装。")
                .setPositiveButton("前往设置", (dialog, which) -> {
                    try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
                    catch (ActivityNotFoundException e) { toast("请在系统设置中允许 LinkFlow 安装应用", false); }
                }).setNegativeButton("取消", (dialog, which) -> prefs.edit().remove("pendingInstall").apply()).create();
            prompt.setOnCancelListener(dialog -> prefs.edit().remove("pendingInstall").apply());
            prompt.show();
            android.graphics.drawable.GradientDrawable card = new android.graphics.drawable.GradientDrawable();
            card.setColor(android.graphics.Color.WHITE);
            card.setCornerRadius(20 * activity.getResources().getDisplayMetrics().density);
            if (prompt.getWindow() != null) {
                prompt.getWindow().setBackgroundDrawable(card);
                prompt.getWindow().getDecorView().setClipToOutline(true);
            }
            return;
        }
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (ActivityNotFoundException error) { toast("手机未安装可打开此格式的应用，文件已保存在 Download/LinkFlow", true); }
          catch (SecurityException error) { toast("系统无法打开该文件，请从下载通知或文件管理器打开", true); }
    }
    private void checkPendingOpen() {
        if (!foreground) return;
        long id = prefs.getLong("pendingOpen", -1);
        if (id != -1 && status(id) == DownloadManager.STATUS_SUCCESSFUL) {
            prefs.edit().remove("pendingOpen").apply(); open(id);
        } else if (id != -1 && status(id) == DownloadManager.STATUS_FAILED) {
            prefs.edit().remove("pendingOpen").apply();
        }
    }
    void resume() {
        foreground = true;
        refreshAll();
        checkPendingOpen();
        long id = prefs.getLong("pendingInstall", -1);
        if (id != -1 && activity.getPackageManager().canRequestPackageInstalls()) {
            prefs.edit().remove("pendingInstall").apply(); open(id);
        }
    }
    void pause() { foreground = false; handler.removeCallbacks(poll); }
    void close() { handler.removeCallbacks(poll); activity.unregisterReceiver(receiver); }
    private void toast(String message, boolean error) { Notice.show(activity, message, error); }
}
