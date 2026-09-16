package com.xunuo.pocketscan;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PdfSavePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
