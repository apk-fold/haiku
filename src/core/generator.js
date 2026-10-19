// Générateur : mots de passe, phrases de passe, noms d'utilisateur, codes PIN.
// Tirages uniformes avec crypto.getRandomValues, entropie exacte affichée.

import { randomInt, pick, shuffle } from './util.js';

export const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/~';
const AMBIGUOUS = 'Il1O0o|`\'"';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

export const PASSWORD_DEFAULTS = { length: 20, lower: true, upper: true, digits: true, symbols: true, minDigits: 1, minSymbols: 1, avoidAmbiguous: false, custom: '' };
export const PASSPHRASE_DEFAULTS = { words: 5, separator: '-', capitalize: true, number: true, lang: 'fr' };
export const USERNAME_DEFAULTS = { mode: 'word', capitalize: false, number: true, email: '', domain: '' };

const lists = {};

export async function wordlist(lang = 'fr') {
  if (!lists[lang]) {
    const mod = lang === 'en' ? await import('./wordlists/en.js') : await import('./wordlists/fr.js');
    lists[lang] = mod.default.split(' ');
  }
  return lists[lang];
}

export function generatePassword(opts = {}) {
  const o = { ...PASSWORD_DEFAULTS, ...opts };
  const strip = (s) => (o.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join('') : s);
  const classes = [];
  if (o.lower) classes.push({ set: strip(LOWER), min: 1 });
  if (o.upper) classes.push({ set: strip(UPPER), min: 1 });
  if (o.digits) classes.push({ set: strip(DIGITS), min: Math.max(1, o.minDigits | 0) });
  if (o.symbols) classes.push({ set: strip(o.custom || SYMBOLS), min: Math.max(1, o.minSymbols | 0) });
  if (!classes.length) classes.push({ set: strip(LOWER), min: 1 });
  const length = Math.max(5, Math.min(128, o.length | 0));
  const alphabet = [...new Set(classes.map((c) => c.set).join(''))].join('');
  const chars = [];
  for (const c of classes) for (let i = 0; i < c.min && chars.length < length; i++) chars.push(pick(c.set));
  while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)]);
  const value = shuffle(chars).join('');
  // Borne basse prudente : on ne compte pas l'aléa de placement des classes imposées.
  return { value, entropy: Math.log2(alphabet.length) * length, kind: 'password' };
}

export async function generatePassphrase(opts = {}) {
  const o = { ...PASSPHRASE_DEFAULTS, ...opts };
  const list = await wordlist(o.lang);
  const n = Math.max(3, Math.min(20, o.words | 0));
  const words = [];
  for (let i = 0; i < n; i++) {
    let w = pick(list);
    if (o.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  let entropy = Math.log2(list.length) * n;
  if (o.number) {
    const at = randomInt(n);
    words[at] = words[at] + randomInt(10);
    entropy += Math.log2(10) + Math.log2(n);
  }
  return { value: words.join(o.separator ?? '-'), entropy, kind: 'passphrase' };
}

export async function generateUsername(opts = {}) {
  const o = { ...USERNAME_DEFAULTS, ...opts };
  const rnd = (n) => Array.from({ length: n }, () => (LOWER + DIGITS)[randomInt(36)]).join('');
  if (o.mode === 'plus') {
    const [user, dom] = String(o.email || '').split('@');
    if (!user || !dom) throw new Error('Indique ton adresse e-mail (exemple : moi@gmail.com).');
    return { value: `${user}+${rnd(8)}@${dom}`, entropy: Math.log2(36) * 8, kind: 'username' };
  }
  if (o.mode === 'catchall') {
    const dom = String(o.domain || '').replace(/^@/, '').trim();
    if (!dom) throw new Error('Indique ton domaine (exemple : mondomaine.fr).');
    return { value: `${rnd(10)}@${dom}`, entropy: Math.log2(36) * 10, kind: 'username' };
  }
  if (o.mode === 'random') return { value: rnd(12), entropy: Math.log2(36) * 12, kind: 'username' };
  const list = await wordlist(o.lang || 'fr');
  let w = pick(list) + (randomInt(2) ? '_' : '') + pick(list);
  if (o.capitalize) w = w[0].toUpperCase() + w.slice(1);
  let entropy = Math.log2(list.length) * 2 + 1;
  if (o.number) {
    w += randomInt(10000);
    entropy += Math.log2(10000);
  }
  return { value: w.normalize('NFKD').replace(/[̀-ͯ]/g, ''), entropy, kind: 'username' };
}

export function generatePin(length = 6) {
  const n = Math.max(4, Math.min(12, length | 0));
  return { value: Array.from({ length: n }, () => DIGITS[randomInt(10)]).join(''), entropy: Math.log2(10) * n, kind: 'pin' };
}
