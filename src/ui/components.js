// Composants d'interface : toasts, feuilles glissantes, menus, dialogues, QR, scanner, champs.

import { gsap, Draggable, fx } from './fx.js';
import { icon } from './icons.js';
import { el, $, $$, on } from './dom.js';
import { esc, hueOf, initials, randomInt } from '../core/util.js';
import { TYPES } from '../core/schema.js';
import { copyText, haptic } from '../platform.js';
import { prefs } from '../prefs.js';
import qrcode from '../vendor/qrcode.js';
import { estimate, crackTime } from '../core/strength.js';

// ---- toast ----------------------------------------------------------------------------

let toastTimer;
export function toast(msg, { icon: ic = 'check', kind = '', ms = 2200 } = {}) {
  const t = $('#toast');
  if (!t) return;
  t.className = `toast ${kind}`;
  t.innerHTML = `${icon(ic, 18)}<span>${esc(msg)}</span>`;
  gsap.killTweensOf(t);
  gsap.fromTo(t, { y: 40, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: fx.d(0.5) || 0.01, ease: 'back.out(2)' });
  if (fx.on) gsap.fromTo(t.querySelector('svg'), { rotation: -90, scale: 0 }, { rotation: 0, scale: 1, duration: fx.d(0.6), ease: 'elastic.out(1,0.5)', delay: 0.05 });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => gsap.to(t, { y: 30, opacity: 0, duration: fx.d(0.3) || 0.01 }), ms);
}

export const toastError = (e) => toast(e?.message || String(e), { icon: 'circle-alert', kind: 'error', ms: 3500 });

// ---- copie ------------------------------------------------------------------------------

export async function copy(text, { label = 'Copié', sensitive = true, from = null } = {}) {
  if (text == null || text === '') return;
  await copyText(text, sensitive, sensitive ? prefs.s.clipboardClear : 0);
  haptic('light');
  const clear = sensitive && prefs.s.clipboardClear ? ` · effacé dans ${prefs.s.clipboardClear} s` : '';
  toast(`${label}${clear}`, { icon: 'copy' });
  if (from) {
    const r = from.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 10, velocity: [160, 360], gravity: 600 });
    fx.press(from);
  }
}

// ---- feuilles glissantes (bottom sheets) -------------------------------------------------------

const stack = [];

export function sheet({ title = '', body = '', className = '', onClose, full = false, actions = '' } = {}) {
  const root = $('#overlays');
  const scrim = el('<div class="scrim"></div>');
  const s = el(`<section class="sheet ${full ? 'full' : ''} ${className}" role="dialog" aria-modal="true">
    <div class="sheet-grip"><i></i></div>
    ${title ? `<header class="sheet-head"><h2>${title}</h2><button class="ic-btn" data-close aria-label="Fermer">${icon('x')}</button></header>` : ''}
    <div class="sheet-body"></div>
    ${actions ? `<footer class="sheet-foot">${actions}</footer>` : ''}
  </section>`);
  const bodyEl = s.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  root.append(scrim, s);
  let closed = false;
  const close = (val) => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    drag?.kill();
    gsap.to(scrim, { opacity: 0, duration: fx.d(0.25) || 0.01, onComplete: () => scrim.remove() });
    gsap.to(s, { yPercent: 105, duration: fx.d(0.32) || 0.01, ease: 'power3.in', onComplete: () => { s.remove(); onClose?.(val); } });
  };
  const api = { el: s, body: bodyEl, close };
  stack.push(api);
  scrim.addEventListener('click', () => close());
  on(s, 'click', '[data-close]', () => close());
  gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: fx.d(0.3) || 0.01 });
  gsap.fromTo(s, { yPercent: 100 }, { yPercent: 0, duration: fx.d(0.55) || 0.01, ease: fx.wild ? 'back.out(1.2)' : 'haiku' });
  fx.stagger(s.querySelectorAll('.sheet-body > *'), { delay: fx.d(0.12), y: 16, each: 0.03 });
  // Glisser vers le bas pour fermer.
  let drag = null;
  const grip = s.querySelector('.sheet-grip');
  if (grip) {
    drag = Draggable.create(s, {
      type: 'y',
      trigger: [grip, s.querySelector('.sheet-head')].filter(Boolean),
      bounds: { minY: 0, maxY: window.innerHeight },
      inertia: true,
      onDrag() { scrim.style.opacity = String(Math.max(0, 1 - this.y / 400)); },
      onRelease() {
        if (this.y > 110 || this.getVelocity('y') > 600) close();
        else { gsap.to(s, { y: 0, duration: 0.4, ease: 'back.out(2)' }); gsap.to(scrim, { opacity: 1, duration: 0.3 }); }
      },
    })[0];
  }
  return api;
}

export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export const sheetsOpen = () => stack.length > 0;

/** Menu d'actions. items: [{ icon, label, value, danger, hint, disabled }] → valeur choisie ou null. */
export function menu(items, { title = '' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const body = `<div class="menu">${items.filter(Boolean).map((it, i) => it === '-' ? '<hr>' : `
      <button class="menu-item tap ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
        <span class="mi-ic">${icon(it.icon || 'chevron-right')}</span>
        <span class="mi-txt"><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
      </button>`).join('')}</div>`;
    const list = items.filter(Boolean);
    const s = sheet({ title, body, onClose: () => resolve(chosen) });
    on(s.el, 'click', '[data-i]', (e, b) => {
      chosen = list[+b.dataset.i].value;
      haptic('select');
      fx.ripple(e, b);
      s.close();
    });
  });
}

export function confirm({ title = 'Confirmer', message = '', ok = 'Confirmer', danger = false, icon: ic = danger ? 'triangle-alert' : 'circle-help' } = {}) {
  return new Promise((resolve) => {
    let val = false;
    const s = sheet({
      title: '',
      body: `<div class="dialog"><div class="dialog-ic ${danger ? 'danger' : ''}">${icon(ic, 28)}</div><h3>${esc(title)}</h3>${message ? `<p>${message}</p>` : ''}</div>`,
      actions: `<button class="btn ghost tap" data-close>Annuler</button><button class="btn ${danger ? 'danger' : 'primary'} tap" data-ok>${esc(ok)}</button>`,
      onClose: () => resolve(val),
    });
    if (danger) fx.shake(s.el.querySelector('.dialog-ic'));
    else fx.pop(s.el.querySelector('.dialog-ic'));
    s.el.querySelector('[data-ok]').onclick = () => { val = true; s.close(); };
  });
}

/** Formulaire en feuille. fields: [{ name, label, type, value, placeholder, hint, options, autocomplete, min }] */
export function prompt({ title = '', message = '', fields = [], ok = 'Valider', validate } = {}) {
  return new Promise((resolve) => {
    let val = null;
    const html = `<form class="form dialog-form" autocomplete="off">${message ? `<p class="muted">${message}</p>` : ''}
      ${fields.map((f) => fieldInput(f)).join('')}
      <p class="err" role="alert"></p></form>`;
    const s = sheet({ title, body: html, actions: `<button class="btn ghost tap" data-close>Annuler</button><button class="btn primary tap" data-ok>${esc(ok)}</button>`, onClose: () => resolve(val) });
    const form = s.el.querySelector('form');
    bindSecretToggles(form);
    const submit = async (e) => {
      e?.preventDefault();
      const data = Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? form.elements[f.name].checked : form.elements[f.name].value]));
      try {
        if (validate) {
          const btn = s.el.querySelector('[data-ok]');
          btn.classList.add('busy');
          await validate(data);
          btn.classList.remove('busy');
        }
        val = data;
        s.close();
      } catch (err) {
        s.el.querySelector('[data-ok]').classList.remove('busy');
        form.querySelector('.err').textContent = err.message || String(err);
        fx.shake(form);
        haptic('error');
      }
    };
    form.addEventListener('submit', submit);
    s.el.querySelector('[data-ok]').onclick = submit;
    setTimeout(() => form.querySelector('input,textarea,select')?.focus(), 350);
  });
}

export function fieldInput(f) {
  const id = `f-${f.name}-${randomInt(1e6)}`;
  if (f.type === 'checkbox') return `<label class="row-switch"><span>${esc(f.label)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</span>${switchHtml(f.name, f.value)}</label>`;
  if (f.type === 'select') return `<label class="fld"><span>${esc(f.label)}</span><select name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label class="fld"><span>${esc(f.label)}</span><textarea name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></label>`;
  const secret = f.type === 'password';
  return `<label class="fld" for="${id}"><span>${esc(f.label)}</span><div class="inp ${secret ? 'secret' : ''}">
    <input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : 'autocomplete="off"'} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} autocapitalize="off" spellcheck="false" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>
    ${secret ? `<button type="button" class="ic-btn" data-toggle-secret aria-label="Afficher">${icon('eye', 18)}</button>` : ''}
  </div>${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</label>`;
}

export function bindSecretToggles(root) {
  on(root, 'click', '[data-toggle-secret]', (e, b) => {
    const inp = b.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = icon(show ? 'eye-off' : 'eye', 18);
    fx.pop(b);
  });
}

export const switchHtml = (name, checked) => `<span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><i></i></span>`;

export function segmented(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l, ic]) => `<button type="button" class="tap ${String(v) === String(value) ? 'on' : ''}" data-v="${esc(v)}">${ic ? icon(ic, 16) : ''}<span>${esc(l)}</span></button>`).join('')}<i class="seg-ind"></i></div>`;
}

/** Active un contrôle segmenté : l'indicateur glisse sous l'option choisie. */
export function bindSegmented(root, onChange) {
  const place = (seg, animate = true) => {
    const btn = seg.querySelector('button.on') || seg.querySelector('button');
    const ind = seg.querySelector('.seg-ind');
    if (!btn || !ind) return;
    const r = btn.getBoundingClientRect();
    const p = seg.getBoundingClientRect();
    const props = { x: r.left - p.left, width: r.width };
    if (animate && fx.on) gsap.to(ind, { ...props, duration: fx.d(0.5), ease: 'elastic.out(1,0.7)' });
    else gsap.set(ind, props);
  };
  $$('.seg', root).forEach((s) => requestAnimationFrame(() => place(s, false)));
  on(root, 'click', '.seg button', (e, b) => {
    const seg = b.closest('.seg');
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    place(seg);
    haptic('select');
    onChange?.(seg.dataset.seg, b.dataset.v, b);
  });
  return { refresh: () => $$('.seg', root).forEach((s) => place(s, false)) };
}

// ---- monogrammes ------------------------------------------------------------------------

export function monogram(item, size = 44) {
  const t = TYPES[item.type] || TYPES.login;
  const style = prefs.a.iconStyle;
  const h = style === 'type' ? t.hue : hueOf(item.name || item.type);
  const inner = style === 'type' || item.type !== 'login' && style !== 'monogram' ? icon(t.icon, Math.round(size * 0.45)) : esc(initials(item.name));
  return `<span class="mono" style="--h:${h};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px" data-flip-id="mono-${item.id || 'new'}">${inner}${item.type !== 'login' && style === 'monogram' ? `<i class="mono-badge">${icon(t.icon, 11)}</i>` : ''}</span>`;
}

export function emptyState(ic, title, text = '', action = '') {
  return `<div class="empty" data-in><div class="empty-art">${icon(ic, 34)}<i></i><i></i></div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
}

// ---- robustesse -----------------------------------------------------------------------

export function strengthHtml() {
  return `<div class="strength" data-score="0"><div class="bars"><i></i><i></i><i></i><i></i><i></i></div><div class="strength-txt"><b></b><small></small></div></div>`;
}

export function updateStrength(node, password) {
  if (!node) return;
  if (!password) {
    node.dataset.score = '-1';
    node.querySelector('b').textContent = '';
    node.querySelector('small').textContent = '';
    return;
  }
  const r = estimate(password);
  const prev = node.dataset.score;
  node.dataset.score = String(r.score);
  node.querySelector('b').textContent = r.label;
  node.querySelector('small').textContent = `${Math.round(r.bits)} bits · ${crackTime(r.bits)}${r.warnings[0] ? ` · ${r.warnings[0]}` : ''}`;
  if (prev !== String(r.score) && fx.on) {
    const bars = node.querySelectorAll('.bars i');
    gsap.fromTo(bars, { scaleY: 0.4 }, { scaleY: 1, duration: fx.d(0.5), ease: 'elastic.out(1,0.4)', stagger: 0.03 });
  }
  return r;
}

// ---- QR codes ------------------------------------------------------------------------------

export function qrSvg(text, { ecc = 'M', margin = 2 } = {}) {
  const q = qrcode(0, ecc);
  q.addData(unescape(encodeURIComponent(text)), 'Byte');
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  const s = n + margin * 2;
  return `<svg class="qr" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#0b0712"/></svg>`;
}

export function showQr(text, { title = 'QR code', caption = '' } = {}) {
  const s = sheet({ title, body: `<div class="qr-wrap" data-in>${qrSvg(text)}</div>${caption ? `<p class="muted center">${caption}</p>` : ''}` });
  const q = s.el.querySelector('.qr');
  if (fx.on) gsap.from(q, { scale: 0.6, rotation: -8, opacity: 0, duration: fx.d(0.8), ease: 'elastic.out(1,0.55)' });
  return s;
}

// ---- scanner de QR (caméra + jsQR, ou image) ---------------------------------------------------

export function scanQr({ title = 'Scanner un QR code' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let stream = null;
    let raf = 0;
    const s = sheet({
      title,
      full: true,
      body: `<div class="scanner"><video playsinline muted></video><div class="scan-frame"><i></i><i></i><i></i><i></i><span class="scan-line"></span></div><p class="muted center scan-msg">Vise le QR code…</p></div>
        <label class="btn ghost tap block">${icon('image', 18)}<span>Choisir une capture d'écran</span><input type="file" accept="image/*" hidden></label>`,
      onClose: () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); resolve(result); },
    });
    const video = s.el.querySelector('video');
    const msg = s.el.querySelector('.scan-msg');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let jsQR;
    import('../vendor/jsqr.js').then((m) => { jsQR = m.default; });
    const done = (text) => {
      result = text;
      haptic('success');
      const r = s.el.querySelector('.scan-frame').getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 18 });
      s.close();
    };
    const scanImage = (src, w, h) => {
      if (!jsQR) return null;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(src, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    };
    const tick = () => {
      if (video.readyState >= 2) {
        const w = Math.min(720, video.videoWidth);
        const h = Math.round(video.videoHeight * (w / video.videoWidth));
        const code = scanImage(video, w, h);
        if (code?.data) return done(code.data);
      }
      raf = requestAnimationFrame(tick);
    };
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((st) => {
        stream = st;
        video.srcObject = st;
        video.play();
        tick();
      }).catch(() => { msg.textContent = "Caméra indisponible : autorise l'accès à la caméra, ou choisis une capture d'écran du QR code."; });
    } else msg.textContent = 'Caméra indisponible ici : choisis une image.';
    if (fx.on) gsap.to(s.el.querySelector('.scan-line'), { yPercent: 2400, duration: 1.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    s.el.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
        const code = scanImage(img, Math.round(img.width * scale), Math.round(img.height * scale));
        if (code?.data) done(code.data);
        else { msg.textContent = 'Aucun QR code trouvé dans cette image.'; fx.shake(msg); }
      };
      img.src = URL.createObjectURL(f);
    });
  });
}

/** Lecture d'un fichier choisi par l'utilisateur. */
export function pickFile({ accept = '*/*', as = 'text' } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ file: f, name: f.name, size: f.size, type: f.type, content: r.result });
      r.onerror = () => resolve(null);
      if (as === 'dataurl') r.readAsDataURL(f);
      else if (as === 'file') resolve({ file: f, name: f.name, size: f.size, type: f.type });
      else r.readAsText(f);
    };
    inp.click();
  });
}
