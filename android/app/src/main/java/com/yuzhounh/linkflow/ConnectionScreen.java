package com.yuzhounh.linkflow;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.*;

/** Local startup UI stays visible while the host and WebView are unavailable. */
final class ConnectionScreen extends ScrollView {
    private final TextView title, detail;
    private final ProgressBar progress;
    private final Button primary, secondary, cancel;
    private final Runnable scan, manage, retry, stop;

    ConnectionScreen(Context context, Runnable scan, Runnable manage, Runnable retry, Runnable stop) {
        super(context);
        this.scan = scan; this.manage = manage; this.retry = retry; this.stop = stop;
        setFillViewport(true);
        setBackgroundColor(0xFFF7F9FC);
        LinearLayout content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(28), dp(24), dp(28));
        addView(content, new ScrollView.LayoutParams(-1, -1));
        LinearLayout brand = new LinearLayout(context);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.icon);
        brand.addView(icon, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView name = text("LinkFlow", 22);
        name.setTypeface(null, android.graphics.Typeface.BOLD);
        name.setPadding(dp(12), 0, 0, 0);
        brand.addView(name);
        content.addView(brand);
        title = text("", 23);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setPadding(0, dp(32), 0, dp(12));
        content.addView(title);
        detail = text("", 16);
        detail.setTextColor(0xFF65758A);
        detail.setLineSpacing(dp(4), 1f);
        content.addView(detail);
        progress = new ProgressBar(context);
        progress.setIndeterminateTintList(ColorStateList.valueOf(0xFF20A9DE));
        LinearLayout.LayoutParams spinner = new LinearLayout.LayoutParams(dp(32), dp(32));
        spinner.setMargins(0, dp(24), 0, dp(12));
        content.addView(progress, spinner);
        primary = button(content, true);
        secondary = button(content, false);
        cancel = button(content, false);
        TextView hint = text("电脑需保持运行，手机与电脑需在可互通的局域网中。", 13);
        hint.setTextColor(0xFF65758A);
        hint.setPadding(0, dp(24), 0, 0);
        content.addView(hint);
    }

    void welcome() {
        title.setText("手机与电脑，随手互传");
        detail.setText("配对一次，下次自动连接。\n\n1. 打开电脑端 LinkFlow\n2. 在电脑端打开“扫码连接”，扫描二维码");
        progress.setVisibility(GONE);
        primary.setText("摄像头扫码连接"); primary.setVisibility(VISIBLE);
        primary.setOnClickListener(v -> scan.run());
        secondary.setText("粘贴配对链接"); secondary.setVisibility(VISIBLE);
        secondary.setOnClickListener(v -> manage.run());
        cancel.setVisibility(GONE);
    }

    void busy(boolean loading) {
        title.setText(loading ? "正在加载界面…" : "正在连接电脑…");
        detail.setText(loading ? "电脑已响应，正在准备传输界面。" : "正在连接已配对电脑，请稍候。");
        progress.setVisibility(VISIBLE);
        primary.setVisibility(GONE);
        secondary.setText("更换电脑"); secondary.setVisibility(VISIBLE);
        secondary.setOnClickListener(v -> manage.run());
        cancel.setText("取消等待"); cancel.setVisibility(VISIBLE);
        cancel.setOnClickListener(v -> stop.run());
    }

    void failed(String heading, String message, boolean unpaired) {
        title.setText(heading); detail.setText(message);
        progress.setVisibility(GONE);
        primary.setText(unpaired ? "重新扫码配对" : "重试连接"); primary.setVisibility(VISIBLE);
        primary.setOnClickListener(v -> { if (unpaired) scan.run(); else retry.run(); });
        secondary.setText("更换电脑"); secondary.setVisibility(VISIBLE);
        secondary.setOnClickListener(v -> manage.run());
        cancel.setVisibility(GONE);
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(getContext());
        view.setText(value); view.setTextSize(size); view.setTextColor(0xFF213547);
        return view;
    }

    private Button button(LinearLayout content, boolean accent) {
        Button button = new Button(getContext());
        button.setTextSize(16); button.setAllCaps(false);
        button.setMinHeight(dp(48)); button.setPadding(dp(16), dp(10), dp(16), dp(10));
        button.setTextColor(accent ? Color.WHITE : 0xFF213547);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(accent ? 0xFF20A9DE : Color.WHITE);
        shape.setCornerRadius(dp(24));
        if (!accent) shape.setStroke(dp(1), 0xFFDCE3EC);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0xFFD5E5F1), shape, null));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(12);
        content.addView(button, params);
        return button;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
