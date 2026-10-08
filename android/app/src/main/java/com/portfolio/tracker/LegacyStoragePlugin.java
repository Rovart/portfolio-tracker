package com.portfolio.tracker;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Reads the old WebView origin locally, without downloading or changing its data. */
@CapacitorPlugin(name = "LegacyStorage")
public class LegacyStoragePlugin extends Plugin {
    private static final String LEGACY_ORIGIN = "https://portfolio-tracker-xi-three.vercel.app/";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView reader;
    private PluginCall pending;
    private final Runnable timeout = () -> finish(null);

    @PluginMethod
    public void read(PluginCall call) {
        getActivity().runOnUiThread(() -> start(call));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void start(PluginCall call) {
        if (pending != null) {
            call.reject("Saved portfolio migration is already running.");
            return;
        }
        pending = call;
        try {
            String html;
            try (InputStream input = getContext().getAssets().open("legacy-storage.html")) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                html = output.toString(StandardCharsets.UTF_8.name());
            }
            reader = new WebView(getContext());
            reader.getSettings().setJavaScriptEnabled(true);
            reader.getSettings().setDomStorageEnabled(true);
            reader.getSettings().setAllowFileAccess(false);
            reader.getSettings().setAllowContentAccess(false);
            reader.getSettings().setBlockNetworkLoads(true);
            reader.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true;
                }
            });
            reader.addJavascriptInterface(new SnapshotReceiver(), "MonetraLegacy");
            handler.postDelayed(timeout, 15000);
            // A bundled, read-only document adopts the old HTTPS origin to access
            // its IndexedDB/localStorage in this app's existing WebView profile.
            reader.loadDataWithBaseURL(LEGACY_ORIGIN, html, "text/html", "UTF-8", null);
        } catch (Exception error) {
            finish(null);
        }
    }

    public class SnapshotReceiver {
        @JavascriptInterface
        public void complete(String snapshot) {
            handler.post(() -> finish(snapshot));
        }

        @JavascriptInterface
        public void failed() {
            handler.post(() -> finish(null));
        }
    }

    private void finish(String snapshot) {
        PluginCall call = pending;
        pending = null;
        handler.removeCallbacks(timeout);
        if (reader != null) {
            reader.removeJavascriptInterface("MonetraLegacy");
            reader.destroy();
            reader = null;
        }
        if (call == null) return;
        try {
            if (snapshot == null) call.reject("Unable to read your saved portfolios. Retry to preserve your data.");
            else call.resolve(new JSObject(snapshot));
        } catch (Exception error) {
            call.reject("Unable to read your saved portfolios. Retry to preserve your data.");
        }
    }

    @Override
    protected void handleOnDestroy() {
        handler.post(() -> finish(null));
    }
}
