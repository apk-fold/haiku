// Types d'éléments du coffre : ceux de Bitwarden (identifiant, carte, identité, note, clé SSH)
// et ceux de Keyra (Wi-Fi, serveur). Chaque champ décrit comment il s'affiche et se copie.

export const TYPES = {
  login: {
    label: 'Identifiant',
    icon: 'key-round',
    hue: 268,
    fields: [
      { key: 'username', label: "Nom d'utilisateur", kind: 'text', copy: true, auto: 'username' },
      { key: 'password', label: 'Mot de passe', kind: 'secret', copy: true, gen: true },
      { key: 'totp', label: 'Clé d\'authentification (TOTP)', kind: 'totp', copy: false },
    ],
    uris: true,
  },
  card: {
    label: 'Carte bancaire',
    icon: 'credit-card',
    hue: 32,
    fields: [
      { key: 'cardholderName', label: 'Titulaire', kind: 'text', copy: true },
      { key: 'number', label: 'Numéro', kind: 'secret', copy: true, mono: true, inputmode: 'numeric' },
      { key: 'brand', label: 'Réseau', kind: 'select', options: ['', 'Visa', 'Mastercard', 'Amex', 'CB', 'Discover', 'Maestro', 'JCB', 'UnionPay', 'Diners Club', 'Autre'] },
      { key: 'expMonth', label: 'Mois d\'expiration', kind: 'select', options: ['', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'], half: true },
      { key: 'expYear', label: 'Année d\'expiration', kind: 'text', inputmode: 'numeric', half: true, placeholder: 'AAAA' },
      { key: 'code', label: 'Cryptogramme (CVV)', kind: 'secret', copy: true, mono: true, inputmode: 'numeric', half: true },
      { key: 'pin', label: 'Code PIN', kind: 'secret', copy: true, mono: true, inputmode: 'numeric', half: true },
    ],
  },
  identity: {
    label: 'Identité',
    icon: 'id-card',
    hue: 190,
    fields: [
      { key: 'title', label: 'Civilité', kind: 'select', options: ['', 'M.', 'Mme', 'Mlle', 'Dr', 'Me'], half: true },
      { key: 'firstName', label: 'Prénom', kind: 'text', copy: true, half: true },
      { key: 'middleName', label: 'Deuxième prénom', kind: 'text', copy: true, half: true },
      { key: 'lastName', label: 'Nom', kind: 'text', copy: true, half: true },
      { key: 'birthDate', label: 'Date de naissance', kind: 'date', copy: true },
      { key: 'username', label: "Nom d'utilisateur", kind: 'text', copy: true },
      { key: 'company', label: 'Société', kind: 'text', copy: true },
      { key: 'email', label: 'E-mail', kind: 'email', copy: true },
      { key: 'phone', label: 'Téléphone', kind: 'tel', copy: true },
      { key: 'ssn', label: 'N° de sécurité sociale', kind: 'secret', copy: true, mono: true },
      { key: 'passportNumber', label: 'N° de passeport', kind: 'secret', copy: true, mono: true },
      { key: 'licenseNumber', label: 'N° de permis', kind: 'secret', copy: true, mono: true },
      { key: 'idNumber', label: "N° de carte d'identité", kind: 'secret', copy: true, mono: true },
      { key: 'address1', label: 'Adresse', kind: 'text', copy: true },
      { key: 'address2', label: 'Complément', kind: 'text', copy: true },
      { key: 'address3', label: 'Complément 2', kind: 'text', copy: true },
      { key: 'postalCode', label: 'Code postal', kind: 'text', copy: true, half: true },
      { key: 'city', label: 'Ville', kind: 'text', copy: true, half: true },
      { key: 'state', label: 'Région', kind: 'text', copy: true, half: true },
      { key: 'country', label: 'Pays', kind: 'text', copy: true, half: true },
    ],
  },
  note: {
    label: 'Note sécurisée',
    icon: 'sticky-note',
    hue: 140,
    fields: [],
  },
  wifi: {
    label: 'Réseau Wi-Fi',
    icon: 'wifi',
    hue: 210,
    fields: [
      { key: 'ssid', label: 'Nom du réseau (SSID)', kind: 'text', copy: true },
      { key: 'password', label: 'Clé Wi-Fi', kind: 'secret', copy: true, gen: true },
      { key: 'security', label: 'Sécurité', kind: 'select', options: ['WPA', 'WPA2', 'WPA3', 'WEP', 'Ouvert'] },
      { key: 'hidden', label: 'Réseau masqué', kind: 'bool' },
    ],
  },
  server: {
    label: 'Serveur',
    icon: 'server',
    hue: 350,
    fields: [
      { key: 'hostname', label: 'Hôte', kind: 'text', copy: true, mono: true },
      { key: 'port', label: 'Port', kind: 'text', inputmode: 'numeric', half: true, mono: true },
      { key: 'protocol', label: 'Protocole', kind: 'select', options: ['', 'SSH', 'SFTP', 'FTP', 'RDP', 'VNC', 'HTTPS', 'HTTP', 'SMB', 'MySQL', 'PostgreSQL', 'Autre'], half: true },
      { key: 'username', label: "Nom d'utilisateur", kind: 'text', copy: true },
      { key: 'password', label: 'Mot de passe', kind: 'secret', copy: true, gen: true },
    ],
  },
  ssh: {
    label: 'Clé SSH',
    icon: 'terminal',
    hue: 160,
    fields: [
      { key: 'privateKey', label: 'Clé privée', kind: 'secret', copy: true, mono: true, multiline: true },
      { key: 'publicKey', label: 'Clé publique', kind: 'textarea', copy: true, mono: true },
      { key: 'fingerprint', label: 'Empreinte', kind: 'text', copy: true, mono: true },
      { key: 'passphrase', label: 'Phrase de passe', kind: 'secret', copy: true },
    ],
  },
};

export const TYPE_ORDER = ['login', 'card', 'identity', 'note', 'wifi', 'server', 'ssh'];

export const URI_MATCH = [
  ['', 'Par défaut'],
  ['domain', 'Domaine de base'],
  ['host', 'Hôte'],
  ['startsWith', 'Commence par'],
  ['exact', 'Exact'],
  ['regex', 'Expression régulière'],
  ['never', 'Jamais'],
];

/** Champs secrets : ceux qu'on masque et qu'on ne recherche jamais. */
export function isSecretField(type, key) {
  const f = TYPES[type]?.fields.find((x) => x.key === key);
  return f?.kind === 'secret';
}

/** Le « mot de passe principal » d'un élément (audit, historique des mots de passe). */
export function mainPassword(item) {
  if (!item?.data) return '';
  if (item.type === 'login' || item.type === 'wifi' || item.type === 'server') return item.data.password || '';
  return '';
}

export function hasPasswordField(type) {
  return type === 'login' || type === 'wifi' || type === 'server';
}

export function cardBrand(number) {
  const n = String(number || '').replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover';
  if (/^(5018|5020|5038|6304|6759|676[1-3])/.test(n)) return 'Maestro';
  if (/^35/.test(n)) return 'JCB';
  if (/^62/.test(n)) return 'UnionPay';
  if (/^3(0[0-5]|[68])/.test(n)) return 'Diners Club';
  return '';
}

/** Ligne secondaire affichée dans les listes. */
export function subtitle(item) {
  const d = item.data || {};
  switch (item.type) {
    case 'login': {
      const host = (d.uris || []).map((u) => u.uri).find(Boolean);
      return d.username || (host ? host.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '');
    }
    case 'card': {
      const last = String(d.number || '').replace(/\D/g, '').slice(-4);
      return [d.brand || cardBrand(d.number), last ? `•••• ${last}` : ''].filter(Boolean).join(' ');
    }
    case 'identity':
      return [d.firstName, d.lastName].filter(Boolean).join(' ') || d.email || '';
    case 'wifi':
      return d.ssid ? `${d.ssid}${d.security ? ` · ${d.security}` : ''}` : '';
    case 'server':
      return d.hostname ? `${d.username ? `${d.username}@` : ''}${d.hostname}${d.port ? `:${d.port}` : ''}` : '';
    case 'ssh':
      return d.fingerprint || (d.publicKey ? d.publicKey.slice(0, 32) + '…' : '');
    case 'note':
      return item.notes ? 'Note sécurisée' : '';
    default:
      return '';
  }
}

export function cardExpired(d, today = new Date()) {
  const m = parseInt(d?.expMonth, 10);
  let y = parseInt(d?.expYear, 10);
  if (!m || !y) return false;
  if (y < 100) y += 2000;
  return y < today.getFullYear() || (y === today.getFullYear() && m < today.getMonth() + 1);
}

/** Élément vierge du type demandé. */
export function blankItem(type = 'login') {
  const data = {};
  for (const f of TYPES[type]?.fields || []) data[f.key] = f.kind === 'bool' ? false : f.kind === 'select' ? f.options[0] || '' : '';
  if (type === 'login') data.uris = [];
  if (type === 'wifi') data.security = 'WPA2';
  return {
    id: null,
    type,
    name: '',
    folderId: null,
    favorite: false,
    tags: [],
    notes: '',
    reprompt: false,
    data,
    fields: [],
    attachments: [],
    passwordHistory: [],
    history: [],
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
    usedAt: null,
  };
}

/** Normalise un élément lu (import, ancienne version) en complétant les champs manquants. */
export function normalizeItem(raw) {
  const type = TYPES[raw?.type] ? raw.type : 'login';
  const base = blankItem(type);
  const item = { ...base, ...raw, type };
  item.data = { ...base.data, ...(raw?.data || {}) };
  if (type === 'login') item.data.uris = Array.isArray(item.data.uris) ? item.data.uris.filter((u) => u && typeof u.uri === 'string').map((u) => ({ uri: u.uri, match: u.match || '' })) : [];
  for (const k of ['tags', 'fields', 'attachments', 'passwordHistory', 'history']) if (!Array.isArray(item[k])) item[k] = [];
  item.name = String(item.name || '').slice(0, 200);
  item.notes = String(item.notes || '');
  item.favorite = !!item.favorite;
  item.reprompt = !!item.reprompt;
  return item;
}
