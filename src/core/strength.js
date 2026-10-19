// Estimation hors ligne de la robustesse d'un mot de passe.
//
// Le mot de passe est découpé en morceaux (mot du dictionnaire, éventuellement en « leet »,
// mot de passe courant, année ou date, suite, répétition, trajet sur le clavier, ou caractères
// quelconques). Chaque morceau a un coût en bits pour un attaquant qui essaie d'abord les choses
// prévisibles ; le découpage retenu est celui qui coûte le moins (programmation dynamique).
// C'est une estimation, pas une garantie : seul un mot de passe tiré au hasard est sûr.

import { wordlist } from './generator.js';

// Mots de passe parmi les plus répandus (listes publiques de fuites), en minuscules.
export const COMMON = new Set(`
123456 123456789 12345678 12345 1234567 1234567890 111111 000000 123123 654321 666666 121212 112233
696969 7777777 987654321 159753 147258 123321 password password1 password123 passw0rd motdepasse
motdepasse1 azerty azerty123 azertyuiop qwerty qwerty123 qwertyuiop qwertz 1q2w3e4r 1qaz2wsx zaq12wsx
abc123 iloveyou jetaime jetaime1 soleil bonjour doudou chouchou marseille loulou coucou nounours
admin administrator root toor letmein welcome bienvenue monkey dragon master sunshine princess
football baseball superman batman trustno1 changeme secret starwars pokemon naruto minecraft fortnite
liverpool chelsea arsenal barcelona juventus olympique paris france amour toto tototo titi tata
chocolat camille thomas nicolas julien lucas leo hugo emma lea manon zxcvbnm asdfgh asdfghjkl
`.split(/\s+/).filter(Boolean));

const KEYBOARDS = [
  ['azertyuiop', 'qsdfghjklm', 'wxcvbn'],
  ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  ['qwertzuiop', 'asdfghjkl', 'yxcvbnm'],
  ['1234567890'],
];
const UNLEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't', '€': 'e' };

export const LABELS = ['Très faible', 'Faible', 'Moyen', 'Robuste', 'Très robuste'];
const STEPS = [25, 40, 55, 75];
export const scoreForBits = (bits) => STEPS.filter((s) => bits >= s).length;

let dict = null;
let loading = null;

/** Charge le dictionnaire (listes FR + EN du générateur). Sans lui, l'estimation est plus optimiste. */
export function loadDictionary() {
  if (!loading) {
    loading = Promise.all([wordlist('fr'), wordlist('en')]).then(([fr, en]) => {
      dict = new Set();
      for (const w of [...fr, ...en]) {
        const n = plain(w);
        if (n.length >= 3 && /^[a-z]+$/.test(n)) dict.add(n);
      }
      return dict;
    }).catch(() => null);
  }
  return loading;
}

const plain = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const log2 = Math.log2;

function charsetBits(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 26;
  if (/[A-Z]/.test(pw)) n += 26;
  if (/\d/.test(pw)) n += 10;
  if (/[^a-zA-Z0-9\u0080-￿]/.test(pw)) n += 32;
  if (/[\u0080-￿]/.test(pw)) n += 64;
  return log2(Math.max(n, 2));
}

function caseBits(orig) {
  if (orig === orig.toLowerCase()) return 0;
  if (orig === orig.toUpperCase() || (orig[0] !== orig[0].toLowerCase() && orig.slice(1) === orig.slice(1).toLowerCase())) return 1;
  const ups = [...orig].filter((c) => c !== c.toLowerCase()).length;
  return Math.min(orig.length, 1 + log2(orig.length) * Math.min(ups, orig.length - ups));
}

function keyboardSpan(low, i) {
  let best = 0;
  for (const layout of KEYBOARDS) {
    for (const row of layout) {
      for (const r of [row, [...row].reverse().join('')]) {
        let len = 0;
        while (i + len < low.length && r.includes(low.slice(i, i + len + 1))) len++;
        best = Math.max(best, len);
      }
    }
  }
  return best;
}

/** Morceaux prévisibles commençant à i : [fin, coût en bits, avertissement]. */
function matchesAt(pw, low, deleet, i, charset) {
  const out = [];
  const n = pw.length;
  // mots de passe courants et dictionnaire (y compris en « leet »)
  for (let j = Math.min(n, i + 20); j >= i + 3; j--) {
    const a = low.slice(i, j);
    const b = deleet.slice(i, j);
    const subs = a === b ? 0 : [...a].filter((c, k) => c !== b[k]).length;
    const extra = caseBits(pw.slice(i, j)) + (subs ? 1 + subs : 0);
    if (COMMON.has(a) || COMMON.has(b)) out.push([j, log2(COMMON.size) + extra, 'Contient un mot de passe très courant.']);
    else if (dict && j - i >= 4 && (dict.has(a) || dict.has(b))) out.push([j, log2(dict.size) + extra, 'Contient un mot du dictionnaire.']);
  }
  // même caractère répété
  let r = 1;
  while (i + r < n && low[i + r] === low[i]) r++;
  if (r >= 3) out.push([i + r, charset + log2(r), 'Caractères répétés.']);
  // motif répété (abcabc)
  for (let size = 2; size <= 6 && i + size * 2 <= n; size++) {
    const unit = low.slice(i, i + size);
    let k = 1;
    while (low.slice(i + k * size, i + (k + 1) * size) === unit) k++;
    if (k >= 2) out.push([i + k * size, charset * Math.min(size, 3) + log2(k) + 1, 'Motif répété.']);
  }
  // suite (abc, 987)
  for (const dir of [1, -1]) {
    let s = 1;
    while (i + s < n && low.charCodeAt(i + s) - low.charCodeAt(i + s - 1) === dir) s++;
    if (s >= 3) out.push([i + s, log2(36) + log2(s) + 1, 'Suite de caractères.']);
  }
  // trajet sur le clavier (azerty, qsdf)
  const kb = keyboardSpan(low, i);
  if (kb >= 4) out.push([i + kb, log2(40) + log2(kb) + 2, 'Trajet sur le clavier.']);
  // dates et années
  const rest = pw.slice(i);
  const year = /^(19[3-9]\d|20[0-4]\d)/.exec(rest);
  if (year) out.push([i + 4, log2(120), 'Année.']);
  const date = /^(0?[1-9]|[12]\d|3[01])[-/.]?(0?[1-9]|1[0-2])[-/.]?((19|20)?\d\d)/.exec(rest);
  if (date && date[0].length >= 6) out.push([i + date[0].length, log2(31 * 12 * 100), 'Date.']);
  return out;
}

export function estimate(password) {
  const pw = String(password || '');
  if (!pw) return { score: 0, bits: 0, label: LABELS[0], warnings: ['Mot de passe vide.'] };
  const low = plain(pw);
  if (COMMON.has(low)) return { score: 0, bits: log2(COMMON.size), label: LABELS[0], warnings: ['Fait partie des mots de passe les plus utilisés.'] };
  const deleet = [...low].map((c) => UNLEET[c] || c).join('');
  const charset = charsetBits(pw);
  const n = pw.length;
  // best[i] = coût minimal pour deviner pw[i..] ; on garde le chemin pour les avertissements.
  const best = new Array(n + 1).fill(Infinity);
  const via = new Array(n + 1).fill(null);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    best[i] = charset + best[i + 1];
    via[i] = [i + 1, null];
    for (const [j, cost, warn] of matchesAt(pw, low, deleet, i, charset)) {
      const c = cost + 1 + best[j]; // +1 bit : « où commence le morceau suivant »
      if (c < best[i]) { best[i] = c; via[i] = [j, warn]; }
    }
  }
  const warnings = [];
  for (let i = 0; i < n;) {
    const [j, w] = via[i];
    if (w && !warnings.includes(w)) warnings.push(w);
    i = j;
  }
  const bits = Math.max(0, best[0] - 1);
  if (n < 12) warnings.push('Moins de 12 caractères.');
  const score = scoreForBits(bits);
  return { score, bits, label: LABELS[score], warnings: score >= 3 ? [] : warnings };
}

/** Temps de cassage indicatif (10 milliards d'essais par seconde, attaque hors ligne rapide). */
export function crackTime(bits) {
  const seconds = 2 ** Math.max(0, bits - 1) / 1e10;
  const units = [[31557600e9, "milliards d'années"], [31557600e6, "millions d'années"], [31557600e3, 'millénaires'], [31557600, 'ans'], [2629800, 'mois'], [86400, 'jours'], [3600, 'heures'], [60, 'minutes'], [1, 'secondes']];
  if (seconds < 1) return 'instantané';
  for (const [s, u] of units) if (seconds >= s) {
    const v = seconds / s;
    return v > 1000 ? `plus de 1000 ${u}` : `${Math.round(v)} ${u}`;
  }
  return 'instantané';
}
