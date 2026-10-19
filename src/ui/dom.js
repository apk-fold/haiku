// Petits outils DOM.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Crée un élément à partir d'un fragment HTML (un seul élément racine). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Délégation d'événements : on(root, 'click', '[data-act]', (e, target) => …). */
export function on(root, type, selector, fn, opts) {
  const h = (e) => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}

export function attr(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}="${String(v).replace(/"/g, '&quot;')}"`))
    .join(' ');
}

/** Appui long (avec annulation si le doigt bouge). */
export function longPress(root, selector, fn, ms = 480) {
  let t = null;
  let start = null;
  const cancel = () => { clearTimeout(t); t = null; };
  root.addEventListener('pointerdown', (e) => {
    const target = e.target.closest(selector);
    if (!target || !root.contains(target)) return;
    start = { x: e.clientX, y: e.clientY };
    t = setTimeout(() => {
      t = null;
      target.dataset.longpressed = '1';
      fn(e, target);
      setTimeout(() => delete target.dataset.longpressed, 400);
    }, ms);
  });
  root.addEventListener('pointermove', (e) => {
    if (t && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

export const isWide = () => window.matchMedia('(min-width: 760px)').matches;
