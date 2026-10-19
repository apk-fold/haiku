// Import : détecte le format d'un fichier et le convertit en éléments Haiku.
//
// Pris en charge : export chiffré Haiku, coffre Haiku (.haiku), Bitwarden JSON (en clair ou protégé
// par mot de passe), Bitwarden CSV, Keyra (.mcfexport chiffré et CSV), KeePassXC CSV, KeePass 2 XML,
// Chrome / Edge / Brave / Opera, Firefox, Safari / Mots de passe d'Apple, LastPass, 1Password,
// Dashlane, Proton Pass, NordPass, Aegis (JSON en clair), et un CSV générique.

import { parseCsv } from './csv.js';
import { normalizeItem, blankItem, cardBrand } from './schema.js';
import { normalizeTags } from './tags.js';
import { hostname, norm, fromB64, utf8, fromUtf8 } from './util.js';
import { bwDeriveKey, bwDecrypt, deriveKey, gcmDecrypt, open, gunzip, checkKdf } from './crypto.js';
import { parseVaultFile, Vault } from './vault.js';
import { buildOtpauth } from './totp.js';

export const MAX_IMPORT_SIZE = 50 * 1024 * 1024;

export const FORMATS = {
  haiku: 'Export chiffré Haiku',
  'haiku-vault': 'Coffre Haiku',
  bitwarden_json: 'Bitwarden (JSON)',
  bitwarden_protected: 'Bitwarden (JSON protégé par mot de passe)',
  bitwarden_csv: 'Bitwarden (CSV)',
  keyra: 'Keyra (export chiffré .mcfexport)',
  keyra_csv: 'Keyra (CSV)',
  keepassxc: 'KeePassXC (CSV)',
  keepass_xml: 'KeePass 2 (XML)',
  chrome: 'Chrome / Edge / Brave / Opera (CSV)',
  firefox: 'Firefox (CSV)',
  apple: 'Safari / Mots de passe Apple (CSV)',
  lastpass: 'LastPass (CSV)',
  onepassword: '1Password (CSV)',
  dashlane: 'Dashlane (CSV)',
  proton: 'Proton Pass (CSV)',
  nordpass: 'NordPass (CSV)',
  aegis: 'Aegis Authenticator (JSON)',
  generic: 'CSV générique',
};

export class NeedsPassword extends Error {
  constructor(format, prompt) {
    super(prompt);
    this.format = format;
    this.prompt = prompt;
  }
}

// ---- outils de construction --------------------------------------------------------------

function mk(type, props = {}) {
  const it = blankItem(type);
  const { data, ...rest } = props;
  Object.assign(it, rest);
  Object.assign(it.data, data || {});
  return it;
}

const clean = (v) => (v == null ? '' : String(v)).trim();

function login({ name, url, urls, username, password, notes, totp, folder, favorite, tags, fields, created, updated }) {
  const list = (urls || [url]).map(clean).filter(Boolean);
  const it = mk('login', {
    name: clean(name) || hostname(list[0]) || clean(username) || 'Sans titre',
    notes: notes || '',
    favorite: !!favorite,
    tags: tags || [],
    fields: fields || [],
    createdAt: created || null,
    updatedAt: updated || null,
    data: { username: clean(username), password: password ?? '', totp: clean(totp), uris: list.map((uri) => ({ uri, match: '' })) },
  });
  return { item: it, folder: clean(folder) };
}

function noteItem({ name, notes, folder, favorite, tags, fields }) {
  return { item: mk('note', { name: clean(name) || 'Note', notes: notes || '', favorite: !!favorite, tags: tags || [], fields: fields || [] }), folder: clean(folder) };
}

function splitFolder(path) {
  const p = clean(path).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!p || /^(root|racine)$/i.test(p)) return '';
  return p;
}

function fieldsFromText(text) {
  // « nom: valeur » par ligne (format Bitwarden CSV).
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(': ');
      return i > 0 ? { name: l.slice(0, i), value: l.slice(i + 2), type: 'text' } : { name: l, value: '', type: 'text' };
    });
}

const truthy = (v) => /^(1|true|yes|oui|y|x)$/i.test(clean(v));

// ---- détection ------------------------------------------------------------------------

export function detect(text, fileName = '') {
  const t = String(text || '').replace(/^﻿/, '').trimStart();
  if (t.startsWith('{') || t.startsWith('[')) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error('Fichier JSON illisible.'); }
    if (j?.format === 'haiku-export') return { format: 'haiku', json: j };
    if (j?.format === 'haiku-vault') return { format: 'haiku-vault', json: j };
    if (j?.format === 'mon-coffre-fort-export') return { format: 'keyra', json: j };
    if (j?.encrypted === true && j?.passwordProtected) return { format: 'bitwarden_protected', json: j };
    if (j?.encrypted === true) throw new Error("Cet export Bitwarden est chiffré avec la clé du compte : il ne peut être lu qu'avec Bitwarden. Refais l'export en choisissant « Protégé par mot de passe » ou JSON non chiffré.");
    if (Array.isArray(j?.items)) return { format: 'bitwarden_json', json: j };
    if (j?.db && j?.header) {
      if (typeof j.db === 'string') throw new Error('Export Aegis chiffré : exporte-le sans chiffrement pour l\'importer.');
      return { format: 'aegis', json: j };
    }
    throw new Error('Format JSON non reconnu.');
  }
  if (t.startsWith('<')) return { format: 'keepass_xml', xml: t };
  const { headers, records } = parseCsv(t);
  const h = new Set(headers.map((x) => x.toLowerCase().trim()));
  const has = (...k) => k.every((x) => h.has(x));
  let format = 'generic';
  if (has('type', 'name', 'url', 'username', 'email', 'password', 'notes', 'category', 'favorite', 'extra')) format = 'keyra_csv';
  else if (has('login_password', 'login_username', 'name')) format = 'bitwarden_csv';
  else if (has('title', 'username', 'password', 'url') && h.has('group')) format = 'keepassxc';
  else if (has('url', 'username', 'password') && (h.has('guid') || h.has('formactionorigin'))) format = 'firefox';
  else if (has('url', 'username', 'password', 'extra', 'name', 'grouping')) format = 'lastpass';
  else if (has('title', 'url', 'username', 'password', 'otpauth') && (h.has('archived') || h.has('tags') || h.has('favorite'))) format = 'onepassword';
  else if (has('title', 'url', 'username', 'password', 'otpauth')) format = 'apple';
  else if (has('username', 'title', 'password', 'note', 'url') && (h.has('otpsecret') || h.has('username2') || h.has('category'))) format = 'dashlane';
  else if (has('type', 'name', 'url', 'email', 'username', 'password', 'note', 'totp') && (h.has('vault') || h.has('createtime'))) format = 'proton';
  else if (has('name', 'url', 'username', 'password', 'note') && (h.has('cardholdername') || h.has('folder'))) format = 'nordpass';
  else if (has('name', 'url', 'username', 'password')) format = 'chrome';
  else if (!h.has('password') && !h.has('login_password')) throw new Error('Format CSV non reconnu : il faut au moins une colonne « password ».');
  return { format, headers, records: records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().trim(), v]))) };
}

// ---- convertisseurs CSV -------------------------------------------------------------------

function fromCsvRow(fmt, r) {
  const g = (...keys) => {
    for (const k of keys) if (clean(r[k])) return clean(r[k]);
    return '';
  };
  switch (fmt) {
    case 'bitwarden_csv': {
      const fields = fieldsFromText(r.fields);
      const base = { name: g('name'), notes: r.notes || '', folder: g('folder'), favorite: truthy(r.favorite), fields };
      if (g('type') === 'note') return noteItem(base);
      const res = login({ ...base, urls: String(r.login_uri || '').split(','), username: g('login_username'), password: r.login_password || '', totp: g('login_totp') });
      res.item.reprompt = g('reprompt') === '1';
      return reviveHaikuType(res);
    }
    case 'keyra_csv': {
      let extra = {};
      try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch { extra = {}; }
      return fromKeyra({ type: g('type') || 'login', name: g('name'), url: g('url'), username: g('username'), email: g('email'), password: r.password || '', notes: r.notes || '', category: g('category'), favorite: truthy(r.favorite), extra, tags: String(r.tags || '').split(',') });
    }
    case 'keepassxc':
      return login({ name: g('title'), url: g('url'), username: g('username'), password: r.password || '', notes: r.notes || '', totp: g('totp'), folder: splitFolder(g('group')).split('/').pop(), created: g('created') || null, updated: g('last modified') || null });
    case 'firefox':
      return login({ name: hostname(g('url')), url: g('url'), username: g('username'), password: r.password || '' });
    case 'lastpass': {
      if (g('url') === 'http://sn') return noteItem({ name: g('name'), notes: r.extra || '', folder: g('grouping'), favorite: truthy(r.fav) });
      return login({ name: g('name'), url: g('url'), username: g('username'), password: r.password || '', notes: r.extra || '', totp: g('totp'), folder: g('grouping'), favorite: truthy(r.fav) });
    }
    case 'onepassword':
      return login({ name: g('title'), url: g('url'), username: g('username'), password: r.password || '', notes: r.notes || '', totp: g('otpauth'), favorite: truthy(r.favorite), tags: String(r.tags || '').split(/[;,]/) });
    case 'apple':
      return login({ name: g('title'), url: g('url'), username: g('username'), password: r.password || '', notes: r.notes || '', totp: g('otpauth') });
    case 'dashlane':
      return login({ name: g('title'), url: g('url'), username: g('username', 'username2', 'username3', 'email'), password: r.password || '', notes: r.note || '', totp: g('otpsecret', 'otpurl'), folder: g('category') });
    case 'proton': {
      if (/note/i.test(g('type'))) return noteItem({ name: g('name'), notes: r.note || '', folder: g('vault') });
      const res = login({ name: g('name'), url: g('url'), username: g('username', 'email'), password: r.password || '', notes: r.note || '', totp: g('totp'), folder: g('vault') });
      if (g('email') && g('username')) res.item.fields.push({ name: 'E-mail', value: g('email'), type: 'text' });
      return res;
    }
    case 'nordpass': {
      if (g('cardnumber')) {
        const [m, y] = g('expirydate').split('/');
        return { item: mk('card', { name: g('name') || 'Carte', notes: r.note || '', data: { cardholderName: g('cardholdername'), number: g('cardnumber'), code: g('cvc'), pin: g('pin'), expMonth: (m || '').padStart(2, '0'), expYear: y ? (y.length === 2 ? `20${y}` : y) : '', brand: cardBrand(g('cardnumber')) } }), folder: g('folder') };
      }
      if (!g('password') && !g('username') && r.note) return noteItem({ name: g('name'), notes: r.note, folder: g('folder') });
      return login({ name: g('name'), url: g('url'), username: g('username'), password: r.password || '', notes: r.note || '', folder: g('folder') });
    }
    case 'chrome':
      return login({ name: g('name'), url: g('url'), username: g('username'), password: r.password || '', notes: r.note || r.notes || '' });
    default:
      return login({
        name: g('name', 'title', 'service', 'site', 'nom', 'titre'),
        url: g('url', 'uri', 'website', 'login_uri', 'site web', 'adresse'),
        username: g('username', 'login', 'user', 'login_username', 'identifiant', 'utilisateur', 'email', 'e-mail'),
        password: r.password || r['mot de passe'] || '',
        notes: g('notes', 'note', 'comment', 'comments', 'extra'),
        totp: g('totp', 'otp', 'otpauth'),
        folder: g('folder', 'category', 'group', 'catégorie', 'categorie', 'dossier'),
      });
  }
}

// ---- Keyra ---------------------------------------------------------------------------------

function fromKeyra(e) {
  const x = e.extra && typeof e.extra === 'object' ? e.extra : {};
  const common = { name: clean(e.name) || 'Sans titre', notes: e.notes || '', favorite: !!e.favorite, tags: Array.isArray(e.tags) ? e.tags : [] };
  const folder = clean(e.category);
  const email = clean(e.email);
  let it;
  switch (e.type) {
    case 'secure_note':
      it = mk('note', common);
      break;
    case 'card': {
      const m = /^(\d{1,2})\s*[/.-]\s*(\d{2,4})$/.exec(clean(x.expiry));
      it = mk('card', { ...common, data: { cardholderName: clean(x.cardholder), number: clean(x.card_number), code: clean(x.cvv), pin: clean(x.pin), expMonth: m ? m[1].padStart(2, '0') : '', expYear: m ? (m[2].length === 2 ? `20${m[2]}` : m[2]) : '', brand: cardBrand(x.card_number) } });
      if (!m && clean(x.expiry)) it.fields.push({ name: 'Expiration', value: clean(x.expiry), type: 'text' });
      break;
    }
    case 'identity': {
      const parts = clean(x.full_name).split(/\s+/).filter(Boolean);
      it = mk('identity', { ...common, data: { firstName: parts.shift() || '', lastName: parts.join(' '), birthDate: clean(x.birth_date), phone: clean(x.phone), address1: clean(x.address), idNumber: clean(x.id_number), email } });
      break;
    }
    case 'wifi':
      it = mk('wifi', { ...common, data: { ssid: clean(x.ssid), security: clean(x.security) || 'WPA2', password: e.password || '' } });
      break;
    case 'server':
      it = mk('server', { ...common, data: { hostname: clean(x.hostname) || hostname(e.url), port: clean(x.port), protocol: clean(x.protocol), username: clean(e.username), password: e.password || '' } });
      if (clean(e.url)) it.fields.push({ name: 'URL', value: clean(e.url), type: 'text' });
      break;
    default:
      it = mk('login', { ...common, data: { username: clean(e.username) || email, password: e.password || '', uris: clean(e.url) ? [{ uri: clean(e.url), match: '' }] : [] } });
      if (email && clean(e.username)) it.fields.push({ name: 'E-mail', value: email, type: 'text' });
  }
  return { item: it, folder };
}

// ---- Bitwarden JSON --------------------------------------------------------------------------

const BW_FIELD = { 0: 'text', 1: 'hidden', 2: 'bool', 3: 'text' };

/** Les types propres à Haiku (Wi-Fi, serveur) voyagent dans Bitwarden comme des identifiants avec un champ « haiku-type ». */
function reviveHaikuType(res) {
  const it = res.item;
  const marker = it.fields.find((f) => f.name === 'haiku-type');
  if (!marker) return res;
  const take = (name) => {
    const f = it.fields.find((x) => x.name === name);
    return f ? f.value : '';
  };
  if (marker.value === 'wifi') {
    const w = mk('wifi', { name: it.name, notes: it.notes, favorite: it.favorite, tags: it.tags, data: { ssid: take('SSID'), security: take('Sécurité') || 'WPA2', hidden: take('Masqué') === 'true', password: it.data.password } });
    w.fields = it.fields.filter((f) => !['haiku-type', 'SSID', 'Sécurité', 'Masqué'].includes(f.name));
    return { item: w, folder: res.folder };
  }
  if (marker.value === 'server') {
    const s = mk('server', { name: it.name, notes: it.notes, favorite: it.favorite, tags: it.tags, data: { hostname: take('Hôte'), port: take('Port'), protocol: take('Protocole'), username: it.data.username, password: it.data.password } });
    s.fields = it.fields.filter((f) => !['haiku-type', 'Hôte', 'Port', 'Protocole'].includes(f.name));
    return { item: s, folder: res.folder };
  }
  it.fields = it.fields.filter((f) => f.name !== 'haiku-type');
  return res;
}

function fromBitwardenItem(b, folders) {
  let fields = (b.fields || []).map((f) => ({ name: clean(f.name), value: f.type === 2 ? String(f.value === 'true' || f.value === true) : f.value ?? '', type: BW_FIELD[f.type] || 'text' }));
  const tagField = fields.find((f) => f.name === 'Étiquettes');
  const tags = tagField ? String(tagField.value).split(',') : [];
  fields = fields.filter((f) => f !== tagField);
  const common = {
    tags,
    name: clean(b.name) || 'Sans titre',
    notes: b.notes || '',
    favorite: !!b.favorite,
    reprompt: b.reprompt === 1,
    fields,
    createdAt: b.creationDate || null,
    updatedAt: b.revisionDate || null,
    passwordHistory: (b.passwordHistory || []).map((p) => ({ password: p.password, date: p.lastUsedDate })).filter((p) => p.password),
  };
  const folder = b.folderId ? folders.get(b.folderId) || '' : '';
  let it;
  switch (b.type) {
    case 2:
      it = mk('note', common);
      break;
    case 3: {
      const c = b.card || {};
      it = mk('card', { ...common, data: { cardholderName: clean(c.cardholderName), brand: clean(c.brand) || cardBrand(c.number), number: clean(c.number), expMonth: clean(c.expMonth).padStart(c.expMonth ? 2 : 0, '0'), expYear: clean(c.expYear), code: clean(c.code) } });
      break;
    }
    case 4: {
      const d = b.identity || {};
      const map = {};
      for (const k of ['title', 'firstName', 'middleName', 'lastName', 'address1', 'address2', 'address3', 'city', 'state', 'postalCode', 'country', 'company', 'email', 'phone', 'ssn', 'username', 'passportNumber', 'licenseNumber']) map[k] = clean(d[k]);
      const titles = { Mr: 'M.', Mrs: 'Mme', Ms: 'Mme', Mx: '', Dr: 'Dr' };
      if (map.title in titles) map.title = titles[map.title];
      it = mk('identity', { ...common, data: map });
      break;
    }
    case 5: {
      const k = b.sshKey || {};
      it = mk('ssh', { ...common, data: { privateKey: k.privateKey || '', publicKey: k.publicKey || '', fingerprint: k.keyFingerprint || '' } });
      break;
    }
    default: {
      const l = b.login || {};
      it = mk('login', { ...common, data: { username: clean(l.username), password: l.password || '', totp: clean(l.totp), uris: (l.uris || []).filter((u) => u?.uri).map((u) => ({ uri: u.uri, match: ['domain', 'host', 'startsWith', 'exact', 'regex', 'never'][u.match] || '' })), passwordRevisionDate: l.passwordRevisionDate || undefined } });
    }
  }
  return reviveHaikuType({ item: it, folder });
}

function fromBitwardenJson(j) {
  const folders = new Map((j.folders || []).map((f) => [f.id, clean(f.name)]));
  const coll = new Map((j.collections || []).map((c) => [c.id, clean(c.name)]));
  return (j.items || []).map((b) => {
    const r = fromBitwardenItem(b, folders);
    if (!r.folder && b.collectionIds?.length) r.folder = coll.get(b.collectionIds[0]) || '';
    return r;
  });
}

// ---- KeePass 2 XML ---------------------------------------------------------------------------

function fromKeepassXml(xml) {
  if (typeof DOMParser === 'undefined') throw new Error('Import XML indisponible ici.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier XML illisible.');
  const out = [];
  const walk = (group, path) => {
    const name = group.querySelector(':scope > Name')?.textContent || '';
    const here = path === null ? '' : name;
    for (const e of group.querySelectorAll(':scope > Entry')) {
      const s = {};
      for (const kv of e.querySelectorAll(':scope > String')) s[kv.querySelector('Key')?.textContent || ''] = kv.querySelector('Value')?.textContent || '';
      const std = ['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp', 'TimeOtp-Secret-Base32'];
      const fields = Object.entries(s).filter(([k]) => !std.includes(k) && k).map(([k, v]) => ({ name: k, value: v, type: 'text' }));
      const totp = s.otp || (s['TimeOtp-Secret-Base32'] ? buildOtpauth({ secret: s['TimeOtp-Secret-Base32'], account: s.UserName || '' }) : '');
      const tags = (e.querySelector(':scope > Tags')?.textContent || '').split(/[;,]/);
      out.push(login({ name: s.Title, url: s.URL, username: s.UserName, password: s.Password, notes: s.Notes, totp, folder: here, fields, tags }));
    }
    for (const g of group.querySelectorAll(':scope > Group')) walk(g, here);
  };
  const root = doc.querySelector('KeePassFile > Root > Group');
  if (!root) throw new Error('Fichier KeePass XML invalide.');
  walk(root, null);
  return out;
}

// ---- Aegis ---------------------------------------------------------------------------------

function fromAegis(j) {
  return (j.db?.entries || []).filter((e) => e.info?.secret).map((e) => {
    const algo = (e.info.algo || 'SHA1').toUpperCase();
    let totp = buildOtpauth({ secret: e.info.secret, issuer: e.issuer || '', account: e.name || '', algorithm: algo, digits: e.info.digits || 6, period: e.info.period || 30 });
    if (e.type === 'steam') totp = `steam://${e.info.secret}`;
    if (e.type === 'hotp') totp = totp.replace('otpauth://totp/', 'otpauth://hotp/') + `&counter=${e.info.counter || 0}`;
    return login({ name: e.issuer || e.name || 'Compte', username: e.name || '', totp, notes: e.note || '', folder: (e.groups && e.groups[0]) || '' });
  });
}

// ---- formats chiffrés --------------------------------------------------------------------

async function fromHaikuExport(j, password) {
  if (j.version !== 1) throw new Error("Version d'export Haiku non prise en charge.");
  const kdf = checkKdf(j.kdf);
  const key = await deriveKey(password, fromB64(j.salt), kdf);
  let bytes;
  try {
    bytes = await open(key, j.data, 'haiku:export:v1');
  } catch {
    throw new NeedsPassword('haiku', "Mot de passe d'export incorrect.");
  }
  if (j.data.z === 'gzip') bytes = await gunzip(bytes);
  const payload = JSON.parse(fromUtf8(bytes));
  const folders = new Map((payload.folders || []).map((f) => [f.id, f.name]));
  return (payload.items || []).map((raw) => {
    const it = normalizeItem({ ...raw, id: null, deletedAt: null });
    return { item: it, folder: raw.folderId ? folders.get(raw.folderId) || '' : '' };
  });
}

async function fromHaikuVault(j, password) {
  const v = await Vault.unlock(parseVaultFile(j), password).catch((e) => {
    throw new NeedsPassword('haiku-vault', e.message || 'Mot de passe incorrect.');
  });
  const folders = new Map(v.folders.map((f) => [f.id, f.name]));
  const out = v.active.map((raw) => ({ item: normalizeItem({ ...raw, id: null }), folder: raw.folderId ? folders.get(raw.folderId) || '' : '' }));
  v.lock();
  return out;
}

async function fromKeyraExport(j, password) {
  const p = j.kdf_params || {};
  const kdf = checkKdf({ t: p.time_cost, m: p.memory_cost, p: p.parallelism });
  const key = await deriveKey(password, fromB64(j.salt), kdf);
  let plain;
  try {
    plain = await gcmDecrypt(key, fromB64(j.nonce), fromB64(j.ciphertext), utf8('mon-coffre-fort:export:v1'));
  } catch {
    throw new NeedsPassword('keyra', "Mot de passe d'export Keyra incorrect.");
  }
  const data = JSON.parse(fromUtf8(plain));
  return (data.entries || []).map(fromKeyra);
}

async function fromBitwardenProtected(j, password) {
  const key = await bwDeriveKey(password, j.salt, j);
  try {
    await bwDecrypt(key, j.encKeyValidation_DO_NOT_EDIT);
  } catch {
    throw new NeedsPassword('bitwarden_protected', "Mot de passe de l'export Bitwarden incorrect.");
  }
  const inner = JSON.parse(await bwDecrypt(key, j.data));
  return fromBitwardenJson(inner);
}

const ENCRYPTED = {
  haiku: { fn: fromHaikuExport, prompt: "Mot de passe de l'export Haiku" },
  'haiku-vault': { fn: fromHaikuVault, prompt: 'Mot de passe maître de ce coffre' },
  keyra: { fn: fromKeyraExport, prompt: "Mot de passe de l'export Keyra" },
  bitwarden_protected: { fn: fromBitwardenProtected, prompt: "Mot de passe de l'export Bitwarden" },
};

/**
 * Lit un fichier et renvoie un aperçu { format, label, entries:[{item, folder}], skipped }.
 * Pour un format chiffré sans mot de passe, lève NeedsPassword (l'interface le demande puis rappelle).
 */
export async function parseImport(text, { password, fileName } = {}) {
  if (String(text).length > MAX_IMPORT_SIZE) throw new Error('Fichier trop volumineux (50 Mo au plus).');
  const det = detect(text, fileName);
  let entries;
  if (ENCRYPTED[det.format]) {
    if (!password) throw new NeedsPassword(det.format, ENCRYPTED[det.format].prompt);
    entries = await ENCRYPTED[det.format].fn(det.json, password);
  } else if (det.format === 'bitwarden_json') entries = fromBitwardenJson(det.json);
  else if (det.format === 'aegis') entries = fromAegis(det.json);
  else if (det.format === 'keepass_xml') entries = fromKeepassXml(det.xml);
  else entries = det.records.map((r) => fromCsvRow(det.format, r));
  let skipped = 0;
  const out = [];
  for (const e of entries) {
    if (!e || !e.item) { skipped++; continue; }
    const it = e.item;
    const d = it.data || {};
    const empty = !it.name && !d.password && !d.username && !it.notes && !d.totp && !(d.uris || []).length;
    if (empty) { skipped++; continue; }
    it.tags = normalizeTags(it.tags);
    out.push({ item: normalizeItem(it), folder: e.folder || '' });
  }
  return { format: det.format, label: FORMATS[det.format], entries: out, skipped };
}

export function dedupKey(it) {
  const d = it.data || {};
  return [it.type, norm(it.name), d.username || '', (d.uris || [])[0]?.uri || '', d.password || d.number || d.ssid || '', it.type === 'note' ? it.notes : ''].join('\u0001');
}

/** Applique un aperçu au coffre : crée les dossiers manquants, ignore les doublons. */
export async function applyImport(vault, preview, { createFolders = true, skipDuplicates = true } = {}) {
  const existing = new Set(vault.active.map(dedupKey));
  const folderIds = new Map(vault.folders.map((f) => [norm(f.name), f.id]));
  const created = [];
  const toAdd = [];
  let duplicates = 0;
  for (const { item, folder } of preview.entries) {
    const k = dedupKey(item);
    if (skipDuplicates && existing.has(k)) { duplicates++; continue; }
    existing.add(k);
    if (folder && createFolders) {
      const fk = norm(folder);
      if (!folderIds.has(fk)) {
        const f = { id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()), name: folder.slice(0, 60) };
        vault.data.folders.push(f);
        folderIds.set(fk, f.id);
        created.push(f.name);
      }
      item.folderId = folderIds.get(fk);
    } else item.folderId = null;
    toAdd.push(item);
  }
  if (toAdd.length || created.length) await vault.addItems(toAdd.reverse());
  return { imported: toAdd.length, duplicates, foldersCreated: created };
}
