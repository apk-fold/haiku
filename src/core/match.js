// Correspondance entre un élément et le site / l'appli à remplir (règles de détection de Bitwarden).

import { hostname, baseDomain } from './util.js';

function hostPort(u) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`);
    return url.host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Une adresse enregistrée correspond-elle à la cible ({ url, packageName }) ? */
export function uriMatches(saved, target, defaultMatch = 'domain') {
  const uri = String(saved?.uri || '').trim();
  if (!uri) return false;
  const match = saved.match || defaultMatch;
  if (match === 'never') return false;
  if (/^androidapp:\/\//i.test(uri)) return !!target.packageName && uri.slice(13).toLowerCase() === target.packageName.toLowerCase();
  const url = target.url || (target.webDomain ? `https://${target.webDomain}` : '');
  if (!url) return false;
  switch (match) {
    case 'host': return hostPort(uri) === hostPort(url);
    case 'startsWith': return url.startsWith(uri);
    case 'exact': return url === uri;
    case 'regex':
      try { return new RegExp(uri, 'i').test(url); } catch { return false; }
    default: {
      const a = baseDomain(hostname(uri));
      return !!a && a === baseDomain(hostname(url));
    }
  }
}

/** Identifiants qui correspondent à la cible, les favoris et les plus récents d'abord. */
export function findLogins(items, target) {
  return items
    .filter((it) => !it.deletedAt && it.type === 'login' && (it.data.uris || []).some((u) => uriMatches(u, target)))
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.usedAt || '').localeCompare(a.usedAt || ''));
}

/** Nom lisible d'une appli Android (com.instagram.android → Instagram). */
export function appLabel(pkg) {
  const parts = String(pkg || '').split('.').filter((p) => !['com', 'org', 'net', 'android', 'app', 'apps', 'mobile', 'fr', 'de', 'io'].includes(p));
  const w = parts[0] || pkg || '';
  return w.charAt(0).toUpperCase() + w.slice(1);
}
