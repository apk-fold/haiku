package fr.apkfold.haiku;

import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.content.Intent;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveInfo;
import android.service.autofill.SaveRequest;
import android.text.InputType;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Service de remplissage automatique d'Android.
 * Haiku ne garde aucun secret en clair : la réponse proposée est « Remplir avec Haiku », qui ouvre
 * l'écran de déverrouillage (AutofillActivity) ; l'identifiant choisi y est renvoyé au système.
 */
@RequiresApi(api = Build.VERSION_CODES.O)
public class HaikuAutofillService extends AutofillService {

    static final String EXTRA_MODE = "haiku_mode";
    static final String EXTRA_PKG = "haiku_pkg";
    static final String EXTRA_DOMAIN = "haiku_domain";
    static final String EXTRA_USER_IDS = "haiku_user_ids";
    static final String EXTRA_PASS_IDS = "haiku_pass_ids";
    static final String EXTRA_USER = "haiku_user";
    static final String EXTRA_PASS = "haiku_pass";

    static class Parsed {
        String domain;
        String scheme;
        final ArrayList<AutofillId> user = new ArrayList<>();
        final ArrayList<AutofillId> pass = new ArrayList<>();
        String userValue;
        String passValue;
    }

    private static final String[] PASS_WORDS = {"password", "passwd", "pass", "pwd", "motdepasse", "mot de passe", "mot_de_passe", "mdp", "secret", "pin"};
    private static final String[] USER_WORDS = {"user", "login", "email", "e-mail", "mail", "identifiant", "utilisateur", "pseudo", "account", "compte", "phone", "username"};

    private static boolean has(String text, String[] words) {
        if (text == null) return false;
        String t = text.toLowerCase(Locale.ROOT);
        for (String w : words) if (t.contains(w)) return true;
        return false;
    }

    /** 2 = mot de passe, 1 = identifiant, 0 = autre. */
    private static int classify(AssistStructure.ViewNode n) {
        String[] hints = n.getAutofillHints();
        if (hints != null) {
            for (String h : hints) {
                if (h == null) continue;
                String l = h.toLowerCase(Locale.ROOT);
                if (l.contains("password")) return 2;
                if (l.contains("username") || l.contains("email") || l.contains("phone") || l.contains("login")) return 1;
            }
        }
        ViewStructure.HtmlInfo html = n.getHtmlInfo();
        if (html != null) {
            if (!"input".equalsIgnoreCase(html.getTag())) return 0;
            List<Pair<String, String>> attrs = html.getAttributes();
            String type = "";
            StringBuilder names = new StringBuilder();
            if (attrs != null) {
                for (Pair<String, String> a : attrs) {
                    if (a == null || a.first == null) continue;
                    String k = a.first.toLowerCase(Locale.ROOT);
                    String v = a.second == null ? "" : a.second.toLowerCase(Locale.ROOT);
                    if (k.equals("type")) type = v;
                    if (k.equals("name") || k.equals("id") || k.equals("autocomplete") || k.equals("placeholder") || k.equals("aria-label")) names.append(' ').append(v);
                }
            }
            if (type.equals("password")) return 2;
            if (type.equals("hidden") || type.equals("submit") || type.equals("checkbox") || type.equals("radio") || type.equals("button") || type.equals("search")) return 0;
            if (type.equals("email") || has(names.toString(), USER_WORDS)) return 1;
            return 0;
        }
        int it = n.getInputType();
        int cls = it & InputType.TYPE_MASK_CLASS;
        int variation = it & InputType.TYPE_MASK_VARIATION;
        if (cls == InputType.TYPE_CLASS_TEXT && (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)) return 2;
        if (cls == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return 2;
        if (cls == InputType.TYPE_CLASS_TEXT && (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS)) return 1;
        String text = (n.getIdEntry() == null ? "" : n.getIdEntry()) + " " + (n.getHint() == null ? "" : n.getHint());
        if (has(text, PASS_WORDS)) return 2;
        if (cls == InputType.TYPE_CLASS_TEXT && has(text, USER_WORDS)) return 1;
        return 0;
    }

    private static void walk(AssistStructure.ViewNode n, Parsed p) {
        if (n == null) return;
        if (p.domain == null && n.getWebDomain() != null && !n.getWebDomain().isEmpty()) {
            p.domain = n.getWebDomain();
            if (Build.VERSION.SDK_INT >= 28 && n.getWebScheme() != null) p.scheme = n.getWebScheme();
        }
        AutofillId id = n.getAutofillId();
        if (id != null && n.getAutofillType() == View.AUTOFILL_TYPE_TEXT && n.getVisibility() == View.VISIBLE) {
            int kind = classify(n);
            AutofillValue val = n.getAutofillValue();
            String text = val != null && val.isText() ? val.getTextValue().toString() : null;
            if (kind == 2) {
                p.pass.add(id);
                if (p.passValue == null && text != null && !text.isEmpty()) p.passValue = text;
            } else if (kind == 1) {
                p.user.add(id);
                if (p.userValue == null && text != null && !text.isEmpty()) p.userValue = text;
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChildAt(i), p);
    }

    static Parsed parse(AssistStructure s) {
        Parsed p = new Parsed();
        for (int i = 0; i < s.getWindowNodeCount(); i++) walk(s.getWindowNodeAt(i).getRootViewNode(), p);
        return p;
    }

    private Intent baseIntent(String mode, String pkg, Parsed p) {
        Intent i = new Intent(this, AutofillActivity.class);
        i.putExtra(EXTRA_MODE, mode);
        i.putExtra(EXTRA_PKG, pkg);
        if (p.domain != null) i.putExtra(EXTRA_DOMAIN, p.domain);
        return i;
    }

    @Override
    public void onFillRequest(@NonNull FillRequest request, @NonNull CancellationSignal cancellationSignal, @NonNull FillCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            AssistStructure s = contexts.get(contexts.size() - 1).getStructure();
            String pkg = s.getActivityComponent().getPackageName();
            Parsed p = parse(s);
            if (getPackageName().equals(pkg) || (p.pass.isEmpty() && p.user.isEmpty())) {
                callback.onSuccess(null);
                return;
            }
            ArrayList<AutofillId> all = new ArrayList<>(p.user);
            all.addAll(p.pass);
            Intent i = baseIntent("fill", pkg, p);
            i.putParcelableArrayListExtra(EXTRA_USER_IDS, p.user);
            i.putParcelableArrayListExtra(EXTRA_PASS_IDS, p.pass);
            int flags = PendingIntent.FLAG_CANCEL_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(this, 4201, i, flags);
            RemoteViews rv = new RemoteViews(getPackageName(), R.layout.haiku_autofill_item);
            rv.setTextViewText(R.id.haiku_af_text, "Remplir avec Haiku");
            FillResponse.Builder b = new FillResponse.Builder();
            b.setAuthentication(all.toArray(new AutofillId[0]), pi.getIntentSender(), rv);
            if (!p.pass.isEmpty()) {
                int type = SaveInfo.SAVE_DATA_TYPE_PASSWORD | (p.user.isEmpty() ? 0 : SaveInfo.SAVE_DATA_TYPE_USERNAME);
                SaveInfo.Builder sb = new SaveInfo.Builder(type, p.pass.toArray(new AutofillId[0]));
                if (!p.user.isEmpty()) sb.setOptionalIds(p.user.toArray(new AutofillId[0]));
                b.setSaveInfo(sb.build());
            }
            callback.onSuccess(b.build());
        } catch (Exception e) {
            callback.onSuccess(null);
        }
    }

    @Override
    public void onSaveRequest(@NonNull SaveRequest request, @NonNull SaveCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            AssistStructure s = contexts.get(contexts.size() - 1).getStructure();
            String pkg = s.getActivityComponent().getPackageName();
            Parsed p = parse(s);
            Intent i = baseIntent("save", pkg, p);
            if (p.userValue != null) i.putExtra(EXTRA_USER, p.userValue);
            if (p.passValue != null) i.putExtra(EXTRA_PASS, p.passValue);
            if (Build.VERSION.SDK_INT >= 28) {
                int flags = PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE;
                PendingIntent pi = PendingIntent.getActivity(this, 4202, i, flags);
                callback.onSuccess(pi.getIntentSender());
            } else {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                callback.onSuccess();
            }
        } catch (Exception e) {
            callback.onFailure("Haiku : enregistrement impossible");
        }
    }
}
