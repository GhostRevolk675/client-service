package com.ephemeral.chat;

import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity - Ephemeral Chat
 * 
 * Configura a activity principal com tema escuro e tela sempre ativa.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configurar status bar e navigation bar escuras
        Window window = getWindow();
        window.setStatusBarColor(0xFF0A0A0F);
        window.setNavigationBarColor(0xFF0A0A0F);

        // Manter tela ativa enquanto o app estiver aberto
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
