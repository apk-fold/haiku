// Ajustements du projet Android généré par Capacitor (idempotent, à relancer sans risque) :
//  - nom « Haiku », icône, fond sombre au lancement (pas de flash blanc)
//  - plugin natif HaikuNative (biométrie Keystore, écran sécurisé, presse-papiers sensible)
//  - permissions : caméra (scanner les QR 2FA), stockage sur les anciens Android (sauvegardes)
//  - pas de sauvegarde automatique des données de l'appli par Android (allowBackup=false)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'android');
const log = (m) => console.log('[patch] ' + m);
if (!existsSync(root)) {
  log('Dossier android/ absent : lance d\'abord "npm run android:add".');
  process.exit(0);
}
const main = join(root, 'app/src/main');

// 1. Fichiers natifs (MainActivity, plugin, icônes)
const extra = join(process.cwd(), 'scripts/android-extra');
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name));
    else copyFileSync(join(from, e.name), join(to, e.name));
  }
};
copyTree(join(extra, 'java'), join(main, 'java'));
copyTree(join(extra, 'res'), join(main, 'res'));
log('MainActivity, plugin HaikuNative et icônes copiés.');

// 2. Manifest
const manifestPath = join(main, 'AndroidManifest.xml');
let x = readFileSync(manifestPath, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.USE_BIOMETRIC" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
const missing = perms.filter((p) => !x.includes(p.match(/name="([^"]+)"/)[1] + '"'));
if (missing.length) {
  x = x.replace('<application', missing.join('\n    ') + '\n\n    <application');
  log('Permissions ajoutées : ' + missing.length + '.');
}
x = x.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
if (!x.includes('android:allowBackup')) x = x.replace('<application', '<application\n        android:allowBackup="false"');
if (!x.includes('android:fullBackupContent')) x = x.replace('<application', '<application\n        android:fullBackupContent="false"');
if (!x.includes('requestLegacyExternalStorage')) x = x.replace('<application', '<application\n        android:requestLegacyExternalStorage="true"');
if (!x.includes('windowSoftInputMode')) x = x.replace(/(<activity[^>]*android:name="\.MainActivity")/, '$1\n            android:windowSoftInputMode="adjustResize"');
if (!x.includes('.HaikuAutofillService')) {
  x = x.replace(/(\n\s*<\/application>)/, `

        <!-- remplissage automatique : service Android + écran de déverrouillage dédié -->
        <service
            android:name=".HaikuAutofillService"
            android:label="Haiku"
            android:exported="true"
            android:permission="android.permission.BIND_AUTOFILL_SERVICE">
            <intent-filter>
                <action android:name="android.service.autofill.AutofillService" />
            </intent-filter>
            <meta-data android:name="android.autofill" android:resource="@xml/haiku_autofill" />
        </service>
        <activity
            android:name=".AutofillActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:taskAffinity="fr.apkfold.haiku.autofill"
            android:launchMode="standard"
            android:theme="@style/AppTheme.NoActionBar"
            android:windowSoftInputMode="adjustResize"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density" />$1`);
  log('Manifest : service de remplissage automatique déclaré.');
}
writeFileSync(manifestPath, x);
log('Manifest : sauvegarde Android désactivée, clavier en adjustResize.');

// 3. Couleurs et thèmes de lancement sombres
writeFileSync(join(main, 'res/values/haiku_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="haiku_black">#07050D</color>\n</resources>\n');
const stylesPath = join(main, 'res/values/styles.xml');
if (existsSync(stylesPath)) {
  let s = readFileSync(stylesPath, 'utf8');
  s = s.replace(/@drawable\/splash/g, '@color/haiku_black');
  const themeRe = /<style name="AppTheme\.NoActionBar"[^>]*>[\s\S]*?<\/style>/;
  const m = s.match(themeRe);
  if (m) {
    const names = ['android:windowBackground', 'android:statusBarColor', 'android:navigationBarColor', 'android:windowLightStatusBar', 'android:windowLightNavigationBar', 'android:enforceStatusBarContrast', 'android:enforceNavigationBarContrast'];
    let blk = m[0].split('\n').filter((l) => !names.some((n) => l.includes(`name="${n}"`))).join('\n');
    blk = blk.replace(/(<style name="AppTheme\.NoActionBar"[^>]*>)/, `$1
        <item name="android:windowBackground">@color/haiku_black</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@color/haiku_black</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:enforceStatusBarContrast">false</item>
        <item name="android:enforceNavigationBarContrast">false</item>`);
    s = s.replace(themeRe, () => blk);
  }
  if (!s.includes('windowSplashScreenBackground')) s = s.replace(/(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">@color/haiku_black</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>');
  writeFileSync(stylesPath, s);
  log('Thèmes sombres appliqués.');
}

// 4. Nom de l'appli
const stringsPath = join(main, 'res/values/strings.xml');
if (existsSync(stringsPath)) {
  let t = readFileSync(stringsPath, 'utf8');
  t = t.replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1Haiku$2').replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, '$1Haiku$2');
  writeFileSync(stringsPath, t);
}

// 5. Dépendances Gradle (biométrie)
const gradlePath = join(root, 'app/build.gradle');
let g = readFileSync(gradlePath, 'utf8');
if (!g.includes('androidx.biometric:biometric')) {
  g = g.replace(/dependencies \{/, 'dependencies {\n    implementation "androidx.biometric:biometric:1.1.0"');
  writeFileSync(gradlePath, g);
  log('androidx.biometric ajouté à Gradle.');
}

// 6. Signature stable (même clé à chaque compilation : les mises à jour s'installent par-dessus,
//    sans désinstaller ni perdre le coffre). Clé du dépôt par défaut, ou secrets HAIKU_KEYSTORE_* en CI.
g = readFileSync(gradlePath, 'utf8');
if (!g.includes('signingConfigs')) {
  g = g.replace(/android \{/, `android {
    signingConfigs {
        haiku {
            storeFile file(System.getenv("HAIKU_KEYSTORE_PATH") ?: "\${rootDir}/../signing/haiku.jks")
            storePassword System.getenv("HAIKU_KEYSTORE_PASSWORD") ?: "haiku-apk-fold"
            keyAlias System.getenv("HAIKU_KEY_ALIAS") ?: "haiku"
            keyPassword System.getenv("HAIKU_KEY_PASSWORD") ?: "haiku-apk-fold"
        }
    }`);
  g = g.replace(/buildTypes \{\s*release \{/, `buildTypes {
        debug {
            signingConfig signingConfigs.haiku
        }
        release {
            signingConfig signingConfigs.haiku`);
  writeFileSync(gradlePath, g);
  log('Signature Haiku configurée (debug et release).');
}

// 7. Numéro de version (GitHub Actions : numéro de compilation)
const build = process.env.HAIKU_BUILD;
if (build && /^\d+$/.test(build)) {
  g = readFileSync(gradlePath, 'utf8');
  g = g.replace(/versionCode \d+/, `versionCode ${build}`).replace(/versionName "[^"]*"/, `versionName "1.${build}"`);
  writeFileSync(gradlePath, g);
  log(`Version 1.${build}.`);
}

log('OK.');
