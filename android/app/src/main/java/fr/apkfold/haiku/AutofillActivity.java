package fr.apkfold.haiku;

import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.view.autofill.AutofillId;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

import java.util.ArrayList;

/**
 * Écran ouvert par le système quand on choisit « Remplir avec Haiku » (ou pour enregistrer un
 * identifiant saisi ailleurs). Il charge la même interface que l'appli, en mode remplissage.
 */
public class AutofillActivity extends BridgeActivity {

    static volatile JSObject pending = null;
    static ArrayList<AutofillId> userIds = new ArrayList<>();
    static ArrayList<AutofillId> passIds = new ArrayList<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HaikuNativePlugin.class);
        capture(getIntent());
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        capture(intent);
    }

    @SuppressWarnings("deprecation")
    private void capture(Intent in) {
        if (in == null) return;
        JSObject r = new JSObject();
        r.put("mode", in.getStringExtra(HaikuAutofillService.EXTRA_MODE));
        r.put("packageName", in.getStringExtra(HaikuAutofillService.EXTRA_PKG));
        r.put("webDomain", in.getStringExtra(HaikuAutofillService.EXTRA_DOMAIN));
        r.put("username", in.getStringExtra(HaikuAutofillService.EXTRA_USER));
        r.put("password", in.getStringExtra(HaikuAutofillService.EXTRA_PASS));
        ArrayList<AutofillId> u = in.getParcelableArrayListExtra(HaikuAutofillService.EXTRA_USER_IDS);
        ArrayList<AutofillId> p = in.getParcelableArrayListExtra(HaikuAutofillService.EXTRA_PASS_IDS);
        userIds = u != null ? u : new ArrayList<>();
        passIds = p != null ? p : new ArrayList<>();
        r.put("userFields", userIds.size());
        r.put("passFields", passIds.size());
        pending = r;
    }

    @Override
    public void onDestroy() {
        pending = null;
        super.onDestroy();
    }
}
