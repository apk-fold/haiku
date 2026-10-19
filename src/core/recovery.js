// Clé de récupération (comme Keyra) : 32 caractères en 8 groupes de 4 (base32 de Crockford),
// 150 bits aléatoires + 2 caractères de contrôle qui détectent les fautes de frappe.

import { randomBytes } from './util.js';
import { sha256 } from './crypto.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function bitsToChars(bytes, nChars) {
  let out = '';
  let acc = 0;
  let accBits = 0;
  let i = 0;
  while (out.length < nChars) {
    if (accBits < 5) {
      acc = (acc << 8) | (bytes[i++] ?? 0);
      accBits += 8;
    }
    accBits -= 5;
    out += ALPHABET[(acc >> accBits) & 31];
  }
  return out;
}

async function checkChars(body) {
  const h = await sha256(body);
  return bitsToChars(h, 2);
}

export async function generateRecoveryKey() {
  const body = bitsToChars(randomBytes(19), 30);
  const full = body + (await checkChars(body));
  return full.match(/.{4}/g).join('-');
}

/** Saisie tolérante : casse, espaces, tirets, confusions O/0 et I/L/1. Renvoie la forme canonique ou null. */
export async function parseRecoveryKey(input) {
  const s = String(input || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== 32 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  const body = s.slice(0, 30);
  if ((await checkChars(body)) !== s.slice(30)) return null;
  return s.match(/.{4}/g).join('-');
}
