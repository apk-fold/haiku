// Couche plateforme : Android (Capacitor + plugin natif HaikuNative) ou navigateur (développement).
// Tout ce qui touche au système passe par ici : fichiers, presse-papiers, biométrie, écran sécurisé,
// partage, vibrations, cycle de vie de l'appli.

export const isNative = !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

let mods = null;
async function cap() {
  if (!mods) {
    const [core, fs, share, haptics, app, status] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
      import('@capacitor/haptics'),
      import('@capacitor/app'),
      import('@capacitor/status-bar'),
    ]);
    mods = {
      core,
      Filesystem: fs.Filesystem,
      Directory: fs.Directory,
      Encoding: fs.Encoding,
      Share: share.Share,
      Haptics: haptics.Haptics,
      ImpactStyle: haptics.ImpactStyle,
      NotificationType: haptics.NotificationType,
      App: app.App,
      StatusBar: status.StatusBar,
      Style: status.Style,
      Native: core.registerPlugin('HaikuNative'),
    };
  }
  return mods;
}

// ---- petit magasin IndexedDB (navigateur) ----------------------------------------------

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('haiku', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// ---- fichiers privés de l'appli (coffres) ------------------------------------------------

export const files = {
  async read(path) {
    if (!isNative) return idbOp('readonly', (s) => s.get(path)).then((v) => v ?? null);
    const { Filesystem, Directory, Encoding } = await cap();
    try {
      const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      return r.data;
    } catch {
      return null;
    }
  },
  async write(path, text) {
    if (!isNative) return idbOp('readwrite', (s) => s.put(text, path));
    const { Filesystem, Directory, Encoding } = await cap();
    // Écriture atomique : fichier temporaire puis renommage.
    const tmp = `${path}.tmp`;
    await Filesystem.writeFile({ path: tmp, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* absent */ }
    await Filesystem.rename({ from: tmp, to: path, directory: Directory.Data, toDirectory: Directory.Data });
  },
  async remove(path) {
    if (!isNative) return idbOp('readwrite', (s) => s.delete(path));
    const { Filesystem, Directory } = await cap();
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* absent */ }
  },
  async list(dir) {
    if (!isNative) {
      const keys = (await idbOp('readonly', (s) => s.getAllKeys())) || [];
      return keys.filter((k) => String(k).startsWith(dir + '/')).map((k) => String(k).slice(dir.length + 1));
    }
    const { Filesystem, Directory } = await cap();
    try {
      const r = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      return r.files.map((f) => (typeof f === 'string' ? f : f.name));
    } catch {
      return [];
    }
  },
};

// ---- dossier public Documents/Haiku (sauvegardes, exports) ---------------------------------

export const docs = {
  async write(sub, name, text) {
    if (!isNative) {
      download(name, text);
      return { path: name, uri: null, where: 'Téléchargements' };
    }
    const { Filesystem, Directory, Encoding } = await cap();
    const path = `Haiku/${sub ? sub + '/' : ''}${name}`;
    try {
      const r = await Filesystem.writeFile({ path, data: text, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      return { path, uri: r.uri, where: `Documents/${path}` };
    } catch {
      // Repli : stockage privé de l'appli
      const r = await Filesystem.writeFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
      return { path, uri: r.uri, where: 'stockage interne de Haiku', private: true };
    }
  },
  async list(sub) {
    if (!isNative) return [];
    const { Filesystem, Directory } = await cap();
    for (const directory of [Directory.Documents, Directory.Data]) {
      try {
        const r = await Filesystem.readdir({ path: `Haiku/${sub}`, directory });
        return r.files.map((f) => ({ name: f.name, size: f.size, mtime: f.mtime, uri: f.uri, directory }));
      } catch { /* suivant */ }
    }
    return [];
  },
  async read(sub, name, directory) {
    const { Filesystem, Directory, Encoding } = await cap();
    const r = await Filesystem.readFile({ path: `Haiku/${sub}/${name}`, directory: directory || Directory.Documents, encoding: Encoding.UTF8 });
    return r.data;
  },
  async remove(sub, name, directory) {
    const { Filesystem, Directory } = await cap();
    await Filesystem.deleteFile({ path: `Haiku/${sub}/${name}`, directory: directory || Directory.Documents });
  },
};

function download(name, text, mime = 'application/octet-stream') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Partage un contenu texte comme fichier (feuille de partage Android), puis supprime la copie temporaire. */
export async function shareFile(name, text, title = 'Haiku') {
  if (!isNative) {
    download(name, text);
    return true;
  }
  const { Filesystem, Directory, Encoding, Share } = await cap();
  const r = await Filesystem.writeFile({ path: `share/${name}`, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  try {
    await Share.share({ title, files: [r.uri], dialogTitle: title });
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => Filesystem.deleteFile({ path: `share/${name}`, directory: Directory.Cache }).catch(() => {}), 60000);
  }
}

export async function shareText(text, title = 'Haiku') {
  if (!isNative) {
    if (navigator.share) return navigator.share({ title, text }).then(() => true, () => false);
    await copyText(text, false);
    return true;
  }
  const { Share } = await cap();
  try { await Share.share({ title, text }); return true; } catch { return false; }
}

export async function saveBlob(name, base64, mime) {
  if (!isNative) {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    download(name, new Blob([bin], { type: mime }));
    return { where: 'Téléchargements' };
  }
  const { Filesystem, Directory, Share } = await cap();
  const r = await Filesystem.writeFile({ path: `share/${name}`, data: base64, directory: Directory.Cache, recursive: true });
  try { await Share.share({ title: name, files: [r.uri] }); } catch { /* annulé */ }
  setTimeout(() => Filesystem.deleteFile({ path: `share/${name}`, directory: Directory.Cache }).catch(() => {}), 60000);
  return { where: 'partage' };
}

// ---- presse-papiers ------------------------------------------------------------------

let clipTimer = null;
let lastClip = null;

export async function copyText(text, sensitive = true, clearAfter = 0) {
  if (isNative) {
    const { Native } = await cap();
    try {
      await Native.copy({ text: String(text), sensitive, label: 'Haiku' });
    } catch {
      await navigator.clipboard?.writeText(String(text));
    }
  } else {
    await navigator.clipboard?.writeText(String(text)).catch(() => fallbackCopy(String(text)));
  }
  lastClip = String(text);
  clearTimeout(clipTimer);
  if (sensitive && clearAfter > 0) clipTimer = setTimeout(() => clearClipboard(), clearAfter * 1000);
}

function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export async function clearClipboard() {
  clearTimeout(clipTimer);
  if (lastClip == null) return;
  lastClip = null;
  if (isNative) {
    const { Native } = await cap();
    await Native.clearClipboard().catch(() => {});
  } else {
    await navigator.clipboard?.writeText('').catch(() => {});
  }
}

// ---- biométrie (clé Android Keystore liée à l'empreinte / au visage) ----------------------

export const biometric = {
  async status() {
    if (!isNative) return { available: false, reason: 'Disponible seulement dans l\'appli Android.' };
    const { Native } = await cap();
    try { return await Native.biometricStatus(); } catch (e) { return { available: false, reason: e.message }; }
  },
  async enroll(key, secret) {
    const { Native } = await cap();
    return Native.biometricEnroll({ key, secret, title: 'Activer le déverrouillage biométrique', subtitle: 'Haiku', negative: 'Annuler' });
  },
  async unlock(key) {
    const { Native } = await cap();
    const r = await Native.biometricUnlock({ key, title: 'Déverrouiller Haiku', subtitle: 'Touche le capteur ou regarde l\'écran', negative: 'Mot de passe' });
    return r.secret;
  },
  async remove(key) {
    if (!isNative) return;
    const { Native } = await cap();
    await Native.biometricRemove({ key }).catch(() => {});
  },
  async has(key) {
    if (!isNative) return false;
    const { Native } = await cap();
    try { return (await Native.biometricHas({ key })).enrolled; } catch { return false; }
  },
};

// ---- écran, vibrations, barres système ----------------------------------------------------

export async function setSecureScreen(on) {
  if (!isNative) return;
  const { Native } = await cap();
  await Native.setSecure({ enabled: !!on }).catch(() => {});
}

let hapticsOn = true;
export const setHaptics = (on) => { hapticsOn = !!on; };

export async function haptic(kind = 'light') {
  if (!hapticsOn) return;
  if (!isNative) {
    navigator.vibrate?.(kind === 'heavy' ? 30 : kind === 'error' ? [20, 40, 20] : 8);
    return;
  }
  const { Haptics, ImpactStyle, NotificationType } = await cap();
  try {
    if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
    else if (kind === 'error') await Haptics.notification({ type: NotificationType.Error });
    else if (kind === 'warning') await Haptics.notification({ type: NotificationType.Warning });
    else if (kind === 'select') await Haptics.selectionChanged();
    else await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch { /* pas de vibreur */ }
}

export async function setSystemBars(dark, color) {
  if (!isNative) {
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', color);
    return;
  }
  const { StatusBar, Style, Native } = await cap();
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch { /* ancien Android */ }
  await Native.setBars({ dark: !!dark, color }).catch(() => {});
}

/** Abonnements au cycle de vie : pause (arrière-plan), resume, bouton retour. */
export async function onLifecycle({ pause, resume, back }) {
  if (!isNative) {
    document.addEventListener('visibilitychange', () => (document.hidden ? pause?.() : resume?.()));
    return;
  }
  const { App } = await cap();
  App.addListener('pause', () => pause?.());
  App.addListener('resume', () => resume?.());
  App.addListener('backButton', (e) => back?.(e));
}

export async function exitApp() {
  if (!isNative) return;
  const { App } = await cap();
  App.exitApp();
}

export async function openUrl(url) {
  let u = String(url || '').trim();
  if (!u) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`;
  if (!/^https?:/i.test(u)) return;
  if (isNative) {
    const { Native } = await cap();
    try { await Native.openUrl({ url: u }); return; } catch { /* repli */ }
  }
  window.open(u, '_blank', 'noopener');
}

export async function appInfo() {
  if (!isNative) return { version: 'web', build: '' };
  const { App } = await cap();
  try { return await App.getInfo(); } catch { return { version: '?', build: '' }; }
}
