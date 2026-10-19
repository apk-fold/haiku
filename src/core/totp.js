// Authentificateur : TOTP / HOTP (RFC 6238 / 4226), Steam Guard, liens otpauth:// et
// import de l'export de Google Authenticator (otpauth-migration://).

import { hmac } from './crypto.js';
import { fromB64 } from './util.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM = '23456789BCDFGHJKMNPQRTVWXY';

export function base32Decode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s=-]/g, '');
  const out = [];
  let bits = 0;
  let val = 0;
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Clé TOTP invalide (base32 attendu).');
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((val >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let out = '';
  let bits = 0;
  let val = 0;
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(val >> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

/**
 * Lit une configuration TOTP : clé base32 seule, otpauth://totp/…, otpauth://hotp/… ou steam://SECRET.
 */
export function parseTotp(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    if (/^steam:\/\//i.test(s)) {
      return { kind: 'steam', secret: s.slice(8).replace(/\s/g, ''), algorithm: 'SHA-1', digits: 5, period: 30, issuer: 'Steam', account: '' };
    }
    if (/^otpauth:\/\//i.test(s)) {
      const u = new URL(s);
      const kind = u.hostname.toLowerCase() === 'hotp' ? 'hotp' : 'totp';
      const label = decodeURIComponent(u.pathname.replace(/^\//, ''));
      const [li, la] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
      const p = u.searchParams;
      const algo = (p.get('algorithm') || 'SHA1').toUpperCase().replace('SHA', 'SHA-');
      const issuer = p.get('issuer') || li || '';
      const isSteam = (p.get('encoder') || '').toLowerCase() === 'steam' || /steam/i.test(issuer) && p.get('digits') === '5';
      return {
        kind: isSteam ? 'steam' : kind,
        secret: (p.get('secret') || '').replace(/\s/g, ''),
        algorithm: ['SHA-1', 'SHA-256', 'SHA-512'].includes(algo) ? algo : 'SHA-1',
        digits: isSteam ? 5 : Math.min(10, Math.max(4, parseInt(p.get('digits') || '6', 10) || 6)),
        period: Math.max(5, parseInt(p.get('period') || '30', 10) || 30),
        counter: parseInt(p.get('counter') || '0', 10) || 0,
        issuer,
        account: (la || '').trim(),
      };
    }
    return { kind: 'totp', secret: s.replace(/\s/g, ''), algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' };
  } catch {
    return null;
  }
}

export function isValidTotp(raw) {
  const c = parseTotp(raw);
  if (!c || !c.secret) return false;
  try {
    return base32Decode(c.secret).length >= 5;
  } catch {
    return false;
  }
}

async function hotpValue(cfg, counter) {
  const key = base32Decode(cfg.secret);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const h = await hmac(key, msg, cfg.algorithm);
  const off = h[h.length - 1] & 0xf;
  return ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
}

/** Code courant + secondes restantes. */
export async function totpCode(raw, now = Date.now()) {
  const cfg = typeof raw === 'string' ? parseTotp(raw) : raw;
  if (!cfg || !cfg.secret) return null;
  if (cfg.kind === 'hotp') {
    const v = await hotpValue(cfg, cfg.counter || 0);
    return { code: String(v % 10 ** cfg.digits).padStart(cfg.digits, '0'), remaining: null, period: null, cfg };
  }
  const step = Math.floor(now / 1000 / cfg.period);
  const v = await hotpValue(cfg, step);
  let code;
  if (cfg.kind === 'steam') {
    let n = v;
    code = '';
    for (let i = 0; i < 5; i++) {
      code += STEAM[n % STEAM.length];
      n = Math.floor(n / STEAM.length);
    }
  } else {
    code = String(v % 10 ** cfg.digits).padStart(cfg.digits, '0');
  }
  const remaining = cfg.period - (Math.floor(now / 1000) % cfg.period);
  return { code, remaining, period: cfg.period, cfg };
}

/** Incrémente le compteur d'un lien HOTP. */
export function nextHotp(raw) {
  const cfg = parseTotp(raw);
  if (!cfg || cfg.kind !== 'hotp') return raw;
  const u = new URL(raw);
  u.searchParams.set('counter', String((cfg.counter || 0) + 1));
  return u.toString();
}

export function formatCode(code) {
  if (!code) return '';
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export function buildOtpauth({ secret, issuer = '', account = '', algorithm = 'SHA1', digits = 6, period = 30 }) {
  const label = encodeURIComponent(issuer ? `${issuer}:${account}` : account || 'Haiku');
  const p = new URLSearchParams({ secret: secret.replace(/\s/g, '').toUpperCase() });
  if (issuer) p.set('issuer', issuer);
  if (algorithm && algorithm !== 'SHA1') p.set('algorithm', algorithm);
  if (digits !== 6) p.set('digits', String(digits));
  if (period !== 30) p.set('period', String(period));
  return `otpauth://totp/${label}?${p}`;
}

// ---- otpauth-migration (export Google Authenticator, protobuf minimal) -----------------

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[pos.i++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return result;
}

function readMessage(buf) {
  const fields = [];
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const tag = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) fields.push([field, readVarint(buf, pos)]);
    else if (wire === 2) {
      const len = readVarint(buf, pos);
      fields.push([field, buf.subarray(pos.i, pos.i + len)]);
      pos.i += len;
    } else if (wire === 1) pos.i += 8;
    else if (wire === 5) pos.i += 4;
    else throw new Error('Protobuf invalide');
  }
  return fields;
}

/** Renvoie la liste des comptes d'un QR « Transférer des comptes » de Google Authenticator. */
export function parseMigration(uri) {
  const u = new URL(uri);
  const data = fromB64(decodeURIComponent(u.searchParams.get('data') || ''));
  const td = new TextDecoder();
  const out = [];
  for (const [f, v] of readMessage(data)) {
    if (f !== 1) continue;
    const o = { secret: '', name: '', issuer: '', algorithm: 'SHA1', digits: 6, type: 'totp', counter: 0 };
    for (const [ff, vv] of readMessage(v)) {
      if (ff === 1) o.secret = base32Encode(vv);
      else if (ff === 2) o.name = td.decode(vv);
      else if (ff === 3) o.issuer = td.decode(vv);
      else if (ff === 4) o.algorithm = { 2: 'SHA256', 3: 'SHA512' }[vv] || 'SHA1';
      else if (ff === 5) o.digits = vv === 2 ? 8 : 6;
      else if (ff === 6) o.type = vv === 1 ? 'hotp' : 'totp';
      else if (ff === 7) o.counter = vv;
    }
    const account = o.name.includes(':') ? o.name.split(':').slice(1).join(':').trim() : o.name;
    let link = buildOtpauth({ secret: o.secret, issuer: o.issuer, account, algorithm: o.algorithm, digits: o.digits });
    if (o.type === 'hotp') link = link.replace('otpauth://totp/', 'otpauth://hotp/') + `&counter=${o.counter}`;
    out.push({ issuer: o.issuer, account, totp: link });
  }
  return out;
}
