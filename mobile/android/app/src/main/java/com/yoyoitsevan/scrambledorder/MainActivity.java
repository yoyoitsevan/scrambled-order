package com.yoyoitsevan.scrambledorder;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Draw edge to edge; the web layer keeps the game inside the safe areas (--safe-area-inset-*).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
