// Haiku Send : l'équivalent hors ligne de Bitwarden Send.
// Un texte ou un fichier est chiffré (PBKDF2-SHA256 + AES-256-GCM) dans une page HTML autonome.
// Le destinataire l'ouvre dans n'importe quel navigateur, tape le mot de passe que tu lui donnes
// par un autre canal, et la page se déchiffre localement. Rien ne transite par un serveur.

import { pbkdf2, gcmEncrypt, randomBytes } from './crypto.js';
import { b64, utf8, esc } from './util.js';

export const SEND_ITERATIONS = 600000;
export const MAX_SEND_FILE = 15 * 1024 * 1024;

export async function buildSend({ name, kind = 'text', text = '', file = null, password, expiresAt = null, hideText = false, accent = '#a78bfa' }) {
  if (!password || password.length < 6) throw new Error('Choisis un mot de passe d\'au moins 6 caractères.');
  let content;
  let meta;
  if (kind === 'file') {
    if (!file) throw new Error('Aucun fichier choisi.');
    if (file.size > MAX_SEND_FILE) throw new Error('Fichier trop lourd (15 Mo au plus).');
    content = new Uint8Array(await file.arrayBuffer());
    meta = { kind: 'file', fileName: file.name, mime: file.type || 'application/octet-stream', size: file.size };
  } else {
    if (!text.trim()) throw new Error('Le texte est vide.');
    content = utf8(text);
    meta = { kind: 'text', hideText };
  }
  const salt = randomBytes(16);
  const key = await pbkdf2(password, salt, SEND_ITERATIONS, 32);
  const { nonce, ct } = await gcmEncrypt(key, content, utf8('haiku-send:v1'));
  const blob = { v: 1, salt: b64(salt), iv: b64(nonce), ct: b64(ct), iter: SEND_ITERATIONS, expiresAt, ...meta };
  return { html: page(name || 'Haiku Send', blob, accent), size: ct.length };
}

function page(title, blob, accent) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} — Haiku Send</title>
<style>
:root{--a:${esc(accent)};color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 20% -10%,color-mix(in srgb,var(--a) 35%,transparent),transparent),#07050d;color:#eee;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:520px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:28px;backdrop-filter:blur(20px);box-shadow:0 30px 80px rgba(0,0,0,.5)}
h1{margin:0 0 4px;font-size:22px}p{color:#aaa;margin:0 0 18px;font-size:14px}
input,button{width:100%;font:inherit;border-radius:14px;padding:14px 16px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff}
button{margin-top:12px;background:var(--a);color:#0b0614;font-weight:700;border:0;cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.35);padding:16px;border-radius:14px;margin:16px 0 0;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
.err{color:#ff8a8a;min-height:1.4em;margin-top:10px;font-size:14px}.logo{font-weight:800;letter-spacing:.3em;font-size:12px;color:var(--a);margin-bottom:14px}
.hid{filter:blur(8px);cursor:pointer;transition:filter .3s}.hid:hover{filter:blur(6px)}
</style></head><body><div class="card"><div class="logo">HAIKU · SEND</div><h1>${esc(title)}</h1>
<p id="info">Contenu chiffré. Saisis le mot de passe qu'on t'a transmis : le déchiffrement se fait dans ton navigateur, rien n'est envoyé.</p>
<form id="f"><input id="pw" type="password" placeholder="Mot de passe" autocomplete="off" autofocus><button>Déverrouiller</button></form>
<div class="err" id="err"></div><div id="out"></div></div>
<script>
const S=${JSON.stringify(blob)};
const d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const err=document.getElementById('err'),out=document.getElementById('out');
if(S.expiresAt&&Date.now()>new Date(S.expiresAt).getTime()){document.getElementById('f').remove();err.textContent='Ce Send a expiré le '+new Date(S.expiresAt).toLocaleString('fr-FR')+'.';}
else if(S.expiresAt){document.getElementById('info').textContent+=' Expire le '+new Date(S.expiresAt).toLocaleString('fr-FR')+'.';}
document.getElementById('f').onsubmit=async e=>{e.preventDefault();err.textContent='Déchiffrement…';
try{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(document.getElementById('pw').value),'PBKDF2',false,['deriveKey']);
const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:d(S.salt),iterations:S.iter},k,{name:'AES-GCM',length:256},false,['decrypt']);
const pt=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:d(S.iv),additionalData:new TextEncoder().encode('haiku-send:v1')},key,d(S.ct)));
err.textContent='';document.getElementById('f').remove();
if(S.kind==='file'){const u=URL.createObjectURL(new Blob([pt],{type:S.mime}));const a=document.createElement('a');a.href=u;a.download=S.fileName;a.textContent='Télécharger '+S.fileName;a.style.cssText='display:block;margin-top:16px;padding:14px;border-radius:14px;background:var(--a);color:#0b0614;text-align:center;font-weight:700;text-decoration:none';out.appendChild(a);}
else{const p=document.createElement('pre');p.textContent=new TextDecoder().decode(pt);if(S.hideText){p.className='hid';p.title='Toucher pour afficher';p.onclick=()=>p.classList.remove('hid');}out.appendChild(p);
const b=document.createElement('button');b.textContent='Copier';b.onclick=()=>navigator.clipboard.writeText(p.textContent).then(()=>b.textContent='Copié ✓');out.appendChild(b);}
}catch(x){err.textContent='Mot de passe incorrect.';}};
</script></body></html>`;
}
