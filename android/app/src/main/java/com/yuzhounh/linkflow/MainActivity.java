package com.yuzhounh.linkflow;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

/** Android companion: the existing Windows host owns the UI, storage and pairing. */
public class MainActivity extends Activity {
    private WebView web;
    private LinearLayout root;
    private String pairingUrl = "";
    private boolean showingWelcome;
    private ValueCallback<Uri[]> pendingFiles;
    private static final int PICK_FILES = 10;
    private static final int TAKE_PHOTO = 11;
    private static final int CAMERA_PERMISSION = 12;
    private Uri captureUri;
    private FileDownloads downloads;
    private AutoReceiver autoReceiver;
    private boolean returnToConnectionsAfterScan;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        downloads = new FileDownloads(this, progress -> {
            if (web != null && web.getUrl() != null && sameServer(Uri.parse(web.getUrl())))
                web.evaluateJavascript("window.LinkFlowDownloadProgress && window.LinkFlowDownloadProgress(" + progress.toString() + ")", null);
        });
        autoReceiver = new AutoReceiver(this, downloads);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        } else {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets;
            });
        }
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setTextZoom(100);
        web.getSettings().setUseWideViewPort(true);
        web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Object() {
            // Device name survives re-pairing: the WebView's localStorage is per host address.
            @JavascriptInterface public String getDeviceName() {
                return getSharedPreferences("settings", MODE_PRIVATE).getString("deviceName", "");
            }
            @JavascriptInterface public void setDeviceName(String name) {
                String value = name == null ? "" : name.trim();
                if (value.length() > 64) value = value.substring(0, 64);
                getSharedPreferences("settings", MODE_PRIVATE).edit().putString("deviceName", value).apply();
            }
        }, "LinkFlowNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (request.isForMainFrame() && "linkflow".equals(uri.getScheme())
                        && (showingWelcome || (view.getUrl() != null && sameServer(Uri.parse(view.getUrl()))))) {
                    if ("scan".equals(uri.getHost())) startScan();
                    else if ("pair".equals(uri.getHost())) showPairing();
                    else if ("retry".equals(uri.getHost()) && !pairingUrl.isEmpty()) connectToHost();
                    else if ("manage".equals(uri.getHost())) showConnectionOptions();
                    else if ("receive".equals(uri.getHost())) autoReceiver.refresh(pairingUrl, web.getSettings().getUserAgentString());
                    else if ("file-action".equals(uri.getHost())) {
                        try {
                            Uri file = Uri.parse(uri.getQueryParameter("url"));
                            if (!sameServer(file) || !(file.getPath().startsWith("/files/") || file.getPath().startsWith("/thumbs/"))) return true;
                            String action = uri.getQueryParameter("mode");
                            if ("share".equals(action)) downloads.share(file);
                            else if ("open".equals(action)) downloads.request(file, Uri.parse(pairingUrl).getQueryParameter("token"), web.getSettings().getUserAgentString(), true);
                            else if ("redownload".equals(action)) downloads.redownload(file, Uri.parse(pairingUrl).getQueryParameter("token"), web.getSettings().getUserAgentString());
                            else if ("receive".equals(action)) downloads.request(file, Uri.parse(pairingUrl).getQueryParameter("token"), web.getSettings().getUserAgentString(), false);
                        } catch (RuntimeException error) { toast("无法处理该文件，请刷新后重试", true); }
                    }
                    return true;
                }
                if (sameServer(uri)) {
                    if (request.isForMainFrame() && (uri.getPath().startsWith("/files/") || uri.getPath().startsWith("/thumbs/"))) {
                        downloads.request(uri, Uri.parse(pairingUrl).getQueryParameter("token"), web.getSettings().getUserAgentString(), true);
                        return true;
                    }
                    return false;
                }
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    // Never forward a host pairing token to another application.
                    if (uri.getQueryParameter("token") == null) {
                        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                        catch (android.content.ActivityNotFoundException e) { toast("没有可用的浏览器", true); }
                    }
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (sameServer(Uri.parse(url))) {
                    view.evaluateJavascript("window.LinkFlowAndroid = true; window.LinkFlowDownloads && window.LinkFlowDownloads.apply()", null);
                    try {
                        String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                        view.evaluateJavascript("window.LinkFlowAppVersion=" + org.json.JSONObject.quote(version)
                            + ";{const label=document.getElementById('app-version-text');if(label)label.textContent='LinkFlow v'+window.LinkFlowAppVersion;}", null);
                    } catch (android.content.pm.PackageManager.NameNotFoundException ignored) { }
                    downloads.refreshAll();
                    autoReceiver.refresh(pairingUrl, web.getSettings().getUserAgentString());
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    toast("连接失败，请确认电脑已运行 LinkFlow，并连接同一个 Wi-Fi", true);
                    showWelcome();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                if (params.isCaptureEnabled()) {
                    if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                    else takePhoto();
                    return true;
                }
                try {
                    java.util.ArrayList<String> types = new java.util.ArrayList<>();
                    for (String accept : params.getAcceptTypes()) for (String type : accept.split(","))
                        if (type.trim().contains("/")) types.add(type.trim());
                    Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                    picker.setType(types.size() == 1 ? types.get(0) : "*/*");
                    if (types.size() > 1) picker.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                    picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    boolean mediaOnly = !types.isEmpty();
                    for (String type : types) mediaOnly &= type.startsWith("image/") || type.startsWith("video/");
                    if (mediaOnly && android.os.Build.VERSION.SDK_INT >= 33) {
                        Intent photos = new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
                        if (types.size() == 1) photos.setType(types.get(0));
                        if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                            photos.putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(100, android.provider.MediaStore.getPickImagesMaxLimit()));
                        try { startActivityForResult(photos, PICK_FILES); return true; }
                        catch (android.content.ActivityNotFoundException ignored) { }
                    } else if (mediaOnly) {
                        picker.setAction(Intent.ACTION_GET_CONTENT);
                    }
                    startActivityForResult(picker, PICK_FILES);
                }
                catch (android.content.ActivityNotFoundException e) {
                    pendingFiles.onReceiveValue(null); pendingFiles = null;
                    toast("未找到文件选择器", true);
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, size) -> {
            Uri uri = Uri.parse(url);
            if (!sameServer(uri)) { toast("只允许下载已配对电脑上的文件", true); return; }
            downloads.request(uri, Uri.parse(pairingUrl).getQueryParameter("token"), userAgent, false);
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(true);
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightNavigationBars(true);
        pairingUrl = getPreferences(MODE_PRIVATE).getString("pairingUrl", "");
        if (pairingUrl.isEmpty()) {
            showWelcome();
        } else connectToHost();
    }

    private void showWelcome() {
        showingWelcome = true;
        try (java.io.InputStream input = getAssets().open("welcome.html")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String html = output.toString("UTF-8");
            try (java.io.InputStream icon = getAssets().open("icon.png")) {
                java.io.ByteArrayOutputStream image = new java.io.ByteArrayOutputStream();
                while ((count = icon.read(buffer)) != -1) image.write(buffer, 0, count);
                html = html.replace("__APP_ICON__", "data:image/png;base64," + android.util.Base64.encodeToString(image.toByteArray(), android.util.Base64.NO_WRAP));
            }
            // Raw HTML (including CSS # colors and Chinese) must not be passed to loadData.
            web.loadDataWithBaseURL("https://linkflow.invalid/", html, "text/html", "UTF-8", null);
        } catch (java.io.IOException error) {
            toast("请点击连接电脑，粘贴完整配对链接", false);
        }
    }

    private void connectToHost() {
        showingWelcome = false;
        web.loadUrl(pairingUrl);
    }

    private boolean sameServer(Uri uri) {
        if (pairingUrl.isEmpty()) return false;
        Uri host = Uri.parse(pairingUrl);
        return host.getScheme().equals(uri.getScheme()) && host.getHost().equals(uri.getHost()) && host.getPort() == uri.getPort();
    }

    // Popup type scale shared with the web UI (dp): title 20, body 16, control 15, hint 14.
    private static final int FS_TITLE = 20, FS_BODY = 16, FS_CTL = 15, FS_HINT = 14;

    private TextView dialogTitle(String text) {
        TextView title = new TextView(this);
        title.setText(text);
        title.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_TITLE);
        title.setTextColor(0xFF191919);
        title.setPadding(dp(24), dp(24), dp(24), dp(8));
        return title;
    }

    private void showPairing() { showPairing(false); }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void roundDialog(AlertDialog dialog) {
        android.graphics.drawable.GradientDrawable card = new android.graphics.drawable.GradientDrawable();
        card.setColor(Color.WHITE);
        card.setCornerRadius(dp(20));
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(card);
            dialog.getWindow().getDecorView().setClipToOutline(true);
        }
    }

    private void showPairing(boolean returnToConnections) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(12), dp(24), dp(4));
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_CTL);
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("粘贴完整配对链接");
        input.setText(pairingUrl);
        TextView preview = new TextView(this);
        preview.setSingleLine(true);
        preview.setEllipsize(android.text.TextUtils.TruncateAt.END);
        preview.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_CTL);
        preview.setGravity(android.view.Gravity.CENTER_VERTICAL);
        preview.setPadding(dp(12), dp(8), dp(12), dp(8));
        preview.setContentDescription("配对链接，点击编辑");
        android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
        background.setColor(Color.rgb(245, 247, 250));
        background.setCornerRadius(dp(8));
        background.setStroke(dp(1), Color.rgb(216, 224, 232));
        preview.setBackground(background);
        input.setBackground(background.getConstantState().newDrawable().mutate());
        content.addView(preview, new LinearLayout.LayoutParams(-1, dp(48)));
        content.addView(input, new LinearLayout.LayoutParams(-1, dp(48)));
        Runnable summarize = () -> {
            preview.setText(input.length() == 0 ? "粘贴完整配对链接" : input.getText());
            preview.setVisibility(View.VISIBLE);
            input.setVisibility(View.GONE);
        };
        Runnable edit = () -> {
            preview.setVisibility(View.GONE);
            input.setVisibility(View.VISIBLE);
            input.requestFocus();
            input.setSelection(input.length());
        };
        preview.setOnClickListener(v -> {
            edit.run();
            ((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });
        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(android.view.Gravity.END);
        TextView feedback = new TextView(this);
        feedback.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_HINT);
        feedback.setTextColor(Color.rgb(90, 108, 122));
        feedback.setPadding(0, dp(8), 0, dp(4));
        content.addView(feedback);
        Button connect = new Button(this);
        connect.setText("连接");
        Button cancel = new Button(this);
        cancel.setText("取消");
        input.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                boolean valid = isPairingLink(s.toString());
                connect.setEnabled(valid);
                connect.setAlpha(valid ? 1f : .45f);
                feedback.setText(s.length() == 0 ? "请输入或粘贴配对链接" : valid ? "点击连接以确认配对" : "这不是有效的 LinkFlow 配对链接");
            }
            public void afterTextChanged(android.text.Editable value) { }
        });
        Button clear = new Button(this);
        clear.setText("清空");
        clear.setOnClickListener(v -> { input.setText(""); edit.run(); });
        Button paste = new Button(this);
        paste.setText("粘贴");
        paste.setOnClickListener(v -> {
            String value = clipboardText();
            if (value.isEmpty()) { feedback.setText("剪贴板没有文本，已保留当前输入"); return; }
            input.setText(value);
            summarize.run();
            if (isPairingLink(value)) feedback.setText("已粘贴并替换配对链接，请点击连接");
            ((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
        });
        int position = 0;
        for (Button action : new Button[]{paste, clear, connect, cancel}) {
            action.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_CTL);
            action.setMinWidth(0);
            action.setMinimumWidth(0);
            action.setPadding(dp(4), 0, dp(4), 0);
            action.setSingleLine(true);
            action.setAllCaps(false);
            android.graphics.drawable.GradientDrawable button = new android.graphics.drawable.GradientDrawable();
            button.setColor(Color.rgb(239, 244, 248));
            action.setTextColor(Color.rgb(35, 53, 70));
            button.setCornerRadius(dp(12));
            action.setBackground(new android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(Color.rgb(213, 229, 241)), button, null));
            LinearLayout.LayoutParams spacing = new LinearLayout.LayoutParams(0, dp(44), 1);
            spacing.setMargins(position++ == 0 ? 0 : dp(8), dp(8), 0, dp(12));
            actions.addView(action, spacing);
        }
        content.addView(actions);
        summarize.run();
        TextView intro = new TextView(this);
        intro.setText("确认配对链接后连接，点击链接可编辑。");
        intro.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_HINT);
        intro.setTextColor(Color.rgb(90, 108, 122));
        intro.setPadding(0, 0, 0, dp(12));
        content.addView(intro, 0);
        AlertDialog dialog = new AlertDialog.Builder(this).setCustomTitle(dialogTitle("连接 LinkFlow 电脑"))
            .setView(content).create();
        dialog.setOnCancelListener(d -> { if (returnToConnections) showConnectionOptions(); });
        cancel.setOnClickListener(v -> dialog.cancel());
        connect.setOnClickListener(v -> {
            String value = input.getText().toString().trim();
            if (!isPairingLink(value)) return;
            connect.setEnabled(false); paste.setEnabled(false); clear.setEnabled(false);
            input.setEnabled(false); preview.setEnabled(false);
            feedback.setText("正在连接电脑…");
            new Thread(() -> {
                String failure = null;
                java.net.HttpURLConnection connection = null;
                try {
                    Uri link = Uri.parse(value);
                    Uri endpoint = link.buildUpon().path("/api/system/info").clearQuery().fragment(null).build();
                    connection = (java.net.HttpURLConnection)new java.net.URL(endpoint.toString()).openConnection();
                    connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("X-LinkFlow-Token", link.getQueryParameter("token"));
                    int status = connection.getResponseCode();
                    if (status == 401 || status == 403) failure = "配对链接已失效，请重新扫码或粘贴新链接";
                    else if (status != 200) failure = "电脑端暂时无法连接，请检查 LinkFlow 是否正在运行";
                    else {
                        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                        try (java.io.InputStream response = connection.getInputStream()) {
                            byte[] buffer = new byte[4096]; int count;
                            while ((count = response.read(buffer)) != -1) {
                                if (bytes.size() + count > 262144) throw new java.io.IOException("response too large");
                                bytes.write(buffer, 0, count);
                            }
                        }
                        org.json.JSONObject result = new org.json.JSONObject(bytes.toString("UTF-8"));
                        if (!"ok".equals(result.optString("status"))) failure = "链接不是可用的 LinkFlow 服务";
                    }
                } catch (Exception error) { failure = "连接失败，请确认电脑已运行 LinkFlow，且处于同一网络"; }
                finally { if (connection != null) connection.disconnect(); }
                final String message = failure;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                    connect.setEnabled(true); paste.setEnabled(true); clear.setEnabled(true);
                    input.setEnabled(true); preview.setEnabled(true);
                    if (message != null) { feedback.setText(message); return; }
                    acceptPairing(value);
                    dialog.dismiss();
                });
            }, "LinkFlowPairing").start();
        });
        dialog.setOnShowListener(d -> {
            // Read once on opening, never on focus/resume or while the user edits.
            content.post(() -> {
                if (!dialog.isShowing()) return;
                String value = clipboardText();
                if (isPairingLink(value)) {
                    input.setText(value);
                    summarize.run();
                    feedback.setText("已从剪贴板填入配对链接，请点击连接");
                } else {
                    connect.setEnabled(isPairingLink(input.getText().toString()));
                    connect.setAlpha(connect.isEnabled() ? 1f : .45f);
                    feedback.setText(input.length() == 0 ? "请输入或粘贴配对链接" : "保留当前链接；可粘贴替换或点击编辑");
                }
            });
        });
        dialog.show();
        roundDialog(dialog);
    }

    private String clipboardText() {
        try {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            android.content.ClipData clip = clipboard.getPrimaryClip();
            CharSequence text = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getText() : null;
            return text == null ? "" : text.toString().trim();
        } catch (RuntimeException error) { return ""; }
    }

    private boolean isPairingLink(String value) {
        try {
            Uri uri = Uri.parse(value.trim());
            return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null
                && uri.getUserInfo() == null && uri.getQueryParameter("token") != null && !uri.getQueryParameter("token").isEmpty();
        } catch (RuntimeException e) { return false; }
    }
    private boolean acceptPairing(String value) {
        if (!isPairingLink(value)) return false;
        Uri uri = Uri.parse(value.trim());
        pairingUrl = uri.buildUpon().path("/").fragment(null).build().toString();
        getPreferences(MODE_PRIVATE).edit().putString("pairingUrl", pairingUrl).apply();
        web.clearHistory();
        connectToHost();
        return true;
    }
    private void startScan() {
        startScan(false);
    }
    private void startScan(boolean returnToConnections) {
        returnToConnectionsAfterScan = returnToConnections;
        new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt("扫描电脑 LinkFlow 的配对二维码").setBeepEnabled(false)
            .setCaptureActivity(PortraitCaptureActivity.class).setOrientationLocked(true).initiateScan();
    }
    private void takePhoto() {
        try {
            java.io.File dir = new java.io.File(getCacheDir(), "photos");
            if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("camera cache");
            java.io.File photo = java.io.File.createTempFile("Image_", ".jpg", dir);
            captureUri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
            Intent camera = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, captureUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(camera, TAKE_PHOTO);
        } catch (Exception error) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = null;
            toast("无法启动相机，请改用图片按钮选择文件", true);
        }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == CAMERA_PERMISSION) {
            if (results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) takePhoto();
            else {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = null;
                toast("未获得相机权限，可使用图片按钮选择已有照片", true);
            }
        }
    }
    private void showConnectionOptions() {
        LinearLayout options = new LinearLayout(this);
        options.setOrientation(LinearLayout.VERTICAL);
        options.setPadding(dp(8), dp(8), dp(8), 0);
        // Fixed dp sizes (not sp) so this card matches the web settings dialog and long-press sheet exactly.
        AlertDialog dialog = new AlertDialog.Builder(this).setCustomTitle(dialogTitle("连接管理"))
            .setView(options).setNegativeButton("取消", null).create();
        String[] labels = {"摄像头扫码连接", "粘贴配对链接", "重新连接当前电脑"};
        int[] icons = {R.drawable.ic_scan, R.drawable.ic_link, R.drawable.ic_refresh};
        for (int i = 0; i < labels.length; i++) {
            final int choice = i;
            Button row = new Button(this);
            row.setText(labels[i]); row.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, FS_BODY); row.setAllCaps(false);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
            row.setPadding(dp(16), 0, dp(16), 0);
            row.setCompoundDrawablesWithIntrinsicBounds(icons[i], 0, 0, 0);
            row.setCompoundDrawablePadding(dp(16));
            android.util.TypedValue selectable = new android.util.TypedValue();
            getTheme().resolveAttribute(android.R.attr.selectableItemBackground, selectable, true);
            row.setBackgroundResource(selectable.resourceId);
            row.setOnClickListener(v -> {
                dialog.dismiss();
                if (choice == 0) startScan(true); else if (choice == 1) showPairing(true);
                else if (!pairingUrl.isEmpty()) connectToHost(); else showPairing(true);
            });
            options.addView(row, new LinearLayout.LayoutParams(-1, dp(56)));
        }
        dialog.show();
        roundDialog(dialog);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == TAKE_PHOTO) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(result == RESULT_OK && captureUri != null ? new Uri[]{captureUri} : null);
            pendingFiles = null;
            captureUri = null;
            return;
        }
        IntentResult scan = IntentIntegrator.parseActivityResult(request, result, data);
        if (scan != null) {
            if (scan.getContents() != null) {
                try { if (!acceptPairing(scan.getContents())) toast("这不是 LinkFlow 配对二维码，请扫描电脑端的二维码", true); }
                catch (RuntimeException e) { toast("无法识别配对链接，请重新扫描", true); }
            }
            else if (returnToConnectionsAfterScan) showConnectionOptions();
            returnToConnectionsAfterScan = false;
            return;
        }
        if (request == PICK_FILES && pendingFiles != null) {
            java.util.ArrayList<Uri> selected = new java.util.ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) selected.add(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) selected.add(data.getData());
                for (Uri uri : selected) try {
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (SecurityException ignored) { }
            }
            pendingFiles.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
            pendingFiles = null;
        }
    }
    @Override protected void onResume() {
        super.onResume();
        if (downloads != null) downloads.resume();
        if (autoReceiver != null && !showingWelcome) autoReceiver.refresh(pairingUrl, web.getSettings().getUserAgentString());
        if (web != null && !showingWelcome) web.evaluateJavascript("window.dispatchEvent(new Event('linkflow-resume'))", null);
    }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onPause() { downloads.pause(); super.onPause(); }
    @Override protected void onDestroy() {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        autoReceiver.close();
        downloads.close();
        web.destroy();
        super.onDestroy();
    }
    private void toast(String message, boolean error) { Notice.show(this, message, error); }
}
