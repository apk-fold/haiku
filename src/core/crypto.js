// Primitives cryptographiques de Haiku (WebCrypto + Argon2id).
//
//   mot de passe maître ──Argon2id (sel du coffre)──► KEK
//   KEK ──AES-256-GCM──► DEK (clé de données aléatoire 256 bits)
//   DEK ──AES-256-GCM──► contenu du coffre (JSON compressé)
//
// Même schéma que Keyra (enveloppe de clé), avec en plus les formats Bitwarden
// (EncString type 2 : AES-256-CBC + HMAC-SHA256) pour l'import / export compatibles.

import { argon2id } from './kdf.js';
import { utf8, fromUtf8, b64, fromB64, randomBytes, equalBytes } from './util.js';

const subtle = globalThis.crypto.subtle;

export const KEY_SIZE = 32;
export const NONCE_SIZE = 12;
export const SALT_SIZE = 16;

// Mêmes valeurs par défaut que Keyra : 64 Mio, 3 itérations, 4 voies.
export const KDF_DEFAULT = Object.freeze({ alg: 'argon2id', t: 3, m: 65536, p: 4 });
// Bornes de lecture : un fichier forgé ne doit pas pouvoir geler l'appli.
const KDF_MAX = { t: 64, m: 1024 * 1024, p: 64 };

export class AuthError extends Error {
  constructor(msg = 'Échec de l\'authentification (mot de passe incorrect ou fichier modifié).') {
    super(msg);
    this.name = 'AuthError';
  }
}

export function checkKdf(kdf) {
  const k = { alg: kdf?.alg || 'argon2id', t: Number(kdf?.t), m: Number(kdf?.m), p: Number(kdf?.p) };
  if (k.alg !== 'argon2id') throw new Error('Algorithme de dérivation inconnu.');
  if (!(k.t >= 1 && k.t <= KDF_MAX.t && k.p >= 1 && k.p <= KDF_MAX.p && k.m >= 8 * k.p && k.m <= KDF_MAX.m)) {
    throw new Error('Paramètres Argon2id hors limites.');
  }
  return k;
}

export async function deriveKey(password, salt, kdf = KDF_DEFAULT) {
  const k = checkKdf(kdf);
  return argon2id(typeof password === 'string' ? utf8(password) : password, salt, k, KEY_SIZE);
}

// --- AES-256-GCM -------------------------------------------------------------------

async function gcmKey(raw, usage) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

export async function gcmEncrypt(keyBytes, plain, aad) {
  const nonce = randomBytes(NONCE_SIZE);
  const key = await gcmKey(keyBytes, ['encrypt']);
  const params = { name: 'AES-GCM', iv: nonce, tagLength: 128 };
  if (aad) params.additionalData = typeof aad === 'string' ? utf8(aad) : aad;
  const ct = new Uint8Array(await subtle.encrypt(params, key, plain));
  return { nonce, ct };
}

export async function gcmDecrypt(keyBytes, nonce, ct, aad) {
  const key = await gcmKey(keyBytes, ['decrypt']);
  const params = { name: 'AES-GCM', iv: nonce, tagLength: 128 };
  if (aad) params.additionalData = typeof aad === 'string' ? utf8(aad) : aad;
  try {
    return new Uint8Array(await subtle.decrypt(params, key, ct));
  } catch {
    throw new AuthError();
  }
}

/** Chiffre et sérialise en {nonce, ct} base64. */
export async function seal(keyBytes, plain, aad) {
  const { nonce, ct } = await gcmEncrypt(keyBytes, plain, aad);
  return { nonce: b64(nonce), ct: b64(ct) };
}

export async function open(keyBytes, box, aad) {
  if (!box || !box.nonce || !box.ct) throw new Error('Données chiffrées manquantes.');
  const nonce = fromB64(box.nonce);
  if (nonce.length !== NONCE_SIZE) throw new Error('Nonce invalide.');
  return gcmDecrypt(keyBytes, nonce, fromB64(box.ct), aad);
}

// --- Hachage, HMAC, HKDF, PBKDF2 ------------------------------------------------------

export async function sha256(data) {
  return new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? utf8(data) : data));
}

export async function sha1Hex(text) {
  const d = new Uint8Array(await subtle.digest('SHA-1', utf8(text)));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function hmac(keyBytes, data, hash = 'SHA-256') {
  const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', key, data));
}

/** HKDF-SHA256 complet (extract + expand). */
export async function hkdf(ikm, info, len = 32, salt = new Uint8Array(32)) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: typeof info === 'string' ? utf8(info) : info }, key, len * 8);
  return new Uint8Array(bits);
}

/** HKDF-Expand seul (utilisé par Bitwarden pour « étirer » une clé). */
export async function hkdfExpand(prk, info, len = 32) {
  const out = new Uint8Array(len);
  let prev = new Uint8Array(0);
  let off = 0;
  for (let i = 1; off < len; i++) {
    const infoBytes = typeof info === 'string' ? utf8(info) : info;
    const input = new Uint8Array(prev.length + infoBytes.length + 1);
    input.set(prev, 0);
    input.set(infoBytes, prev.length);
    input[input.length - 1] = i;
    prev = await hmac(prk, input);
    out.set(prev.subarray(0, Math.min(prev.length, len - off)), off);
    off += prev.length;
  }
  return out;
}

export async function pbkdf2(password, salt, iterations, len = 32) {
  const key = await subtle.importKey('raw', typeof password === 'string' ? utf8(password) : password, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: typeof salt === 'string' ? utf8(salt) : salt, iterations }, key, len * 8);
  return new Uint8Array(bits);
}

// --- Compression (gzip natif du navigateur) -----------------------------------------

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const canCompress = typeof CompressionStream !== 'undefined';
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

// --- Bitwarden : EncString type 2 (AesCbc256_HmacSha256_B64) ----------------------------

/** Clé Bitwarden « étirée » : 32 octets de chiffrement + 32 octets de MAC. */
export async function bwStretch(key) {
  return { enc: await hkdfExpand(key, 'enc', 32), mac: await hkdfExpand(key, 'mac', 32) };
}

/** Clé dérivée d'un mot de passe selon la config KDF d'un export Bitwarden. */
export async function bwDeriveKey(password, salt, cfg) {
  const type = Number(cfg.kdfType ?? 0);
  let key;
  if (type === 0) {
    const it = Number(cfg.kdfIterations || 600000);
    if (it < 5000 || it > 2_000_000) throw new Error('Nombre d\'itérations PBKDF2 hors limites.');
    key = await pbkdf2(password, salt, it, 32);
  } else if (type === 1) {
    const t = Number(cfg.kdfIterations || 3);
    const mMiB = Number(cfg.kdfMemory || 64);
    const p = Number(cfg.kdfParallelism || 4);
    const saltHash = await sha256(utf8(salt));
    key = await argon2id(utf8(password), saltHash, checkKdf({ t, m: mMiB * 1024, p }), 32);
  } else {
    throw new Error('Type de KDF Bitwarden inconnu.');
  }
  return bwStretch(key);
}

export async function bwEncrypt(stretched, plainText) {
  const iv = randomBytes(16);
  const key = await subtle.importKey('raw', stretched.enc, { name: 'AES-CBC' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, utf8(plainText)));
  const macInput = new Uint8Array(iv.length + ct.length);
  macInput.set(iv, 0);
  macInput.set(ct, iv.length);
  const mac = await hmac(stretched.mac, macInput);
  return `2.${b64(iv)}|${b64(ct)}|${b64(mac)}`;
}

export async function bwDecrypt(stretched, encString) {
  const m = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(String(encString || '').trim());
  if (!m) throw new Error('Format chiffré Bitwarden non pris en charge.');
  const iv = fromB64(m[1]);
  const ct = fromB64(m[2]);
  const mac = fromB64(m[3]);
  const macInput = new Uint8Array(iv.length + ct.length);
  macInput.set(iv, 0);
  macInput.set(ct, iv.length);
  const expected = await hmac(stretched.mac, macInput);
  if (!equalBytes(expected, mac)) throw new AuthError('Mot de passe d\'export incorrect.');
  const key = await subtle.importKey('raw', stretched.enc, { name: 'AES-CBC' }, false, ['decrypt']);
  try {
    return fromUtf8(new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)));
  } catch {
    throw new AuthError('Mot de passe d\'export incorrect.');
  }
}

export { randomBytes, b64, fromB64, utf8, fromUtf8 };
