// Export : chiffré Haiku, Bitwarden (JSON en clair / protégé, CSV), Keyra (.mcfexport, CSV),
// CSV pour navigateurs, et liens otpauth:// de l'authentificateur.

import { toCsv } from './csv.js';
import { deriveKey, seal, gcmEncrypt, gzip, canCompress, KDF_DEFAULT, bwDeriveKey, bwEncrypt, randomBytes } from './crypto.js';
import { b64, utf8, uuid, nowIso, deepClone } from './util.js';

export const EXPORTS = {
  haiku: { label: 'Haiku chiffré', ext: 'haiku.json', mime: 'application/json', encrypted: true, help: 'Tout le coffre (dossiers, étiquettes, pièces jointes, historique), chiffré avec Argon2id + AES-256-GCM par un mot de passe d\'export. Le format conseillé pour les sauvegardes.' },
  bitwarden_protected: { label: 'Bitwarden JSON protégé', ext: 'bitwarden.json', mime: 'application/json', encrypted: true, help: 'Se réimporte dans Bitwarden (Outils › Importer › Bitwarden (json)) avec le mot de passe d\'export.' },
  bitwarden_json: { label: 'Bitwarden JSON (en clair)', ext: 'bitwarden.json', mime: 'application/json', encrypted: false, help: 'Mots de passe EN CLAIR. Format le plus fidèle pour passer à Bitwarden.' },
  bitwarden_csv: { label: 'Bitwarden CSV (en clair)', ext: 'bitwarden.csv', mime: 'text/csv', encrypted: false, help: 'Identifiants et notes seulement, mots de passe EN CLAIR.' },
  keyra: { label: 'Keyra chiffré (.mcfexport)', ext: 'mcfexport', mime: 'application/json', encrypted: true, help: "S'importe dans Keyra sur Linux (Plus › Importer), avec le mot de passe d'export." },
  keyra_csv: { label: 'Keyra CSV (en clair)', ext: 'keyra.csv', mime: 'text/csv', encrypted: false, help: 'Le CSV de Keyra, avec étiquettes. Mots de passe EN CLAIR.' },
  browser_csv: { label: 'CSV navigateur (en clair)', ext: 'csv', mime: 'text/csv', encrypted: false, help: 'name,url,username,password,note : s\'importe dans Chrome, Edge, Firefox, Brave, Proton Pass…' },
  otpauth: { label: 'Liens otpauth:// (2FA)', ext: 'otpauth.txt', mime: 'text/plain', encrypted: false, help: "Une ligne par compte de l'authentificateur, à importer dans Aegis, 2FAS, Ente Auth… EN CLAIR." },
};

const exportable = (vault) => vault.active;

function payload(vault, { history = true, attachments = true } = {}) {
  return {
    exportedAt: nowIso(),
    app: 'Haiku',
    folders: deepClone(vault.folders),
    items: exportable(vault).map((it) => {
      const c = deepClone(it);
      if (!history) { c.history = []; c.passwordHistory = []; }
      if (!attachments) c.attachments = [];
      return c;
    }),
  };
}

// ---- Haiku ------------------------------------------------------------------------------

async function haikuEncrypted(vault, password, opts) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KDF_DEFAULT);
  let bytes = utf8(JSON.stringify(payload(vault, opts)));
  let z = null;
  if (canCompress) { bytes = await gzip(bytes); z = 'gzip'; }
  const box = await seal(key, bytes, 'haiku:export:v1');
  return JSON.stringify({ format: 'haiku-export', version: 1, createdAt: nowIso(), kdf: KDF_DEFAULT, salt: b64(salt), data: { ...box, z } });
}

// ---- Bitwarden ------------------------------------------------------------------------------

const MATCH = { domain: 0, host: 1, startsWith: 2, exact: 3, regex: 4, never: 5 };
const FIELD_TYPE = { text: 0, hidden: 1, bool: 2 };

function bwFields(it) {
  return (it.fields || []).map((f) => ({ name: f.name, value: f.type === 'bool' ? String(f.value === true || f.value === 'true') : f.value ?? '', type: FIELD_TYPE[f.type] ?? 0, linkedId: null }));
}

function toBitwardenItem(it) {
  const d = it.data || {};
  const base = {
    id: it.id,
    organizationId: null,
    folderId: it.folderId || null,
    type: 1,
    reprompt: it.reprompt ? 1 : 0,
    name: it.name,
    notes: it.notes || null,
    favorite: !!it.favorite,
    fields: bwFields(it),
    collectionIds: null,
    passwordHistory: (it.passwordHistory || []).map((p) => ({ lastUsedDate: p.date, password: p.password })),
    revisionDate: it.updatedAt,
    creationDate: it.createdAt,
    deletedDate: null,
  };
  // Les étiquettes n'existent pas dans Bitwarden : on les garde dans un champ.
  if ((it.tags || []).length) base.fields.push({ name: 'Étiquettes', value: it.tags.join(', '), type: 0, linkedId: null });
  switch (it.type) {
    case 'note':
      return { ...base, type: 2, secureNote: { type: 0 } };
    case 'card':
      return { ...base, type: 3, card: { cardholderName: d.cardholderName || null, brand: d.brand || null, number: d.number || null, expMonth: d.expMonth ? String(parseInt(d.expMonth, 10)) : null, expYear: d.expYear || null, code: d.code || null } , fields: d.pin ? [...base.fields, { name: 'Code PIN', value: d.pin, type: 1, linkedId: null }] : base.fields };
    case 'identity': {
      const titles = { 'M.': 'Mr', Mme: 'Mrs', Mlle: 'Ms', Dr: 'Dr' };
      const id = {};
      for (const k of ['firstName', 'middleName', 'lastName', 'address1', 'address2', 'address3', 'city', 'state', 'postalCode', 'country', 'company', 'email', 'phone', 'ssn', 'username', 'passportNumber', 'licenseNumber']) id[k] = d[k] || null;
      id.title = titles[d.title] || null;
      const extra = [];
      if (d.birthDate) extra.push({ name: 'Date de naissance', value: d.birthDate, type: 0, linkedId: null });
      if (d.idNumber) extra.push({ name: "N° de carte d'identité", value: d.idNumber, type: 1, linkedId: null });
      return { ...base, type: 4, identity: id, fields: [...base.fields, ...extra] };
    }
    case 'ssh':
      return { ...base, type: 5, sshKey: { privateKey: d.privateKey || '', publicKey: d.publicKey || '', keyFingerprint: d.fingerprint || '' }, fields: d.passphrase ? [...base.fields, { name: 'Phrase de passe', value: d.passphrase, type: 1, linkedId: null }] : base.fields };
    case 'wifi':
      return {
        ...base,
        login: { uris: [], username: null, password: d.password || null, totp: null, fido2Credentials: [] },
        fields: [...base.fields, { name: 'haiku-type', value: 'wifi', type: 0, linkedId: null }, { name: 'SSID', value: d.ssid || '', type: 0, linkedId: null }, { name: 'Sécurité', value: d.security || '', type: 0, linkedId: null }, { name: 'Masqué', value: String(!!d.hidden), type: 2, linkedId: null }],
      };
    case 'server':
      return {
        ...base,
        login: { uris: d.hostname ? [{ match: null, uri: `${(d.protocol || 'ssh').toLowerCase()}://${d.hostname}${d.port ? `:${d.port}` : ''}` }] : [], username: d.username || null, password: d.password || null, totp: null, fido2Credentials: [] },
        fields: [...base.fields, { name: 'haiku-type', value: 'server', type: 0, linkedId: null }, { name: 'Hôte', value: d.hostname || '', type: 0, linkedId: null }, { name: 'Port', value: d.port || '', type: 0, linkedId: null }, { name: 'Protocole', value: d.protocol || '', type: 0, linkedId: null }],
      };
    default:
      return { ...base, login: { uris: (d.uris || []).map((u) => ({ match: u.match ? MATCH[u.match] ?? null : null, uri: u.uri })), username: d.username || null, password: d.password || null, totp: d.totp || null, passwordRevisionDate: d.passwordRevisionDate || null, fido2Credentials: [] } };
  }
}

function bitwardenJson(vault) {
  return JSON.stringify({ encrypted: false, folders: vault.folders.map((f) => ({ id: f.id, name: f.name })), items: exportable(vault).map(toBitwardenItem) }, null, 2);
}

async function bitwardenProtected(vault, password) {
  const salt = b64(randomBytes(16));
  const cfg = { kdfType: 0, kdfIterations: 600000, kdfMemory: null, kdfParallelism: null };
  const key = await bwDeriveKey(password, salt, cfg);
  return JSON.stringify({
    encrypted: true,
    passwordProtected: true,
    salt,
    ...cfg,
    encKeyValidation_DO_NOT_EDIT: await bwEncrypt(key, uuid()),
    data: await bwEncrypt(key, bitwardenJson(vault)),
  }, null, 2);
}

function bitwardenCsv(vault) {
  const headers = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const rows = exportable(vault).filter((it) => ['login', 'note', 'wifi', 'server'].includes(it.type)).map((it) => {
    const b = toBitwardenItem(it);
    return {
      folder: vault.folderName(it.folderId),
      favorite: it.favorite ? '1' : '',
      type: it.type === 'note' ? 'note' : 'login',
      name: it.name,
      notes: it.notes || '',
      fields: (b.fields || []).map((f) => `${f.name}: ${f.value}`).join('\n'),
      reprompt: it.reprompt ? '1' : '0',
      login_uri: (b.login?.uris || []).map((u) => u.uri).join(','),
      login_username: b.login?.username || '',
      login_password: b.login?.password || '',
      login_totp: b.login?.totp || '',
    };
  });
  return toCsv(headers, rows);
}

// ---- Keyra --------------------------------------------------------------------------------

function toKeyraEntry(it, vault) {
  const d = it.data || {};
  const field = (name) => (it.fields || []).find((f) => f.name === name)?.value || '';
  const e = { type: 'login', name: it.name, url: '', username: '', email: '', password: '', notes: it.notes || '', extra: {}, favorite: !!it.favorite, category: vault.folderName(it.folderId), tags: it.tags || [] };
  const extraNotes = [];
  switch (it.type) {
    case 'login':
      Object.assign(e, { url: d.uris?.[0]?.uri || '', username: d.username || '', email: field('E-mail'), password: d.password || '' });
      if (d.totp) extraNotes.push(`TOTP: ${d.totp}`);
      if ((d.uris || []).length > 1) extraNotes.push(`Autres adresses : ${d.uris.slice(1).map((u) => u.uri).join(', ')}`);
      break;
    case 'note':
      e.type = 'secure_note';
      break;
    case 'card':
      e.type = 'card';
      e.extra = { cardholder: d.cardholderName || '', card_number: d.number || '', expiry: d.expMonth && d.expYear ? `${d.expMonth}/${String(d.expYear).slice(-2)}` : '', cvv: d.code || '', pin: d.pin || '' };
      break;
    case 'identity':
      e.type = 'identity';
      e.email = d.email || '';
      e.extra = { full_name: [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' '), birth_date: d.birthDate || '', phone: d.phone || '', address: [d.address1, d.address2, d.postalCode, d.city, d.country].filter(Boolean).join(', '), id_number: d.idNumber || d.passportNumber || '' };
      break;
    case 'wifi':
      e.type = 'wifi';
      e.password = d.password || '';
      e.extra = { ssid: d.ssid || '', security: d.security || '' };
      break;
    case 'server':
      e.type = 'server';
      Object.assign(e, { username: d.username || '', password: d.password || '', url: field('URL') });
      e.extra = { hostname: d.hostname || '', port: d.port || '', protocol: d.protocol || '' };
      break;
    case 'ssh':
      e.type = 'secure_note';
      extraNotes.push(`Clé publique :\n${d.publicKey || ''}`, `Clé privée :\n${d.privateKey || ''}`);
      if (d.passphrase) extraNotes.push(`Phrase de passe : ${d.passphrase}`);
      break;
    default:
  }
  for (const f of it.fields || []) if (!(it.type === 'login' && f.name === 'E-mail') && !(it.type === 'server' && f.name === 'URL')) extraNotes.push(`${f.name}: ${f.value}`);
  if (extraNotes.length) e.notes = [e.notes, ...extraNotes].filter(Boolean).join('\n');
  e.extra = Object.fromEntries(Object.entries(e.extra).filter(([, v]) => v));
  return e;
}

async function keyraEncrypted(vault, password) {
  const t = KDF_DEFAULT.t;
  const m = KDF_DEFAULT.m;
  const p = KDF_DEFAULT.p;
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, { t, m, p });
  const entries = exportable(vault).map((it) => toKeyraEntry(it, vault));
  const plain = utf8(JSON.stringify({ exported_at: nowIso(), entries }));
  const { nonce, ct } = await gcmEncrypt(key, plain, utf8('mon-coffre-fort:export:v1'));
  return JSON.stringify({ format: 'mon-coffre-fort-export', version: 1, kdf: 'argon2id', kdf_params: { time_cost: t, memory_cost: m, parallelism: p, hash_len: 32 }, salt: b64(salt), nonce: b64(nonce), ciphertext: b64(ct) });
}

function keyraCsv(vault) {
  const headers = ['type', 'name', 'url', 'username', 'email', 'password', 'notes', 'category', 'favorite', 'extra', 'tags'];
  const rows = exportable(vault).map((it) => {
    const e = toKeyraEntry(it, vault);
    return { ...e, favorite: e.favorite ? '1' : '0', extra: Object.keys(e.extra).length ? JSON.stringify(e.extra) : '', tags: e.tags.join(', ') };
  });
  return toCsv(headers, rows);
}

function browserCsv(vault) {
  const rows = exportable(vault).filter((it) => it.type === 'login').map((it) => ({ name: it.name, url: it.data.uris?.[0]?.uri || '', username: it.data.username || '', password: it.data.password || '', note: it.notes || '' }));
  return toCsv(['name', 'url', 'username', 'password', 'note'], rows);
}

function otpauthList(vault) {
  return exportable(vault).filter((it) => it.data?.totp).map((it) => {
    const t = it.data.totp.trim();
    if (/^otpauth:\/\//i.test(t) || /^steam:\/\//i.test(t)) return t;
    const label = encodeURIComponent(`${it.name}:${it.data.username || ''}`);
    return `otpauth://totp/${label}?secret=${t.replace(/\s/g, '').toUpperCase()}&issuer=${encodeURIComponent(it.name)}`;
  }).join('\n') + '\n';
}

/** Produit le contenu texte d'un export. `password` requis pour les formats chiffrés. */
export async function buildExport(format, vault, { password, history = true, attachments = true } = {}) {
  const spec = EXPORTS[format];
  if (!spec) throw new Error('Format d\'export inconnu.');
  if (spec.encrypted && (!password || password.length < 8)) throw new Error("Le mot de passe d'export doit contenir au moins 8 caractères.");
  switch (format) {
    case 'haiku': return haikuEncrypted(vault, password, { history, attachments });
    case 'bitwarden_protected': return bitwardenProtected(vault, password);
    case 'bitwarden_json': return bitwardenJson(vault);
    case 'bitwarden_csv': return bitwardenCsv(vault);
    case 'keyra': return keyraEncrypted(vault, password);
    case 'keyra_csv': return keyraCsv(vault);
    case 'browser_csv': return browserCsv(vault);
    case 'otpauth': return otpauthList(vault);
    default: throw new Error('Format inconnu.');
  }
}

export function exportFileName(format, vaultName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const base = String(vaultName || 'haiku').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'haiku';
  return `${base}_${stamp}.${EXPORTS[format].ext}`;
}
