package fr.apkfold.haiku;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

// Haiku : enregistre le plugin natif (biométrie Keystore, écran sécurisé, presse-papiers sensible)
// et démarre avec l'écran sécurisé (pas de capture, aperçu masqué) tant que le JS n'a pas dit l'inverse.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HaikuNativePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
