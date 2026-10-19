// Petits utilitaires partagés (encodages, aléatoire, dates, normalisation).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s) => enc.encode(String(s ?? ''));
export const fromUtf8 = (b) => dec.decode(b);

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const clean = String(str || '').replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

/** Entier uniforme dans [0, max) sans biais de modulo. */
export function randomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export const pick = (arr) => arr[randomInt(arr.length)];

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowIso = () => new Date().toISOString();

/** Comparaison en temps constant (pour les empreintes). */
export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function wipe(bytes) {
  if (bytes && bytes.fill) bytes.fill(0);
}

/** Minuscules sans accents : base de toutes les recherches (comme Keyra). */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hostname(url) {
  if (!url) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return (u.hostname || '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Domaine « de base » (example.co.uk → example.co.uk, a.b.example.com → example.com). */
export function baseDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const twoLevel = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'gouv'].includes(sld) && parts[parts.length - 1].length === 2;
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

export function formatDate(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `il y a ${d} j`;
  const mo = Math.round(d / 30.4);
  if (mo < 12) return `il y a ${mo} mois`;
  const y = Math.round(mo / 12);
  return `il y a ${y} an${y > 1 ? 's' : ''}`;
}

export function formatBytes(n) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Couleur stable dérivée d'un texte (monogrammes). */
export function hueOf(text) {
  let h = 0;
  const s = norm(text);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name) {
  const words = String(name || '?').replace(/https?:\/\//, '').split(/[\s._@-]+/).filter(Boolean);
  if (!words.length) return '?';
  const a = words[0][0] || '?';
  const b = words.length > 1 ? words[1][0] : words[0][1] || '';
  return (a + b).toUpperCase();
}
