package com.portfolio.tracker;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(LegacyStoragePlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BundledWebViewClient(bridge));
    }
}
