package com.yuzhounh.linkflow;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

/** In-app notice that matches the web UI toast: a rounded pill, blue for info, light red for errors. */
final class Notice {
    private static final long SHOW_MS = 2200;
    private static TextView current;

    private Notice() { }

    static void show(Activity activity, String message, boolean error) {
        activity.runOnUiThread(() -> {
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root == null) return;
            if (current != null && current.getParent() instanceof ViewGroup) ((ViewGroup) current.getParent()).removeView(current);
            boolean night = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            int bg = error ? (night ? 0xFF3A1A1A : 0xFFFDECEC) : (night ? 0xFF082F49 : 0xFFE8F5FB);
            int fg = error ? (night ? 0xFFFF8A80 : 0xFFC0392B) : (night ? 0xFF38BDF8 : 0xFF1E8EC5);
            int stroke = error ? (night ? 0xFFC0524A : 0xFFE57373) : (night ? 0xFF38BDF8 : 0xFF24A1DE);
            float density = activity.getResources().getDisplayMetrics().density;
            GradientDrawable shape = new GradientDrawable();
            shape.setColor(bg);
            shape.setCornerRadius(20 * density);
            shape.setStroke(Math.max(1, Math.round(density)), stroke);
            TextView view = new TextView(activity);
            view.setText(message);
            view.setTextColor(fg);
            view.setTextSize(13);
            view.setBackground(shape);
            view.setElevation(4 * density);
            int h = Math.round(18 * density), v = Math.round(8 * density);
            view.setPadding(h, v, h, v);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            params.topMargin = Math.round(76 * density);
            int side = Math.round(16 * density);
            params.leftMargin = side; params.rightMargin = side;
            view.setLayoutParams(params);
            view.setClickable(false);
            view.setAlpha(0f);
            root.addView(view);
            view.animate().alpha(1f).setDuration(200).start();
            current = view;
            view.postDelayed(() -> view.animate().alpha(0f).setDuration(200).withEndAction(() -> {
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                if (current == view) current = null;
            }).start(), SHOW_MS);
        });
    }
}
