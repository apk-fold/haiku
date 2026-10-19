// Étiquettes (règles reprises de Keyra) et recherche.

import { norm } from './util.js';
import { TYPES, subtitle } from './schema.js';

export const MAX_TAGS = 20;
export const MAX_TAG_LEN = 32;

/** Nettoie une étiquette ; renvoie '' si elle est invalide. */
export function cleanTag(raw) {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim();
  if (!t || t.length > MAX_TAG_LEN) return '';
  if (/[,\p{Cc}\p{Cf}]/u.test(t)) return '';
  return t;
}

export const tagKey = (t) => norm(t);

/** Liste d'étiquettes valides, sans doublon logique (Linux = linux, École = ecole), 20 au plus. */
export function normalizeTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const t = cleanTag(raw);
    if (!t) continue;
    const k = tagKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Analyse une recherche :
 *  - texte libre : chaque mot doit être présent (nom, utilisateur, URL, dossier, étiquettes, type)
 *  - #linux ou #"écoles primaires" : étiquette exacte (casse et accents ignorés), cumulables
 *  - filtres : is:fav, type:carte|wifi|…, has:totp, has:pj, in:dossier
 */
export function parseQuery(q) {
  const res = { words: [], tags: [], fav: false, types: [], has: [], folder: '' };
  const re = /#"([^"]+)"|#(\S+)|(\S+)/g;
  let m;
  const typeAlias = { identifiant: 'login', login: 'login', carte: 'card', card: 'card', identite: 'identity', identity: 'identity', note: 'note', wifi: 'wifi', serveur: 'server', server: 'server', ssh: 'ssh' };
  while ((m = re.exec(String(q || '')))) {
    if (m[1] || m[2]) {
      const t = cleanTag(m[1] || m[2]);
      if (t) res.tags.push(tagKey(t));
      continue;
    }
    const w = m[3];
    const lw = norm(w);
    if (lw === '#') continue;
    if (lw === 'is:fav' || lw === 'is:favori') { res.fav = true; continue; }
    if (lw.startsWith('type:')) { const t = typeAlias[lw.slice(5)]; if (t) { res.types.push(t); continue; } }
    if (lw.startsWith('has:')) { res.has.push(lw.slice(4)); continue; }
    if (lw.startsWith('in:')) { res.folder = lw.slice(3); continue; }
    res.words.push(lw);
  }
  return res;
}

/** Texte indexé d'un élément : jamais les secrets. */
export function haystack(item, folderName = '') {
  const d = item.data || {};
  const parts = [item.name, folderName, TYPES[item.type]?.label, subtitle(item), ...(item.tags || [])];
  if (item.type === 'login') parts.push(d.username, ...(d.uris || []).map((u) => u.uri));
  if (item.type === 'identity') parts.push(d.firstName, d.lastName, d.email, d.company, d.city);
  if (item.type === 'card') parts.push(d.cardholderName, d.brand);
  if (item.type === 'wifi') parts.push(d.ssid);
  if (item.type === 'server') parts.push(d.hostname, d.username, d.protocol);
  for (const f of item.fields || []) if (f.type !== 'hidden') parts.push(f.name);
  return norm(parts.filter(Boolean).join(' '));
}

export function matches(item, query, folderName = '') {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  if (q.fav && !item.favorite) return false;
  if (q.types.length && !q.types.includes(item.type)) return false;
  if (q.folder && !norm(folderName).includes(q.folder)) return false;
  for (const h of q.has) {
    if ((h === 'totp' || h === '2fa') && !item.data?.totp) return false;
    if ((h === 'pj' || h === 'fichier') && !(item.attachments || []).length) return false;
    if (h === 'notes' && !item.notes) return false;
  }
  if (q.tags.length) {
    const keys = new Set((item.tags || []).map(tagKey));
    if (!q.tags.every((t) => keys.has(t))) return false;
  }
  if (q.words.length) {
    const hay = haystack(item, folderName);
    if (!q.words.every((w) => hay.includes(w))) return false;
  }
  return true;
}
