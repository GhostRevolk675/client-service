package com.ephemeral.chat;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity - Ephemeral Chat
 * 
 * Configura a activity principal com tema escuro,
 * status bar transparente e navegação immersiva.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configurar status bar escura
        Window window = getWindow();
        window.setStatusBarColor(0xFF0A0A0F);
        window.setNavigationBarColor(0xFF0A0A0F);

        // Ícones claros na status bar (para fundo escuro)
        View decorView = window.getDecorView();
        WindowInsetsControllerCompat controller = 
            WindowCompat.getInsetsController(window, decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        // Manter tela ativa enquanto o app estiver aberto
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
