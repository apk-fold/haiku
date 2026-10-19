// Génération de clés SSH Ed25519 au format OpenSSH (comme les clés SSH de Bitwarden).

import { b64, utf8 } from './util.js';
import { sha256 } from './crypto.js';

function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function str(bytes) {
  const b = typeof bytes === 'string' ? utf8(bytes) : bytes;
  return concat(u32(b.length), b);
}
function concat(...parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const sshSupported = async () => {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
};

export async function generateEd25519(comment = 'haiku') {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  const pubBlob = concat(str('ssh-ed25519'), str(pub));
  const check = crypto.getRandomValues(new Uint8Array(4));
  let priv = concat(check, check, str('ssh-ed25519'), str(pub), str(concat(seed, pub)), str(comment));
  const pad = [];
  for (let i = 1; (priv.length + pad.length) % 8 !== 0; i++) pad.push(i);
  priv = concat(priv, new Uint8Array(pad));
  const body = concat(utf8('openssh-key-v1\0'), str('none'), str('none'), str(new Uint8Array(0)), u32(1), str(pubBlob), str(priv));
  const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64(body).match(/.{1,70}/g).join('\n')}\n-----END OPENSSH PRIVATE KEY-----`;
  const publicKey = `ssh-ed25519 ${b64(pubBlob)} ${comment}`;
  const fingerprint = `SHA256:${b64(await sha256(pubBlob)).replace(/=+$/, '')}`;
  seed.fill(0);
  return { privateKey: pem, publicKey, fingerprint };
}

/** Empreinte d'une clé publique OpenSSH collée par l'utilisateur. */
export async function fingerprintOf(publicKey) {
  const m = /^(ssh-[\w-]+|ecdsa-[\w-]+)\s+([A-Za-z0-9+/=]+)/.exec(String(publicKey || '').trim());
  if (!m) return '';
  try {
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return `SHA256:${b64(await sha256(bin)).replace(/=+$/, '')}`;
  } catch {
    return '';
  }
}
