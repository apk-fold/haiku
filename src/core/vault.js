// Le coffre : format de fichier, ouverture, enregistrement et toutes les opérations sur les éléments.
//
// Fichier « .haiku » (JSON) :
//   { format, version, id, name, hint, kdf, salt,
//     key:      AES-GCM(KEK, DEK)                  ← KEK = Argon2id(mot de passe maître, sel)
//     recovery: { kdf, salt, key: AES-GCM(RK, DEK) } (facultatif, clé de récupération)
//     data:     AES-GCM(DEK, gzip(JSON du coffre)) }
// Le nom (et l'indice facultatif) du coffre restent lisibles : ils s'affichent sur l'écran de verrouillage.
// Tout le reste — éléments, dossiers, étiquettes, historique — est chiffré.

import { KDF_DEFAULT, checkKdf, deriveKey, seal, open, gzip, gunzip, canCompress, AuthError } from './crypto.js';
import { utf8, fromUtf8, b64, fromB64, randomBytes, uuid, nowIso, wipe, deepClone, norm } from './util.js';
import { normalizeItem, mainPassword, blankItem } from './schema.js';
import { normalizeTags, tagKey } from './tags.js';
import { generateRecoveryKey, parseRecoveryKey } from './recovery.js';

export const FORMAT = 'haiku-vault';
export const VERSION = 1;
export const MIN_MASTER_LENGTH = 8;
export const MAX_HISTORY = 20; // versions conservées par élément (Keyra)
export const MAX_PASSWORD_HISTORY = 10; // anciens mots de passe (Bitwarden)
export const MAX_GEN_HISTORY = 100;

export const DEFAULT_FOLDERS = ['Personnel', 'Travail', 'Finances', 'Réseaux sociaux', 'E-mail', 'Achats'];

const aad = (kind, id) => `haiku:${kind}:v1:${id}`;

export class VaultFileError extends Error {}

export function parseVaultFile(text) {
  let f;
  try {
    f = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new VaultFileError("Ce fichier n'est pas un coffre Haiku lisible.");
  }
  if (!f || f.format !== FORMAT) throw new VaultFileError("Ce fichier n'est pas un coffre Haiku.");
  if (f.version !== VERSION) throw new VaultFileError('Version de coffre non prise en charge.');
  if (!f.id || !f.salt || !f.key || !f.data) throw new VaultFileError('Coffre incomplet ou corrompu.');
  checkKdf(f.kdf);
  return f;
}

async function encryptData(dek, id, data) {
  let bytes = utf8(JSON.stringify(data));
  let z = null;
  if (canCompress) {
    bytes = await gzip(bytes);
    z = 'gzip';
  }
  const box = await seal(dek, bytes, aad('data', id));
  return { ...box, z };
}

async function decryptData(dek, file) {
  let bytes = await open(dek, file.data, aad('data', file.id));
  if (file.data.z === 'gzip') bytes = await gunzip(bytes);
  return JSON.parse(fromUtf8(bytes));
}

function emptyData(name, withFolders = true) {
  const t = nowIso();
  return {
    v: 1,
    name,
    createdAt: t,
    updatedAt: t,
    folders: withFolders ? DEFAULT_FOLDERS.map((n) => ({ id: uuid(), name: n })) : [],
    items: [],
    genHistory: [],
    sends: [],
  };
}

export class Vault {
  constructor(file, dek, data) {
    this.file = file; // en-tête + blocs chiffrés (sans la donnée en clair)
    this.dek = dek; // Uint8Array(32)
    this.data = data;
    this.dirty = false; // modifié depuis l'ouverture (sauvegarde auto au verrouillage)
    this.listeners = new Set();
    this.onPersist = null; // (file) => Promise — branché par le stockage
  }

  get id() { return this.file.id; }
  get name() { return this.file.name; }

  // ---- création / ouverture ----------------------------------------------------------

  static async create({ name, password, hint = '', kdf = KDF_DEFAULT, folders = true }) {
    if (!password || password.length < MIN_MASTER_LENGTH) throw new Error(`Le mot de passe maître doit contenir au moins ${MIN_MASTER_LENGTH} caractères.`);
    const id = uuid();
    const salt = randomBytes(16);
    const k = checkKdf(kdf);
    const kek = await deriveKey(password, salt, k);
    const dek = randomBytes(32);
    const t = nowIso();
    const file = {
      format: FORMAT,
      version: VERSION,
      id,
      name: String(name || 'Mon coffre').slice(0, 60),
      hint: String(hint || '').slice(0, 120),
      createdAt: t,
      updatedAt: t,
      kdf: k,
      salt: b64(salt),
      key: await seal(kek, dek, aad('key', id)),
      recovery: null,
      data: null,
    };
    wipe(kek);
    const v = new Vault(file, dek, emptyData(file.name, folders));
    file.data = await encryptData(dek, id, v.data);
    return v;
  }

  static async unlock(fileOrText, password) {
    const file = parseVaultFile(fileOrText);
    const kek = await deriveKey(password, fromB64(file.salt), file.kdf);
    let dek;
    try {
      dek = await open(kek, file.key, aad('key', file.id));
    } catch (e) {
      if (e instanceof AuthError) throw new AuthError('Mot de passe maître incorrect.');
      throw e;
    } finally {
      wipe(kek);
    }
    return Vault.fromDek(file, dek);
  }

  /** Ouverture avec la clé de données déjà connue (code PIN, biométrie). */
  static async fromDek(fileOrText, dek) {
    const file = parseVaultFile(fileOrText);
    const data = await decryptData(dek, file);
    const v = new Vault(file, dek, data);
    v.migrate();
    return v;
  }

  /** Mot de passe oublié : clé de récupération + nouveau mot de passe → nouvelle enveloppe et NOUVELLE clé. */
  static async recover(fileOrText, recoveryKey, newPassword) {
    const file = parseVaultFile(fileOrText);
    if (!file.recovery) throw new Error("Ce coffre n'a pas de clé de récupération.");
    const canon = await parseRecoveryKey(recoveryKey);
    if (!canon) throw new Error('Clé de récupération invalide (vérifie la saisie).');
    const rk = await deriveKey(canon.replace(/-/g, ''), fromB64(file.recovery.salt), file.recovery.kdf);
    let dek;
    try {
      dek = await open(rk, file.recovery.key, aad('recovery', file.id));
    } catch (e) {
      if (e instanceof AuthError) throw new AuthError('Cette clé de récupération ne correspond pas à ce coffre.');
      throw e;
    } finally {
      wipe(rk);
    }
    const v = await Vault.fromDek(file, dek);
    await v.changePassword(newPassword, { skipPersist: true });
    const fresh = await v.setRecoveryKey({ skipPersist: true });
    await v.persist();
    return { vault: v, recoveryKey: fresh };
  }

  migrate() {
    const d = this.data;
    d.folders = Array.isArray(d.folders) ? d.folders : [];
    d.items = (Array.isArray(d.items) ? d.items : []).map(normalizeItem);
    d.genHistory = Array.isArray(d.genHistory) ? d.genHistory : [];
    d.sends = Array.isArray(d.sends) ? d.sends : [];
  }

  // ---- enregistrement ------------------------------------------------------------------

  async serialize() {
    this.data.updatedAt = nowIso();
    this.file.updatedAt = this.data.updatedAt;
    this.file.data = await encryptData(this.dek, this.file.id, this.data);
    return JSON.stringify(this.file);
  }

  async persist() {
    this.dirty = true;
    const text = await this.serialize();
    if (this.onPersist) await this.onPersist(text, this);
    this.emit();
    return text;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn(this); } catch (e) { console.error(e); }
    }
  }

  lock() {
    wipe(this.dek);
    this.dek = null;
    this.data = null;
    this.listeners.clear();
  }

  // ---- mot de passe maître, clé de récupération, KDF ------------------------------------

  async verifyPassword(password) {
    try {
      const kek = await deriveKey(password, fromB64(this.file.salt), this.file.kdf);
      const dek = await open(kek, this.file.key, aad('key', this.file.id));
      wipe(kek);
      wipe(dek);
      return true;
    } catch {
      return false;
    }
  }

  async changePassword(newPassword, { kdf = this.file.kdf, hint, skipPersist = false } = {}) {
    if (!newPassword || newPassword.length < MIN_MASTER_LENGTH) throw new Error(`Le mot de passe maître doit contenir au moins ${MIN_MASTER_LENGTH} caractères.`);
    const k = checkKdf(kdf);
    const salt = randomBytes(16);
    const kek = await deriveKey(newPassword, salt, k);
    this.file.kdf = k;
    this.file.salt = b64(salt);
    this.file.key = await seal(kek, this.dek, aad('key', this.file.id));
    if (hint !== undefined) this.file.hint = String(hint || '').slice(0, 120);
    wipe(kek);
    if (!skipPersist) await this.persist();
  }

  async setRecoveryKey({ skipPersist = false } = {}) {
    const key = await generateRecoveryKey();
    const salt = randomBytes(16);
    const kdf = checkKdf(this.file.kdf);
    const rk = await deriveKey(key.replace(/-/g, ''), salt, kdf);
    this.file.recovery = { kdf, salt: b64(salt), key: await seal(rk, this.dek, aad('recovery', this.file.id)) };
    wipe(rk);
    if (!skipPersist) await this.persist();
    return key;
  }

  async removeRecoveryKey() {
    this.file.recovery = null;
    await this.persist();
  }

  async rename(name) {
    this.file.name = String(name || '').trim().slice(0, 60) || this.file.name;
    this.data.name = this.file.name;
    await this.persist();
  }

  // ---- éléments ----------------------------------------------------------------------

  get items() { return this.data.items; }
  get active() { return this.data.items.filter((i) => !i.deletedAt); }
  get trash() { return this.data.items.filter((i) => i.deletedAt); }
  get folders() { return this.data.folders; }

  item(id) { return this.data.items.find((i) => i.id === id) || null; }
  folder(id) { return this.data.folders.find((f) => f.id === id) || null; }
  folderName(id) { return id ? this.folder(id)?.name || '' : ''; }

  allTags() {
    const map = new Map();
    for (const it of this.active) for (const t of it.tags || []) {
      const k = tagKey(t);
      const e = map.get(k) || { tag: t, count: 0 };
      e.count++;
      map.set(k, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'fr'));
  }

  /** Contenu qui compte pour l'historique (le favori n'en fait pas partie, comme dans Keyra). */
  static snapshot(it) {
    return deepClone({ type: it.type, name: it.name, folderId: it.folderId, tags: it.tags, notes: it.notes, reprompt: it.reprompt, data: it.data, fields: it.fields });
  }

  async saveItem(input) {
    const now = nowIso();
    const draft = normalizeItem(deepClone(input));
    draft.name = draft.name.trim() || 'Sans titre';
    draft.tags = normalizeTags(draft.tags);
    if (draft.type === 'login') draft.data.uris = draft.data.uris.filter((u) => u.uri.trim()).map((u) => ({ uri: u.uri.trim(), match: u.match || '' }));
    draft.fields = draft.fields.filter((f) => f.name || f.value);
    const existing = draft.id ? this.item(draft.id) : null;
    if (!existing) {
      draft.id = uuid();
      draft.createdAt = now;
      draft.updatedAt = now;
      draft.history = [];
      draft.passwordHistory = draft.passwordHistory || [];
      this.data.items.unshift(draft);
    } else {
      const before = Vault.snapshot(existing);
      const after = Vault.snapshot(draft);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        existing.history = [{ date: existing.updatedAt || now, snapshot: before }, ...(existing.history || [])].slice(0, MAX_HISTORY);
        const oldPw = mainPassword(existing);
        if (oldPw && oldPw !== mainPassword(draft)) {
          existing.passwordHistory = [{ password: oldPw, date: now }, ...(existing.passwordHistory || [])].slice(0, MAX_PASSWORD_HISTORY);
          draft.data.passwordRevisionDate = now;
        }
        existing.updatedAt = now;
      }
      for (const k of ['type', 'name', 'folderId', 'favorite', 'tags', 'notes', 'reprompt', 'data', 'fields', 'attachments']) existing[k] = draft[k];
      Object.assign(draft, existing);
    }
    await this.persist();
    return this.item(draft.id);
  }

  async addItems(list) {
    const now = nowIso();
    for (const raw of list) {
      const it = normalizeItem(raw);
      it.id = uuid();
      it.createdAt = it.createdAt || now;
      it.updatedAt = it.updatedAt || now;
      it.tags = normalizeTags(it.tags);
      this.data.items.unshift(it);
    }
    await this.persist();
  }

  async toggleFavorite(id) {
    const it = this.item(id);
    if (!it) return;
    it.favorite = !it.favorite;
    await this.persist();
    return it.favorite;
  }

  async touch(id) {
    const it = this.item(id);
    if (!it) return;
    it.usedAt = nowIso();
    await this.persist();
  }

  async moveToFolder(ids, folderId) {
    for (const id of [].concat(ids)) {
      const it = this.item(id);
      if (it) it.folderId = folderId || null;
    }
    await this.persist();
  }

  async clone(id) {
    const src = this.item(id);
    if (!src) return null;
    const copy = deepClone(src);
    copy.id = null;
    copy.name = `${src.name} (copie)`;
    copy.history = [];
    copy.passwordHistory = [];
    copy.favorite = false;
    return this.saveItem(copy);
  }

  async trashItems(ids) {
    const now = nowIso();
    for (const id of [].concat(ids)) {
      const it = this.item(id);
      if (it) it.deletedAt = now;
    }
    await this.persist();
  }

  async restoreItems(ids) {
    for (const id of [].concat(ids)) {
      const it = this.item(id);
      if (it) it.deletedAt = null;
    }
    await this.persist();
  }

  async deleteForever(ids) {
    const set = new Set([].concat(ids));
    this.data.items = this.data.items.filter((i) => !set.has(i.id));
    await this.persist();
  }

  async emptyTrash() {
    this.data.items = this.data.items.filter((i) => !i.deletedAt);
    await this.persist();
  }

  /** Purge automatique de la corbeille (jours ; 0 = jamais). */
  async purgeTrash(days) {
    if (!days) return 0;
    const limit = Date.now() - days * 86400000;
    const before = this.data.items.length;
    this.data.items = this.data.items.filter((i) => !i.deletedAt || new Date(i.deletedAt).getTime() > limit);
    const n = before - this.data.items.length;
    if (n) await this.persist();
    return n;
  }

  async restoreVersion(id, index) {
    const it = this.item(id);
    const v = it?.history?.[index];
    if (!v) return null;
    const draft = { ...deepClone(it), ...deepClone(v.snapshot), id: it.id, favorite: it.favorite };
    if (!v.snapshot.tags) draft.tags = it.tags;
    return this.saveItem(draft);
  }

  async clearHistory(id) {
    const it = this.item(id);
    if (!it) return;
    it.history = [];
    it.passwordHistory = [];
    await this.persist();
  }

  // ---- dossiers ----------------------------------------------------------------------

  async addFolder(name, extra = {}) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('Nom de dossier vide.');
    const dup = this.data.folders.find((f) => norm(f.name) === norm(n));
    if (dup) return dup;
    const f = { id: uuid(), name: n, ...extra };
    this.data.folders.push(f);
    await this.persist();
    return f;
  }

  async updateFolder(id, patch) {
    const f = this.folder(id);
    if (!f) return;
    if (patch.name !== undefined) {
      const n = String(patch.name).trim().slice(0, 60);
      if (!n) throw new Error('Nom de dossier vide.');
      if (this.data.folders.some((x) => x.id !== id && norm(x.name) === norm(n))) throw new Error('Un dossier porte déjà ce nom.');
      f.name = n;
    }
    if (patch.color !== undefined) f.color = patch.color;
    if (patch.icon !== undefined) f.icon = patch.icon;
    await this.persist();
  }

  /** Supprimer un dossier ne supprime aucun élément : ils deviennent « sans dossier ». */
  async deleteFolder(id) {
    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    for (const it of this.data.items) if (it.folderId === id) it.folderId = null;
    await this.persist();
  }

  async reorderFolders(ids) {
    const map = new Map(this.data.folders.map((f) => [f.id, f]));
    this.data.folders = ids.map((id) => map.get(id)).filter(Boolean);
    await this.persist();
  }

  // ---- étiquettes globales ------------------------------------------------------------

  async renameTag(oldTag, newTag) {
    const ok = tagKey(oldTag);
    for (const it of this.data.items) {
      if ((it.tags || []).some((t) => tagKey(t) === ok)) it.tags = normalizeTags(it.tags.map((t) => (tagKey(t) === ok ? newTag : t)));
    }
    await this.persist();
  }

  async deleteTag(tag) {
    const k = tagKey(tag);
    for (const it of this.data.items) it.tags = (it.tags || []).filter((t) => tagKey(t) !== k);
    await this.persist();
  }

  // ---- générateur & Send -------------------------------------------------------------

  async addGenerated(value, kind) {
    this.data.genHistory = [{ value, kind, date: nowIso() }, ...this.data.genHistory.filter((g) => g.value !== value)].slice(0, MAX_GEN_HISTORY);
    await this.persist();
  }

  async clearGenHistory() {
    this.data.genHistory = [];
    await this.persist();
  }

  async logSend(meta) {
    this.data.sends = [{ id: uuid(), createdAt: nowIso(), ...meta }, ...this.data.sends].slice(0, 200);
    await this.persist();
  }

  // ---- statistiques -------------------------------------------------------------------

  stats() {
    const a = this.active;
    const byType = {};
    for (const it of a) byType[it.type] = (byType[it.type] || 0) + 1;
    return {
      total: a.length,
      favorites: a.filter((i) => i.favorite).length,
      totp: a.filter((i) => i.data?.totp).length,
      trash: this.trash.length,
      folders: this.data.folders.length,
      tags: this.allTags().length,
      byType,
    };
  }
}

export { blankItem };
