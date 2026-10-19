package fr.apkfold.haiku;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.PersistableBundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Plugin natif de Haiku.
 *  - Biométrie : la clé de données du coffre est chiffrée par une clé AES-256 de l'Android Keystore
 *    qui n'est utilisable qu'après une authentification biométrique forte (classe 3), et qui est
 *    invalidée si une nouvelle empreinte est enregistrée.
 *  - Écran sécurisé (FLAG_SECURE), presse-papiers marqué « sensible », couleur des barres système,
 *    ouverture de liens dans le navigateur.
 */
@CapacitorPlugin(name = "HaikuNative")
public class HaikuNativePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFS = "haiku_biometric";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    // ---- écran, barres, liens -------------------------------------------------------------

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (on) w.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else w.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            if (Build.VERSION.SDK_INT >= 33) getActivity().setRecentsScreenshotEnabled(!on);
            call.resolve();
        });
    }

    @PluginMethod
    public void setBars(PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        final String color = call.getString("color", "#07050d");
        getActivity().runOnUiThread(() -> {
            try {
                Window w = getActivity().getWindow();
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                c.setAppearanceLightStatusBars(!dark);
                c.setAppearanceLightNavigationBars(!dark);
                int col = Color.parseColor(color);
                w.getDecorView().setBackgroundColor(col);
                if (Build.VERSION.SDK_INT < 35) {
                    w.setStatusBarColor(Color.TRANSPARENT);
                    w.setNavigationBarColor(col);
                }
            } catch (Exception ignored) {
                // couleur invalide : on garde l'existant
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Adresse non prise en charge");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Aucune appli pour ouvrir ce lien");
        }
    }

    // ---- presse-papiers ---------------------------------------------------------------------

    @PluginMethod
    public void copy(PluginCall call) {
        final String text = call.getString("text", "");
        final boolean sensitive = Boolean.TRUE.equals(call.getBoolean("sensitive", true));
        final String label = call.getString("label", "Haiku");
        getActivity().runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText(label, text);
            if (sensitive) {
                PersistableBundle extras = new PersistableBundle();
                // Masque l'aperçu du presse-papiers d'Android 13+ et l'exclut des historiques des claviers.
                extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
                clip.getDescription().setExtras(extras);
            }
            cm.setPrimaryClip(clip);
            call.resolve();
        });
    }

    @PluginMethod
    public void clearClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            try {
                if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                else cm.setPrimaryClip(ClipData.newPlainText("", ""));
            } catch (Exception ignored) {
                // rien
            }
            call.resolve();
        });
    }

    // ---- biométrie ---------------------------------------------------------------------------

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String alias(String key) {
        return "haiku_" + key.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    private String availability() {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        switch (r) {
            case BiometricManager.BIOMETRIC_SUCCESS: return null;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "Aucune empreinte ou visage enregistré dans les réglages Android.";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "Pas de capteur biométrique compatible.";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "Capteur biométrique indisponible pour le moment.";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: return "Mise à jour de sécurité Android requise.";
            default: return "Biométrie forte (classe 3) indisponible.";
        }
    }

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        String reason = availability();
        JSObject r = new JSObject();
        r.put("available", reason == null);
        if (reason != null) r.put("reason", reason);
        call.resolve(r);
    }

    @PluginMethod
    public void biometricHas(PluginCall call) {
        String key = call.getString("key", "");
        JSObject r = new JSObject();
        r.put("enrolled", prefs().contains(alias(key) + "_ct"));
        call.resolve(r);
    }

    private SecretKey createKey(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(b.build());
        return kg.generateKey();
    }

    private SecretKey loadKey(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        return (SecretKey) ks.getKey(alias, null);
    }

    private void deleteKey(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) {
            // rien
        }
        prefs().edit().remove(alias + "_ct").remove(alias + "_iv").apply();
    }

    private interface CipherDone {
        void done(Cipher c) throws Exception;
    }

    private void prompt(PluginCall call, Cipher cipher, CipherDone onOk) {
        final String title = call.getString("title", "Haiku");
        final String subtitle = call.getString("subtitle", "");
        final String negative = call.getString("negative", "Annuler");
        getActivity().runOnUiThread(() -> {
            FragmentActivity act = (FragmentActivity) getActivity();
            BiometricPrompt bp = new BiometricPrompt(act, ContextCompat.getMainExecutor(act), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    try {
                        BiometricPrompt.CryptoObject co = result.getCryptoObject();
                        if (co == null || co.getCipher() == null) {
                            call.reject("Authentification sans clé cryptographique");
                            return;
                        }
                        onOk.done(co.getCipher());
                    } catch (Exception e) {
                        call.reject("Échec du déchiffrement biométrique : " + e.getMessage());
                    }
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                    boolean cancel = code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED;
                    call.reject(cancel ? "Annulé" : msg.toString(), cancel ? "cancel" : String.valueOf(code));
                }
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText(negative)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(false)
                    .build();
            bp.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    @PluginMethod
    public void biometricEnroll(PluginCall call) {
        final String key = call.getString("key", "");
        final String secret = call.getString("secret", "");
        String reason = availability();
        if (reason != null) {
            call.reject(reason);
            return;
        }
        final String a = alias(key);
        try {
            SecretKey k = createKey(a);
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.ENCRYPT_MODE, k);
            prompt(call, c, (cipher) -> {
                byte[] ct = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                prefs().edit()
                        .putString(a + "_ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                        .putString(a + "_iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                        .apply();
                call.resolve();
            });
        } catch (Exception e) {
            deleteKey(a);
            call.reject("Impossible de créer la clé biométrique : " + e.getMessage());
        }
    }

    @PluginMethod
    public void biometricUnlock(PluginCall call) {
        final String a = alias(call.getString("key", ""));
        String ct64 = prefs().getString(a + "_ct", null);
        String iv64 = prefs().getString(a + "_iv", null);
        if (ct64 == null || iv64 == null) {
            call.reject("Biométrie non configurée pour ce coffre.");
            return;
        }
        final byte[] ct = Base64.decode(ct64, Base64.NO_WRAP);
        try {
            SecretKey k = loadKey(a);
            if (k == null) throw new KeyPermanentlyInvalidatedException();
            Cipher c = Cipher.getInstance(TRANSFORM);
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(iv64, Base64.NO_WRAP)));
            prompt(call, c, (cipher) -> {
                byte[] plain = cipher.doFinal(ct);
                JSObject r = new JSObject();
                r.put("secret", new String(plain, StandardCharsets.UTF_8));
                java.util.Arrays.fill(plain, (byte) 0);
                call.resolve(r);
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            deleteKey(a);
            call.reject("La biométrie a changé (nouvelle empreinte ?) : clé invalidée. Déverrouille avec le mot de passe puis réactive-la.", "invalid");
        } catch (Exception e) {
            call.reject("Biométrie indisponible : " + e.getMessage());
        }
    }

    @PluginMethod
    public void biometricRemove(PluginCall call) {
        deleteKey(alias(call.getString("key", "")));
        call.resolve();
    }
}
