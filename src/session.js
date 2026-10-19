// Session : liste des coffres, déverrouillage (mot de passe, PIN, biométrie, clé de récupération),
// verrouillage automatique et sauvegardes chiffrées.

import { Vault, parseVaultFile, VaultFileError } from './core/vault.js';
import { deriveKey, seal, open, KDF_DEFAULT } from './core/crypto.js';
import { b64, fromB64, randomBytes, wipe, uuid, nowIso } from './core/util.js';
import { files, docs, biometric, clearClipboard, isNative } from './platform.js';
import { prefs, vaultPrefs } from './prefs.js';

const DIR = 'vaults';
const PIN_KDF = { alg: 'argon2id', t: 3, m: 32768, p: 1 };
const BACKUP_DIR = 'Sauvegardes';

const listeners = new Set();
const emit = (ev, data) => { for (const fn of listeners) fn(ev, data); };
const pinMemory = new Map(); // enveloppes PIN « non persistantes » (perdues au redémarrage)

let lastActivity = Date.now();
let pausedAt = 0;
let timer = null;

export const session = {
  vault: null,
  list: [],

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async refresh() {
    const names = (await files.list(DIR)).filter((n) => n.endsWith('.haiku'));
    const out = [];
    for (const n of names) {
      const text = await files.read(`${DIR}/${n}`);
      try {
        const f = parseVaultFile(text);
        out.push({ id: f.id, name: f.name, hint: f.hint || '', updatedAt: f.updatedAt, createdAt: f.createdAt, hasRecovery: !!f.recovery });
      } catch { /* fichier illisible ignoré */ }
    }
    out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    this.list = out;
    return out;
  },

  async readFile(id) {
    const t = await files.read(`${DIR}/${id}.haiku`);
    if (!t) throw new VaultFileError('Coffre introuvable.');
    return t;
  },

  attach(v) {
    v.onPersist = async (text) => {
      await files.write(`${DIR}/${v.id}.haiku`, text);
    };
    this.vault = v;
    prefs.set('security', { lastVault: v.id });
    lastActivity = Date.now();
    const days = prefs.s.trashDays;
    if (days) v.purgeTrash(days).catch(() => {});
    v.dirty = false;
    emit('unlock', v);
    armTimer();
    return v;
  },

  async create(opts) {
    const v = await Vault.create(opts);
    await files.write(`${DIR}/${v.id}.haiku`, await v.serialize());
    await this.refresh();
    return this.attach(v);
  },

  async unlockPassword(id, password) {
    const v = await Vault.unlock(await this.readFile(id), password);
    const p = vaultPrefs.get(id);
    if (p.pin) vaultPrefs.set(id, { pin: { ...p.pin, attempts: 0 } });
    return this.attach(v);
  },

  // ---- code PIN (comme Bitwarden : la clé de données est enveloppée par une clé dérivée du PIN) ----

  pinEnvelope(id) {
    return pinMemory.get(id) || vaultPrefs.get(id).pin || null;
  },

  async setPin(pin, persistent = true) {
    const v = this.vault;
    if (!/^\d{4,12}$/.test(pin)) throw new Error('Le code PIN doit contenir de 4 à 12 chiffres.');
    const salt = randomBytes(16);
    const k = await deriveKey(pin, salt, PIN_KDF);
    const env = { salt: b64(salt), kdf: PIN_KDF, box: await seal(k, v.dek, `haiku:pin:v1:${v.id}`), attempts: 0, length: pin.length, persistent };
    wipe(k);
    if (persistent) {
      vaultPrefs.set(v.id, { pin: env });
      pinMemory.delete(v.id);
    } else {
      vaultPrefs.set(v.id, { pin: null, pinVolatile: true });
      pinMemory.set(v.id, env);
    }
  },

  removePin(id = this.vault?.id) {
    pinMemory.delete(id);
    vaultPrefs.set(id, { pin: null, pinVolatile: false });
  },

  async unlockPin(id, pin) {
    const env = this.pinEnvelope(id);
    if (!env) throw new Error('Aucun code PIN pour ce coffre.');
    const k = await deriveKey(pin, fromB64(env.salt), env.kdf);
    let dek;
    try {
      dek = await open(k, env.box, `haiku:pin:v1:${id}`);
    } catch {
      env.attempts = (env.attempts || 0) + 1;
      const max = prefs.s.maxPinAttempts || 5;
      if (env.attempts >= max) {
        this.removePin(id);
        throw new Error(`Trop d'essais : le code PIN est désactivé. Déverrouille avec ton mot de passe maître.`);
      }
      if (env.persistent) vaultPrefs.set(id, { pin: env });
      throw new Error(`Code PIN incorrect (${max - env.attempts} essai${max - env.attempts > 1 ? 's' : ''} restant${max - env.attempts > 1 ? 's' : ''}).`);
    } finally {
      wipe(k);
    }
    env.attempts = 0;
    if (env.persistent) vaultPrefs.set(id, { pin: env });
    const v = await Vault.fromDek(await this.readFile(id), dek);
    return this.attach(v);
  },

  // ---- biométrie -----------------------------------------------------------------------

  async enableBiometric() {
    const v = this.vault;
    await biometric.enroll(`vault:${v.id}`, b64(v.dek));
    vaultPrefs.set(v.id, { bio: true });
  },

  async disableBiometric(id = this.vault?.id) {
    await biometric.remove(`vault:${id}`);
    vaultPrefs.set(id, { bio: false });
  },

  hasBiometric(id) {
    return isNative && !!vaultPrefs.get(id).bio;
  },

  async unlockBiometric(id) {
    const secret = await biometric.unlock(`vault:${id}`);
    const v = await Vault.fromDek(await this.readFile(id), fromB64(secret));
    return this.attach(v);
  },

  // ---- mot de passe oublié ----------------------------------------------------------------

  async recover(id, key, newPassword) {
    const { vault, recoveryKey } = await Vault.recover(await this.readFile(id), key, newPassword);
    await files.write(`${DIR}/${vault.id}.haiku`, JSON.stringify(vault.file));
    this.attach(vault);
    return recoveryKey;
  },

  // ---- verrouillage ------------------------------------------------------------------------

  async lock(reason = 'manual') {
    const v = this.vault;
    if (!v) return;
    clearTimeout(timer);
    if (v.dirty && prefs.s.autoBackup) await this.backup(v, 'auto').catch((e) => console.warn('backup', e));
    clearClipboard().catch(() => {});
    v.lock();
    this.vault = null;
    emit('lock', { reason });
  },

  activity() {
    lastActivity = Date.now();
  },

  onPause() {
    pausedAt = Date.now();
    if (this.vault && prefs.s.lockOnBackground && prefs.s.lockAfter === 0) this.lock('background');
  },

  onResume() {
    if (!this.vault) return;
    const after = prefs.s.lockAfter;
    if (prefs.s.lockOnBackground && after > 0 && pausedAt && Date.now() - pausedAt >= after * 1000) this.lock('timeout');
    pausedAt = 0;
    lastActivity = Date.now();
  },

  // ---- sauvegardes -------------------------------------------------------------------------

  async backup(v = this.vault, kind = 'manuelle') {
    const text = v.dek ? await v.serialize() : JSON.stringify(v.file);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const safe = v.name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'coffre';
    const name = `${safe}_${v.id.slice(0, 8)}_${stamp}_${kind}.haiku`;
    const r = await docs.write(BACKUP_DIR, name, text);
    if (kind === 'auto') await this.pruneBackups(v.id);
    v.dirty = false;
    return r;
  },

  async listBackups() {
    const list = await docs.list(BACKUP_DIR);
    return list.filter((f) => f.name.endsWith('.haiku')).map((f) => {
      const m = /^(.*)_([0-9a-f]{8})_(\d{8}-\d{6})_(\w+)\.haiku$/.exec(f.name);
      return { ...f, vaultShort: m?.[2] || '', kind: m?.[4] || '?', label: m?.[1]?.replace(/-/g, ' ') || f.name, date: m ? `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}T${m[3].slice(9, 11)}:${m[3].slice(11, 13)}:${m[3].slice(13, 15)}` : null };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  async pruneBackups(vaultId) {
    const keep = prefs.s.backupKeep || 10;
    const all = (await this.listBackups()).filter((b) => b.vaultShort === vaultId.slice(0, 8) && b.kind === 'auto');
    for (const b of all.slice(keep)) await docs.remove(BACKUP_DIR, b.name, b.directory).catch(() => {});
  },

  async readBackup(b) {
    return docs.read(BACKUP_DIR, b.name, b.directory);
  },

  async deleteBackup(b) {
    return docs.remove(BACKUP_DIR, b.name, b.directory);
  },

  /**
   * Restaure un fichier de coffre (sauvegarde ou .haiku d'un autre téléphone) comme NOUVEAU coffre :
   * rien n'est écrasé. Il faut le mot de passe maître en vigueur au moment de la sauvegarde.
   */
  async restoreVaultFile(text, password) {
    const src = await Vault.unlock(text, password);
    const copy = await Vault.create({ name: `${src.name} (restauré ${new Date().toLocaleDateString('fr-FR')})`, password, kdf: src.file.kdf, folders: false });
    copy.data = src.data;
    copy.data.name = copy.name;
    copy.file.hint = src.file.hint;
    src.lock();
    await files.write(`${DIR}/${copy.id}.haiku`, await copy.serialize());
    await this.refresh();
    return copy.id;
  },

  async deleteVault(id, password) {
    const v = await Vault.unlock(await this.readFile(id), password);
    v.lock();
    if (this.vault?.id === id) await this.lock('deleted');
    await files.remove(`${DIR}/${id}.haiku`);
    await biometric.remove(`vault:${id}`);
    pinMemory.delete(id);
    vaultPrefs.clear(id);
    await this.refresh();
  },
};

function armTimer() {
  clearTimeout(timer);
  const tick = () => {
    if (!session.vault) return;
    const after = prefs.s.lockAfter;
    if (after > 0 && Date.now() - lastActivity >= after * 1000) {
      session.lock('timeout');
      return;
    }
    timer = setTimeout(tick, 5000);
  };
  timer = setTimeout(tick, 5000);
}

export { KDF_DEFAULT, uuid, nowIso };
