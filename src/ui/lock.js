// Écran de verrouillage, création de coffre, mot de passe oublié, restauration.

import { gsap, fx } from './fx.js';
import { $, $$, on, el } from './dom.js';
import { icon } from './icons.js';
import { esc } from '../core/util.js';
import { prefs, vaultPrefs } from '../prefs.js';
import { session } from '../session.js';
import { haikuOfDay } from './haikus.js';
import { sheet, prompt, toast, toastError, copy, menu, confirm, showQr, pickFile, strengthHtml, updateStrength, bindSecretToggles, switchHtml, segmented, bindSegmented } from './components.js';
import { haptic, biometric, isNative } from '../platform.js';
import { generatePassphrase } from '../core/generator.js';
import { loadDictionary } from '../core/strength.js';
import { parseVaultFile } from '../core/vault.js';

const KDF_LEVELS = {
  light: { t: 3, m: 32768, p: 4, label: 'Légère', hint: '32 Mio · 3 passes — vieux téléphones' },
  standard: { t: 3, m: 65536, p: 4, label: 'Standard', hint: '64 Mio · 3 passes — comme Keyra et Bitwarden' },
  strong: { t: 4, m: 131072, p: 4, label: 'Renforcée', hint: '128 Mio · 4 passes — plus lent à ouvrir, bien plus dur à attaquer' },
};

let onUnlocked = () => {};
let selected = null;
let mode = 'password'; // password | pin

export function setUnlockHandler(fn) { onUnlocked = fn; }

const ENSO = `<svg class="enso" viewBox="0 0 200 200" aria-hidden="true">
  <defs><linearGradient id="ensoG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient>
  <filter id="ensoF"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4"/></filter></defs>
  <path class="enso-a" d="M150 52 C120 25 60 28 40 70 C20 112 45 165 98 170 C150 175 178 135 172 95 C168 72 158 61 143 54" />
  <path class="enso-b" d="M146 58 C118 34 66 36 47 73 C29 110 52 158 99 162 C146 166 170 131 165 97" />
  <g class="keyhole"><circle cx="100" cy="92" r="11"/><path d="M94 99 L89 124 Q100 128 111 124 L106 99 Z"/></g>
</svg>`;

export function renderLock(reason) {
  const root = $('#lock');
  root.hidden = false;
  document.body.classList.add('locked');
  const vaults = session.list;
  if (!vaults.length) return renderWelcome(root);
  if (!selected || !vaults.find((v) => v.id === selected)) selected = vaults.find((v) => v.id === prefs.s.lastVault)?.id || vaults[0].id;
  const vp = vaultPrefs.get(selected);
  const pinEnv = session.pinEnvelope(selected);
  mode = pinEnv ? 'pin' : 'password';
  const art = prefs.a.lockArt;
  const poem = haikuOfDay();
  const v = vaults.find((x) => x.id === selected);
  root.innerHTML = `<div class="lock-wrap">
    <div class="lock-art ${art}">${art !== 'minimal' ? ENSO : ''}</div>
    <div class="lock-brand"><h1 class="wordmark">HAIKU</h1>${art === 'haiku' || art === 'enso' ? `<p class="lock-poem">${poem.map((l) => `<span>${esc(l)}</span>`).join('')}</p>` : ''}</div>
    <div class="lock-card glass">
      ${window.__haikuAutofill ? `<p class="lock-af">${icon('zap', 14)}Remplir dans ${esc(window.__haikuAutofill.webDomain || window.__haikuAutofill.packageName || 'une appli')}</p>` : ''}
      <button class="vault-pick tap" data-act="pick">${icon('lock', 16)}<span>${esc(v.name)}</span>${vaults.length > 1 ? icon('chevron-down', 16) : ''}</button>
      <div class="lock-mode"></div>
      <p class="err" role="alert"></p>
      <p class="lock-hint" hidden></p>
    </div>
    <nav class="lock-links">
      <button class="link tap" data-act="forgot">Mot de passe oublié ?</button>
      <button class="link tap" data-act="more">${icon('ellipsis-vertical', 16)}<span>Plus</span></button>
    </nav>
  </div>`;
  renderMode(root, v, vp, pinEnv);
  on(root, 'click', '[data-act]', (e, b) => act(b.dataset.act, root, b));
  intro(root, reason);
  if (session.hasBiometric(selected) && reason !== 'manual-no-bio') setTimeout(() => tryBiometric(root), fx.on ? 700 : 100);
}

function renderMode(root, v, vp, pinEnv) {
  const box = root.querySelector('.lock-mode');
  const bio = session.hasBiometric(selected);
  if (mode === 'pin' && pinEnv) {
    const n = pinEnv.length || 6;
    box.innerHTML = `<div class="pin-dots" data-n="${n}">${'<i></i>'.repeat(n)}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="key tap" data-k="${d}">${d}</button>`).join('')}
      <button class="key tap ghost" data-k="${bio ? 'bio' : 'pw'}">${icon(bio ? 'fingerprint' : 'key-round', 22)}</button>
      <button class="key tap" data-k="0">0</button>
      <button class="key tap ghost" data-k="del">${icon('arrow-left', 22)}</button></div>
      <button class="link tap" data-act="use-password">Utiliser le mot de passe maître</button>`;
    let pin = '';
    const dots = box.querySelectorAll('.pin-dots i');
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    box.querySelector('.pinpad').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      fx.press(b);
      haptic('light');
      const k = b.dataset.k;
      if (k === 'bio') return tryBiometric(root);
      if (k === 'pw') { mode = 'password'; return renderMode(root, v, vp, pinEnv); }
      if (k === 'del') { pin = pin.slice(0, -1); paint(); return; }
      if (pin.length >= n) return;
      pin += k;
      paint();
      if (fx.on) gsap.fromTo(dots[pin.length - 1], { scale: 1.8 }, { scale: 1, duration: 0.4, ease: 'elastic.out(1,0.4)' });
      if (pin.length === n) {
        const val = pin;
        pin = '';
        await attempt(root, () => session.unlockPin(selected, val), () => { paint(); });
      }
    });
    window.onkeydown = (e) => {
      if (!document.body.classList.contains('locked')) return;
      if (/^\d$/.test(e.key)) box.querySelector(`[data-k="${e.key}"]`)?.click();
      if (e.key === 'Backspace') box.querySelector('[data-k="del"]')?.click();
    };
  } else {
    box.innerHTML = `<form class="pw-form" autocomplete="off">
        <div class="inp secret big"><input name="pw" type="password" placeholder="Mot de passe maître" autocomplete="current-password" autocapitalize="off" spellcheck="false" enterkeyhint="go">
        <button type="button" class="ic-btn" data-toggle-secret aria-label="Afficher">${icon('eye', 18)}</button></div>
        <button class="btn primary unlock-btn tap" type="submit" aria-label="Déverrouiller">${icon('arrow-right', 22)}</button>
      </form>
      <div class="lock-alt">${bio ? `<button class="chip tap" data-act="bio">${icon('fingerprint', 16)}<span>Biométrie</span></button>` : ''}${pinEnv ? `<button class="chip tap" data-act="use-pin">${icon('grid-2x2', 16)}<span>Code PIN</span></button>` : ''}</div>`;
    bindSecretToggles(box);
    const form = box.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = form.pw.value;
      if (!pw) { fx.shake(form); return; }
      await attempt(root, () => session.unlockPassword(selected, pw), () => {
        form.pw.select();
        const hint = session.list.find((x) => x.id === selected)?.hint;
        const h = root.querySelector('.lock-hint');
        if (hint) { h.hidden = false; h.innerHTML = `${icon('info', 14)} Indice : ${esc(hint)}`; }
      });
    });
    if (!session.hasBiometric(selected)) setTimeout(() => form.pw.focus({ preventScroll: true }), fx.on ? 900 : 50);
  }
}

async function attempt(root, fn, onFail) {
  const card = root.querySelector('.lock-card');
  const err = root.querySelector('.err');
  err.textContent = '';
  card.classList.add('busy');
  const keyhole = root.querySelector('.keyhole');
  const spin = keyhole && fx.on ? gsap.to(keyhole, { rotation: 360, transformOrigin: '50% 40%', duration: 1.2, repeat: -1, ease: 'none' }) : null;
  try {
    const v = await fn();
    spin?.kill();
    haptic('success');
    await unlockAnimation(root);
    onUnlocked(v);
  } catch (e) {
    spin?.kill();
    if (keyhole) gsap.to(keyhole, { rotation: 0, duration: 0.3 });
    card.classList.remove('busy');
    err.textContent = e.message || 'Échec du déverrouillage.';
    haptic('error');
    fx.shake(card);
    fx.glitch(root.querySelector('.wordmark'));
    onFail?.(e);
  }
}

async function tryBiometric(root) {
  if (!session.hasBiometric(selected)) return;
  await attempt(root, () => session.unlockBiometric(selected), (e) => {
    if (/annul|cancel|negative/i.test(e.message || '')) root.querySelector('.err').textContent = '';
    if (/invalid|révoqu|changé/i.test(e.message || '')) session.disableBiometric(selected);
  });
}

async function act(a, root, b) {
  haptic('light');
  const v = session.list.find((x) => x.id === selected);
  if (a === 'pick') {
    if (session.list.length < 2) return;
    const id = await menu(session.list.map((x) => ({ icon: x.id === selected ? 'circle-check' : 'lock', label: x.name, value: x.id, hint: x.hasRecovery ? 'Clé de récupération active' : '' })), { title: 'Choisir un coffre' });
    if (id) { selected = id; renderLock('switch'); }
  } else if (a === 'use-password') {
    mode = 'password';
    renderMode(root, v, vaultPrefs.get(selected), session.pinEnvelope(selected));
  } else if (a === 'use-pin') {
    mode = 'pin';
    renderMode(root, v, vaultPrefs.get(selected), session.pinEnvelope(selected));
  } else if (a === 'bio') tryBiometric(root);
  else if (a === 'forgot') forgot(root);
  else if (a === 'more') {
    const r = await menu([
      { icon: 'plus', label: 'Créer un nouveau coffre', value: 'new' },
      { icon: 'archive-restore', label: 'Restaurer une sauvegarde', hint: 'Fichier .haiku (sauvegarde ou autre téléphone)', value: 'restore' },
    ], { title: 'Coffres' });
    if (r === 'new') createVaultFlow();
    if (r === 'restore') restoreFlow();
  }
}

async function forgot(root) {
  const v = session.list.find((x) => x.id === selected);
  if (!v.hasRecovery) {
    await confirm({ title: 'Pas de clé de récupération', message: `Le coffre « ${esc(v.name)} » n'a pas de clé de récupération. Sans le mot de passe maître, son contenu est indéchiffrable : c'est le principe même du chiffrement.${v.hint ? `<br><br>Indice : <b>${esc(v.hint)}</b>` : ''}<br><br>Si tu as une sauvegarde plus ancienne dont tu connais le mot de passe, tu peux la restaurer.`, ok: 'Compris', icon: 'key-round' });
    return;
  }
  let newKey = null;
  const r = await prompt({
    title: 'Mot de passe oublié',
    message: 'Saisis ta clé de récupération (32 caractères) et choisis un nouveau mot de passe maître. Une nouvelle clé sera créée : l\'ancienne ne marchera plus.',
    fields: [
      { name: 'key', label: 'Clé de récupération', placeholder: 'XXXX-XXXX-XXXX-…' },
      { name: 'pw', label: 'Nouveau mot de passe maître', type: 'password', autocomplete: 'new-password' },
      { name: 'pw2', label: 'Confirmation', type: 'password', autocomplete: 'new-password' },
    ],
    ok: 'Réinitialiser',
    validate: async ({ key, pw, pw2 }) => {
      if (pw.length < 8) throw new Error('Au moins 8 caractères.');
      if (pw !== pw2) throw new Error('Les deux mots de passe diffèrent.');
      newKey = await session.recover(selected, key, pw);
    },
  });
  if (r && newKey) {
    await showRecoveryKey(newKey, true);
    await unlockAnimation(root);
    onUnlocked(session.vault);
  }
}

async function restoreFlow() {
  const f = await pickFile({ accept: '.haiku,.json,application/json,*/*' });
  if (!f) return;
  try {
    parseVaultFile(f.content);
  } catch {
    await confirm({ title: 'Ce n\'est pas un coffre Haiku', message: 'Pour importer depuis Bitwarden, Keyra, KeePass ou un navigateur, crée d\'abord ton coffre puis va dans <b>Import / Export</b>.', ok: 'Compris', icon: 'info' });
    return;
  }
  let newId = null;
  await prompt({
    title: 'Restaurer ce coffre',
    message: `Fichier « ${esc(f.name)} ». Il s'ouvre avec le mot de passe maître en vigueur au moment de la sauvegarde. Il sera ajouté comme nouveau coffre : rien n'est écrasé.`,
    fields: [{ name: 'pw', label: 'Mot de passe maître de la sauvegarde', type: 'password' }],
    ok: 'Restaurer',
    validate: async ({ pw }) => { newId = await session.restoreVaultFile(f.content, pw); },
  });
  if (newId) {
    selected = newId;
    toast('Coffre restauré', { icon: 'archive-restore' });
    fx.confetti();
    renderLock('restore');
  }
}

export async function showRecoveryKey(key, mandatory = false) {
  return new Promise((resolve) => {
    let confirmed = false;
    const s = sheet({
      title: 'Clé de récupération',
      body: `<div class="rk">
        <p class="muted">Elle permet de retrouver l'accès si tu oublies ton mot de passe maître. <b>Elle ne sera plus jamais affichée.</b> Écris-la sur papier ou range-la hors de ce téléphone.</p>
        <div class="rk-key mono-font">${key.split('-').map((g) => `<span>${g}</span>`).join('')}</div>
        <div class="row gap"><button class="btn ghost tap" data-copy>${icon('copy', 16)}<span>Copier</span></button><button class="btn ghost tap" data-qr>${icon('qr-code', 16)}<span>QR code</span></button></div>
        <label class="row-switch"><span>Je l'ai notée en lieu sûr</span>${switchHtml('ok', false)}</label>
      </div>`,
      actions: `<button class="btn primary tap block" data-done disabled>Terminé</button>`,
      onClose: () => resolve(confirmed),
    });
    if (fx.on) gsap.from(s.el.querySelectorAll('.rk-key span'), { opacity: 0, y: 14, rotationX: -90, stagger: 0.07, duration: 0.6, ease: 'back.out(2)', delay: 0.25 });
    s.el.querySelectorAll('.rk-key span').forEach((sp) => fx.on && gsap.delayedCall(0.3, () => fx.scramble(sp, sp.textContent, { chars: '0123456789ABCDEFGHJKMNPQRSTVWXYZ', duration: 1 })));
    s.el.querySelector('[data-copy]').onclick = (e) => copy(key, { label: 'Clé copiée', from: e.currentTarget });
    s.el.querySelector('[data-qr]').onclick = () => showQr(key, { title: 'Clé de récupération', caption: 'À photographier avec un autre appareil hors ligne, ou à imprimer.' });
    const done = s.el.querySelector('[data-done]');
    s.el.querySelector('input[name=ok]').onchange = (e) => { done.disabled = !e.target.checked; if (e.target.checked) fx.pop(done); };
    done.onclick = () => { confirmed = true; s.close(); };
    void mandatory;
  });
}

// ---- création d'un coffre (assistant en 4 étapes) -------------------------------------------

export function createVaultFlow({ first = false } = {}) {
  loadDictionary();
  const st = { name: first ? 'Mon coffre' : '', pw: '', pw2: '', hint: '', folders: true, kdf: 'standard', step: 0 };
  const s = sheet({ title: 'Nouveau coffre', full: true, body: '<div class="wizard"><div class="wiz-steps"><i></i><i></i><i></i><i></i></div><div class="wiz-body"></div></div>', actions: '<button class="btn ghost tap" data-prev>Retour</button><button class="btn primary tap" data-next>Continuer</button>' });
  const body = s.el.querySelector('.wiz-body');
  const prev = s.el.querySelector('[data-prev]');
  const next = s.el.querySelector('[data-next]');
  const steps = [
    () => `<div class="wiz-pane"><div class="wiz-ic">${icon('lock', 30)}</div><h3>Nomme ton coffre</h3><p class="muted">Tu pourras en créer d'autres (perso, travail…). Le nom reste visible sur l'écran de verrouillage.</p>
      <label class="fld"><span>Nom</span><div class="inp"><input name="name" value="${esc(st.name)}" maxlength="60" placeholder="Mon coffre"></div></label>
      <label class="row-switch"><span>Créer les dossiers de base<small>Personnel, Travail, Finances, Réseaux sociaux, E-mail, Achats</small></span>${switchHtml('folders', st.folders)}</label></div>`,
    () => `<div class="wiz-pane"><div class="wiz-ic">${icon('key-round', 30)}</div><h3>Mot de passe maître</h3><p class="muted">Le seul à retenir. Il n'est jamais enregistré : s'il est perdu sans clé de récupération, le coffre l'est aussi.</p>
      <label class="fld"><span>Mot de passe maître</span><div class="inp secret"><input name="pw" type="password" value="${esc(st.pw)}" autocomplete="new-password"><button type="button" class="ic-btn" data-toggle-secret>${icon('eye', 18)}</button></div></label>
      ${strengthHtml()}
      <button class="btn ghost small tap" data-suggest type="button">${icon('wand-sparkles', 16)}<span>Me proposer une phrase de passe</span></button>
      <label class="fld"><span>Confirmation</span><div class="inp secret"><input name="pw2" type="password" value="${esc(st.pw2)}" autocomplete="new-password"><button type="button" class="ic-btn" data-toggle-secret>${icon('eye', 18)}</button></div></label>
      <label class="fld"><span>Indice (facultatif, visible sans mot de passe)</span><div class="inp"><input name="hint" value="${esc(st.hint)}" maxlength="120"></div></label></div>`,
    () => `<div class="wiz-pane"><div class="wiz-ic">${icon('cpu', 30)}</div><h3>Résistance aux attaques</h3><p class="muted">Argon2id transforme ton mot de passe en clé. Plus il utilise de mémoire, plus chaque essai coûte cher à un attaquant (et plus l'ouverture prend une fraction de seconde).</p>
      <div class="choice-list">${Object.entries(KDF_LEVELS).map(([k, l]) => `<button type="button" class="choice tap ${st.kdf === k ? 'on' : ''}" data-kdf="${k}"><b>${l.label}</b><small>${l.hint}</small>${icon('circle-check', 20, 'chk')}</button>`).join('')}</div></div>`,
    () => `<div class="wiz-pane"><div class="wiz-ic">${icon('shield-check', 30)}</div><h3>Clé de récupération</h3><p class="muted">Conseillée : 32 caractères qui permettent de réinitialiser le mot de passe maître si tu l'oublies.</p>
      <div class="choice-list"><button type="button" class="choice tap on" data-rk="yes"><b>Créer une clé de récupération</b><small>Recommandé</small>${icon('circle-check', 20, 'chk')}</button>
      <button type="button" class="choice tap" data-rk="no"><b>Plus tard</b><small>Dans Réglages › Ce coffre</small>${icon('circle-check', 20, 'chk')}</button></div></div>`,
  ];
  let rk = 'yes';
  const show = (dir = 1) => {
    body.innerHTML = steps[st.step]();
    bindSecretToggles(body);
    s.el.querySelectorAll('.wiz-steps i').forEach((d, i) => d.classList.toggle('on', i <= st.step));
    prev.style.visibility = st.step ? 'visible' : 'hidden';
    next.innerHTML = st.step === steps.length - 1 ? `${icon('sparkles', 18)}<span>Créer le coffre</span>` : 'Continuer';
    if (fx.on) {
      gsap.from(body.firstElementChild, { x: 60 * dir, opacity: 0, duration: fx.d(0.5), ease: 'haiku' });
      fx.stagger(body.querySelectorAll('.wiz-pane > *'), { y: 14, each: 0.05 });
      fx.pop(body.querySelector('.wiz-ic'), 1.4);
    }
    const pw = body.querySelector('[name=pw]');
    if (pw) {
      const meter = body.querySelector('.strength');
      updateStrength(meter, pw.value);
      pw.addEventListener('input', () => updateStrength(meter, pw.value));
      body.querySelector('[data-suggest]').onclick = async () => {
        const g = await generatePassphrase({ words: 6, lang: 'fr', separator: '-', capitalize: true, number: true });
        pw.type = 'text';
        body.querySelector('[name=pw2]').type = 'text';
        fx.scramble(pw, g.value);
        pw.value = g.value;
        body.querySelector('[name=pw2]').value = '';
        updateStrength(meter, g.value);
        toast('Note-la bien, puis recopie-la dans « Confirmation »', { icon: 'feather', ms: 3500 });
      };
    }
    body.querySelectorAll('[data-kdf]').forEach((b) => (b.onclick = () => { st.kdf = b.dataset.kdf; body.querySelectorAll('[data-kdf]').forEach((x) => x.classList.toggle('on', x === b)); fx.pop(b, 1.04); }));
    body.querySelectorAll('[data-rk]').forEach((b) => (b.onclick = () => { rk = b.dataset.rk; body.querySelectorAll('[data-rk]').forEach((x) => x.classList.toggle('on', x === b)); fx.pop(b, 1.04); }));
    setTimeout(() => body.querySelector('input')?.focus({ preventScroll: true }), 300);
  };
  const read = () => {
    for (const k of ['name', 'pw', 'pw2', 'hint']) { const i = body.querySelector(`[name=${k}]`); if (i) st[k] = i.value; }
    const f = body.querySelector('[name=folders]');
    if (f) st.folders = f.checked;
  };
  const fail = (msg) => { toast(msg, { icon: 'circle-alert', kind: 'error' }); fx.shake(body.firstElementChild); haptic('error'); };
  prev.onclick = () => { read(); if (st.step) { st.step--; show(-1); } };
  next.onclick = async () => {
    read();
    if (st.step === 0 && !st.name.trim()) return fail('Donne un nom au coffre.');
    if (st.step === 1) {
      if (st.pw.length < 8) return fail('Au moins 8 caractères (une phrase de passe de 5 mots, c\'est mieux).');
      if (st.pw !== st.pw2) return fail('La confirmation ne correspond pas.');
    }
    if (st.step < steps.length - 1) { st.step++; show(1); return; }
    next.classList.add('busy');
    next.disabled = true;
    try {
      const l = KDF_LEVELS[st.kdf];
      const v = await session.create({ name: st.name.trim(), password: st.pw, hint: st.hint, folders: st.folders, kdf: { alg: 'argon2id', t: l.t, m: l.m, p: l.p } });
      s.close();
      if (rk === 'yes') {
        const key = await v.setRecoveryKey();
        const ok = await showRecoveryKey(key);
        if (!ok) { await v.removeRecoveryKey(); toast('Clé de récupération retirée (non confirmée)', { icon: 'info' }); }
      }
      await session.refresh();
      fx.confetti();
      const root = $('#lock');
      await unlockAnimation(root);
      onUnlocked(v);
    } catch (e) {
      next.classList.remove('busy');
      next.disabled = false;
      toastError(e);
    }
  };
  show();
}

// ---- premier lancement -------------------------------------------------------------------

function renderWelcome(root) {
  const poem = haikuOfDay();
  root.innerHTML = `<div class="lock-wrap welcome">
    <div class="lock-art enso">${ENSO}</div>
    <div class="lock-brand"><h1 class="wordmark">HAIKU</h1><p class="lock-poem">${poem.map((l) => `<span>${esc(l)}</span>`).join('')}</p></div>
    <div class="welcome-card glass">
      <p>Ton coffre-fort de mots de passe, <b>chiffré et hors ligne</b>. Rien ne quitte ce téléphone.</p>
      <ul class="feat"><li>${icon('shield-check', 16)}Argon2id + AES-256-GCM</li><li>${icon('timer', 16)}Codes 2FA intégrés</li><li>${icon('arrow-down-up', 16)}Import Bitwarden, Keyra, KeePass…</li><li>${icon('palette', 16)}Entièrement personnalisable</li></ul>
      <button class="btn primary block tap" data-act="create">${icon('sparkles', 18)}<span>Créer mon coffre</span></button>
      <button class="btn ghost block tap" data-act="restore">${icon('archive-restore', 18)}<span>Restaurer une sauvegarde</span></button>
    </div>
  </div>`;
  on(root, 'click', '[data-act]', (e, b) => (b.dataset.act === 'create' ? createVaultFlow({ first: true }) : restoreFlow()));
  intro(root, 'welcome');
}

// ---- animations ---------------------------------------------------------------------------

function intro(root, reason) {
  const art = root.querySelector('.enso');
  if (art) {
    fx.draw(art.querySelectorAll('.enso-a, .enso-b'), { duration: 1.6, each: 0.25 });
    if (fx.on) gsap.from(art.querySelector('.keyhole'), { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: fx.d(0.9), delay: fx.d(0.9), ease: 'elastic.out(1,0.5)' });
    if (fx.on) gsap.to(art, { rotation: 3, y: -6, duration: 4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }
  const word = root.querySelector('.wordmark');
  fx.splitIn(word, { delay: fx.d(0.3), each: 0.07, y: '1em' });
  const lines = root.querySelectorAll('.lock-poem span');
  if (fx.on) gsap.from(lines, { opacity: 0, y: 10, filter: 'blur(6px)', stagger: fx.d(0.35), duration: fx.d(1), delay: fx.d(0.9), ease: 'power2.out' });
  fx.stagger(root.querySelectorAll('.lock-card, .welcome-card, .lock-links'), { delay: fx.d(reason === 'welcome' ? 1.2 : 0.5), y: 30 });
}

function unlockAnimation(root) {
  return new Promise((resolve) => {
    if (!fx.on) { resolve(); return; }
    const tl = gsap.timeline({ onComplete: resolve });
    const kh = root.querySelector('.keyhole');
    const enso = root.querySelector('.enso');
    if (kh) tl.to(kh, { rotation: -90, transformOrigin: '50% 40%', duration: fx.d(0.35), ease: 'back.out(3)' });
    if (enso) tl.to(enso, { scale: fx.wild ? 9 : 5, opacity: 0, duration: fx.d(0.7), ease: 'power3.in' }, '-=0.05');
    tl.to(root.querySelectorAll('.lock-card, .lock-links, .lock-brand, .welcome-card'), { y: 40, opacity: 0, duration: fx.d(0.4), stagger: 0.04, ease: 'power2.in' }, enso ? '<' : 0);
    if (fx.wild) {
      const r = (enso || root).getBoundingClientRect();
      tl.call(() => fx.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 30, velocity: [300, 800] }), null, '<0.2');
    }
  });
}

export function hideLock() {
  const root = $('#lock');
  document.body.classList.remove('locked');
  window.onkeydown = null;
  const shell = $('#shell');
  if (fx.on) {
    gsap.fromTo(shell, { clipPath: 'circle(0% at 50% 38%)' }, { clipPath: 'circle(150% at 50% 38%)', duration: fx.d(0.9), ease: 'power3.inOut', clearProps: 'clipPath' });
    gsap.to(root, { opacity: 0, duration: fx.d(0.5), delay: fx.d(0.2), onComplete: () => { root.hidden = true; root.innerHTML = ''; gsap.set(root, { clearProps: 'all' }); } });
  } else {
    root.hidden = true;
    root.innerHTML = '';
  }
}

export { KDF_LEVELS, segmented, bindSegmented, isNative, biometric };
