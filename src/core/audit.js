// Santé du coffre : rapports de Bitwarden (faibles, réutilisés, exposés, sites non sécurisés,
// 2FA inactive) et de Keyra (anciens, manquants, cartes expirées). Tout est local, sauf les deux
// vérifications en ligne (fuites et 2FA) qui ne partent que si tu les lances.

import { estimate } from './strength.js';
import { mainPassword, hasPasswordField, cardExpired } from './schema.js';
import { sha1Hex } from './crypto.js';
import { hostname, baseDomain } from './util.js';

export const OLD_DAYS = 365;

export const REPORTS = {
  exposed: { label: 'Exposés dans des fuites', icon: 'shield-alert', weight: 30, online: true, help: 'Mots de passe présents dans les fuites connues (Have I Been Pwned). Seuls les 5 premiers caractères de leur empreinte SHA-1 quittent le téléphone.' },
  reused: { label: 'Réutilisés', icon: 'copy', weight: 20, help: 'Le même mot de passe sert à plusieurs comptes : une seule fuite les compromet tous.' },
  weak: { label: 'Faibles', icon: 'shield-x', weight: 20, help: "Trop courts ou prévisibles d'après l'estimation hors ligne." },
  old: { label: 'Anciens (plus d\'un an)', icon: 'clock', weight: 5, help: "Mots de passe qui n'ont pas changé depuis plus d'un an." },
  missing: { label: 'Sans mot de passe', icon: 'circle-dashed', weight: 5, help: 'Identifiants avec un nom d\'utilisateur ou un site, mais aucun mot de passe.' },
  insecure: { label: 'Sites non sécurisés', icon: 'globe-lock', weight: 10, help: 'Adresses en http:// : le mot de passe circule en clair.' },
  inactive2fa: { label: '2FA disponible mais inactive', icon: 'smartphone', weight: 5, online: true, help: "Sites qui proposent la double authentification alors qu'aucune clé TOTP n'est enregistrée." },
  expired: { label: 'Cartes expirées', icon: 'credit-card', weight: 5, help: 'Cartes bancaires dont la date de validité est passée.' },
};

function passwordDate(it) {
  return it.data?.passwordRevisionDate || it.createdAt;
}

/** Rapport local (instantané). `extra` peut contenir les résultats en ligne : { exposed: Map(id→count), twofa: Set(domains) }. */
export function runAudit(items, extra = {}) {
  const active = items.filter((i) => !i.deletedAt);
  const res = { exposed: [], reused: [], weak: [], old: [], missing: [], insecure: [], inactive2fa: [], expired: [] };
  const byPw = new Map();
  const now = Date.now();

  for (const it of active) {
    if (hasPasswordField(it.type)) {
      const pw = mainPassword(it);
      if (!pw) {
        if (it.type === 'login' && (it.data.username || (it.data.uris || []).length)) res.missing.push({ item: it });
      } else {
        if (!byPw.has(pw)) byPw.set(pw, []);
        byPw.get(pw).push(it);
        const s = estimate(pw);
        if (s.score <= 2) res.weak.push({ item: it, score: s.score, label: s.label });
        const d = passwordDate(it);
        if (d && now - new Date(d).getTime() > OLD_DAYS * 86400000) res.old.push({ item: it, date: d });
        const n = extra.exposed?.get(it.id);
        if (n) res.exposed.push({ item: it, count: n });
      }
    }
    if (it.type === 'login') {
      const uris = (it.data.uris || []).map((u) => u.uri);
      if (uris.some((u) => /^http:\/\//i.test(u))) res.insecure.push({ item: it });
      if (extra.twofa && !it.data.totp) {
        const doms = uris.map((u) => baseDomain(hostname(u))).filter(Boolean);
        if (doms.some((d) => extra.twofa.has(d))) res.inactive2fa.push({ item: it });
      }
    }
    if (it.type === 'card' && cardExpired(it.data)) res.expired.push({ item: it });
  }
  for (const [, list] of byPw) if (list.length > 1) for (const it of list) res.reused.push({ item: it, count: list.length });

  // Score global sur 100 : chaque rapport pèse selon la part d'éléments concernés.
  const withPw = active.filter((i) => hasPasswordField(i.type) && mainPassword(i)).length || 1;
  let penalty = 0;
  for (const [k, r] of Object.entries(REPORTS)) {
    const base = k === 'expired' ? Math.max(1, active.filter((i) => i.type === 'card').length) : withPw;
    penalty += r.weight * Math.min(1, res[k].length / base);
  }
  const score = active.length ? Math.max(0, Math.round(100 - penalty)) : 100;
  return { results: res, score, checked: { exposed: !!extra.exposed, twofa: !!extra.twofa } };
}

/** Vérifie les mots de passe sur Have I Been Pwned (k-anonymat). Renvoie Map(id → nombre de fuites). */
export async function checkExposed(items, onProgress) {
  const out = new Map();
  const groups = new Map();
  for (const it of items.filter((i) => !i.deletedAt)) {
    const pw = mainPassword(it);
    if (!pw) continue;
    const h = await sha1Hex(pw);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(it.id);
  }
  const byPrefix = new Map();
  for (const h of groups.keys()) {
    const p = h.slice(0, 5);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(h);
  }
  let done = 0;
  for (const [prefix, hashes] of byPrefix) {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!r.ok) throw new Error(`Have I Been Pwned a répondu ${r.status}.`);
    const text = await r.text();
    const counts = new Map();
    for (const line of text.split('\n')) {
      const [suf, c] = line.trim().split(':');
      if (suf && +c > 0) counts.set(prefix + suf.toUpperCase(), +c);
    }
    for (const h of hashes) {
      const c = counts.get(h);
      if (c) for (const id of groups.get(h)) out.set(id, c);
    }
    onProgress?.(++done / byPrefix.size);
  }
  return out;
}

/** Liste des domaines qui proposent la 2FA par TOTP (2fa.directory). */
export async function fetchTwoFactorDomains() {
  const r = await fetch('https://api.2fa.directory/v3/totp.json');
  if (!r.ok) throw new Error(`2fa.directory a répondu ${r.status}.`);
  const data = await r.json();
  const set = new Set();
  for (const entry of data) {
    const info = Array.isArray(entry) ? entry[1] : entry;
    const dom = info?.domain;
    if (dom) set.add(baseDomain(dom));
    for (const a of info?.['additional-domains'] || []) set.add(baseDomain(a));
  }
  return set;
}
