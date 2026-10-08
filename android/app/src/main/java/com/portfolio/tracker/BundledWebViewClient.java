package com.portfolio.tracker;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;

/** Serves exported HTML pages on full navigation, including reloads / back gestures. */
public class BundledWebViewClient extends BridgeWebViewClient {
    private final Bridge appBridge;

    public BundledWebViewClient(Bridge bridge) {
        super(bridge);
        appBridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (request.isForMainFrame() && "https".equals(url.getScheme()) && appBridge.getHost().equals(url.getHost())) {
            String page = switch (url.getPath()) {
                case "/privacy", "/privacy/" -> "privacy";
                case "/terms", "/terms/" -> "terms";
                default -> null;
            };
            if (page != null) {
                try {
                    InputStream html = appBridge.getContext().getAssets().open("public/" + page + "/index.html");
                    return new WebResourceResponse("text/html", "UTF-8", appBridge.getLocalServer().getJavaScriptInjectedStream(html));
                } catch (IOException error) {
                    // Let Capacitor handle missing assets using its normal fallback.
                }
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
