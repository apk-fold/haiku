// Réglages de l'appli (hors coffre) : apparence, modules, sécurité, générateur.
// Rangés dans le stockage local du téléphone. Aucun secret ici : les enveloppes PIN sont chiffrées.

import { deepClone } from './core/util.js';
import { PASSWORD_DEFAULTS, PASSPHRASE_DEFAULTS, USERNAME_DEFAULTS } from './core/generator.js';

const KEY = 'haiku.prefs.v1';

export const SKINS = {
  haiku: { name: 'Haïku', accent: '#a78bfa', accent2: '#f472b6', mode: 'dark', bg: 'aurora', font: 'sora', display: 'syne' },
  sumi: { name: 'Sumi-e', accent: '#e8e4da', accent2: '#c2413b', mode: 'amoled', bg: 'ink', font: 'manrope', display: 'shippori' },
  sakura: { name: 'Sakura', accent: '#f9a8d4', accent2: '#fda4af', mode: 'dark', bg: 'sakura', font: 'outfit', display: 'shippori' },
  neon: { name: 'Néon', accent: '#22d3ee', accent2: '#e879f9', mode: 'amoled', bg: 'grid', font: 'spacegrotesk', display: 'unbounded' },
  matrix: { name: 'Matrice', accent: '#4ade80', accent2: '#a3e635', mode: 'amoled', bg: 'rain', font: 'jetbrainsmono', display: 'jetbrainsmono' },
  solar: { name: 'Solaire', accent: '#fb923c', accent2: '#facc15', mode: 'dark', bg: 'particles', font: 'outfit', display: 'syne' },
  glacier: { name: 'Glacier', accent: '#7dd3fc', accent2: '#a5b4fc', mode: 'glass', bg: 'aurora', font: 'manrope', display: 'sora' },
  papier: { name: 'Papier', accent: '#7c3aed', accent2: '#db2777', mode: 'light', bg: 'waves', font: 'sora', display: 'shippori' },
  mono: { name: 'Monochrome', accent: '#f5f5f5', accent2: '#a3a3a3', mode: 'amoled', bg: 'none', font: 'spacegrotesk', display: 'spacegrotesk' },
};

export const FONTS = {
  sora: 'Sora',
  manrope: 'Manrope',
  outfit: 'Outfit',
  spacegrotesk: 'Space Grotesk',
  syne: 'Syne',
  unbounded: 'Unbounded',
  shippori: 'Shippori Mincho',
  jetbrainsmono: 'JetBrains Mono',
  system: 'Système',
};

export const BACKGROUNDS = {
  aurora: 'Aurore',
  particles: 'Constellation',
  ink: 'Encre (sumi-e)',
  sakura: 'Pétales de sakura',
  grid: 'Grille rétro',
  waves: 'Ondes',
  rain: 'Pluie de code',
  none: 'Aucun',
};

export const TRANSITIONS = {
  slide: 'Glissé',
  zoom: 'Zoom',
  flip: 'Bascule 3D',
  curtain: 'Rideau',
  blur: 'Flou',
  none: 'Aucune',
};

// Modules : chaque fonction de l'appli est un module qu'on active, range et place dans la barre.
export const MODULES = {
  home: { name: 'Accueil', short: 'Accueil', icon: 'house', route: '#/home', core: true, desc: 'Tableau de bord fait de widgets.' },
  vault: { name: 'Coffre', short: 'Coffre', icon: 'lock', route: '#/vault', core: true, desc: 'Tous tes éléments, recherche, filtres.' },
  totp: { name: 'Authentificateur', short: '2FA', icon: 'timer', route: '#/totp', desc: 'Codes 2FA (TOTP, Steam), scan de QR, import Google Authenticator.' },
  gen: { name: 'Générateur', short: 'Générer', icon: 'dices', route: '#/gen', desc: 'Mots de passe, phrases de passe, identifiants, PIN.' },
  health: { name: 'Santé', short: 'Santé', icon: 'shield-check', route: '#/health', desc: 'Rapports : faibles, réutilisés, fuites, 2FA…' },
  send: { name: 'Send', short: 'Send', icon: 'send', route: '#/send', desc: 'Partager un secret chiffré en page autonome.' },
  folders: { name: 'Dossiers & étiquettes', short: 'Dossiers', icon: 'folder', route: '#/folders', desc: 'Ranger, renommer, colorer.' },
  activity: { name: 'Historique', short: 'Historique', icon: 'history', route: '#/activity', desc: 'Toutes les modifications, versions restaurables.' },
  trash: { name: 'Corbeille', short: 'Corbeille', icon: 'trash-2', route: '#/trash', desc: 'Éléments supprimés, purge automatique.' },
  transfer: { name: 'Import / Export', short: 'Import', icon: 'arrow-down-up', route: '#/transfer', desc: 'Bitwarden, Keyra, KeePass, navigateurs…' },
  backups: { name: 'Sauvegardes', short: 'Sauvegardes', icon: 'archive', route: '#/backups', desc: 'Copies chiffrées automatiques du coffre.' },
  studio: { name: 'Studio', short: 'Studio', icon: 'palette', route: '#/studio', core: true, desc: 'Thèmes, couleurs, polices, effets.' },
  settings: { name: 'Réglages', short: 'Réglages', icon: 'settings', route: '#/settings', core: true, desc: 'Sécurité, verrouillage, coffres.' },
};

export const WIDGETS = {
  haiku: { name: 'Haïku du jour', icon: 'feather' },
  search: { name: 'Recherche', icon: 'search' },
  shortcuts: { name: 'Raccourcis', icon: 'zap' },
  favorites: { name: 'Favoris', icon: 'star' },
  totp: { name: 'Codes 2FA', icon: 'timer' },
  health: { name: 'Score de santé', icon: 'gauge' },
  recent: { name: 'Récents', icon: 'clock' },
  quickgen: { name: 'Générateur express', icon: 'dices' },
  stats: { name: 'Statistiques', icon: 'activity' },
  folders: { name: 'Dossiers', icon: 'folder' },
  tags: { name: 'Nuage d\'étiquettes', icon: 'tags' },
};

export const DEFAULTS = {
  appearance: {
    skin: 'haiku',
    mode: 'dark', // dark | amoled | light | glass
    accent: '#a78bfa',
    accent2: '#f472b6',
    bg: 'aurora',
    bgIntensity: 0.7,
    font: 'sora',
    display: 'syne',
    radius: 20,
    density: 'comfortable', // comfortable | compact
    blur: 20,
    glow: true,
    grain: true,
    motion: 2, // 0 aucune, 1 douce, 2 normale, 3 « de fou »
    transition: 'slide',
    listStyle: 'cards', // cards | rows | grid
    iconStyle: 'monogram', // monogram | type
    tilt: true,
    haptics: true,
    intro: true,
    tabLabels: true,
    lockArt: 'enso', // enso | haiku | minimal
  },
  modules: {
    enabled: { totp: true, gen: true, health: true, send: true, folders: true, activity: true, trash: true, transfer: true, backups: true },
    tabs: ['home', 'vault', 'totp', 'gen', 'settings'],
    home: ['haiku', 'search', 'shortcuts', 'favorites', 'totp', 'health', 'recent', 'quickgen', 'stats', 'tags'],
    homeOff: ['folders'],
  },
  security: {
    lockAfter: 300, // secondes d'inactivité ; 0 = immédiatement en arrière-plan ; -1 = jamais
    lockOnBackground: true,
    clipboardClear: 30, // 0 = jamais
    secureScreen: true,
    revealMode: 'tap', // tap | hold
    trashDays: 30, // 0 = jamais
    autoBackup: true,
    backupKeep: 10,
    lastVault: '',
    maxPinAttempts: 5,
  },
  generator: {
    mode: 'password',
    password: { ...PASSWORD_DEFAULTS },
    passphrase: { ...PASSPHRASE_DEFAULTS },
    username: { ...USERNAME_DEFAULTS },
    pinLength: 6,
  },
  vault: {
    sort: 'name', // name | updated | created | used
    filter: 'all',
    groupByFolder: false,
  },
};

function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = {};
    for (const k of Object.keys(base)) out[k] = merge(base[k], over?.[k]);
    // clés inconnues conservées (modules activés, etc.)
    if (over && typeof over === 'object') for (const k of Object.keys(over)) if (!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined || over === null || typeof over !== typeof base ? base : over;
}

let state = (() => {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return deepClone(DEFAULTS);
  }
})();

const listeners = new Set();

export const prefs = {
  get: () => state,
  get a() { return state.appearance; },
  get m() { return state.modules; },
  get s() { return state.security; },
  get g() { return state.generator; },
  set(section, patch) {
    state = { ...state, [section]: { ...state[section], ...patch } };
    save();
    for (const fn of listeners) fn(section, patch);
  },
  replace(next) {
    state = merge(DEFAULTS, next);
    save();
    for (const fn of listeners) fn('*', {});
  },
  reset(section) {
    state = { ...state, [section]: deepClone(DEFAULTS[section]) };
    save();
    for (const fn of listeners) fn(section, {});
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  moduleOn(id) {
    return !!MODULES[id] && (MODULES[id].core || state.modules.enabled[id] !== false);
  },
};

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* plein */ }
}

// Réglages locaux par coffre (code PIN, biométrie) : hors du fichier du coffre.
export const vaultPrefs = {
  get(id) {
    try { return JSON.parse(localStorage.getItem(`haiku.vault.${id}`) || '{}'); } catch { return {}; }
  },
  set(id, patch) {
    const v = { ...vaultPrefs.get(id), ...patch };
    localStorage.setItem(`haiku.vault.${id}`, JSON.stringify(v));
    return v;
  },
  clear(id) {
    localStorage.removeItem(`haiku.vault.${id}`);
  },
};
