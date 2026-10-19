// Coquille de l'appli : routeur, en-tête, barre d'onglets / rail, bouton +, palette de commandes.

import { gsap, fx, Observer } from './ui/fx.js';
import { $, $$, on, el, isWide } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { prefs, MODULES } from './prefs.js';
import { session } from './session.js';
import { menu, prompt, toast, closeTopSheet, sheetsOpen, sheet, monogram } from './ui/components.js';
import { TYPES, TYPE_ORDER, subtitle } from './core/schema.js';
import { matches } from './core/tags.js';
import { esc, norm } from './core/util.js';
import { haptic, exitApp, autofill } from './platform.js';

const views = {
  home: () => import('./views/home.js'),
  vault: () => import('./views/vault.js'),
  item: () => import('./views/item.js'),
  edit: () => import('./views/edit.js'),
  totp: () => import('./views/totp.js'),
  gen: () => import('./views/gen.js'),
  health: () => import('./views/health.js'),
  send: () => import('./views/send.js'),
  folders: () => import('./views/folders.js'),
  activity: () => import('./views/activity.js'),
  trash: () => import('./views/trash.js'),
  transfer: () => import('./views/transfer.js'),
  backups: () => import('./views/backups.js'),
  settings: () => import('./views/settings.js'),
  studio: () => import('./views/studio.js'),
  modules: () => import('./views/modules.js'),
  autofill: () => import('./views/autofill.js'),
};

// route → [vue, onglet parent, peut aller dans le volet de droite (écran large / Fold déplié)]
const ROUTES = [
  [/^#\/home$/, 'home', 'home'],
  [/^#\/vault$/, 'vault', 'vault'],
  [/^#\/item\/([\w-]+)$/, 'item', 'vault', true],
  [/^#\/edit\/([\w-]+)$/, 'edit', 'vault', true],
  [/^#\/new\/(\w+)$/, 'edit', 'vault', true],
  [/^#\/totp$/, 'totp', 'totp'],
  [/^#\/gen$/, 'gen', 'gen'],
  [/^#\/health$/, 'health', 'health'],
  [/^#\/send$/, 'send', 'send'],
  [/^#\/folders$/, 'folders', 'folders'],
  [/^#\/activity$/, 'activity', 'activity'],
  [/^#\/trash$/, 'trash', 'trash'],
  [/^#\/transfer$/, 'transfer', 'transfer'],
  [/^#\/backups$/, 'backups', 'backups'],
  [/^#\/settings$/, 'settings', 'settings'],
  [/^#\/studio$/, 'studio', 'studio'],
  [/^#\/modules$/, 'modules', 'modules'],
  [/^#\/autofill$/, 'autofill', ''],
];

let current = { view: null, cleanup: null, hash: '', tab: '' };
let asideCurrent = { cleanup: null, hash: '' };
const navStack = [];
let lastBack = 0;

export const app = {
  get vault() { return session.vault; },
  go(hash, { replace = false } = {}) {
    if (location.hash === hash) return route();
    if (replace) location.replace(hash);
    else location.hash = hash;
  },
  back() {
    if (navStack.length > 1) history.back();
    else app.go('#/home', { replace: true });
  },
  refresh() { route(true); },
  refreshAside() { if (asideCurrent.hash) renderAside(asideCurrent.hash, true); },
  closeAside,
};

// ---- re-saisie du mot de passe maître (Bitwarden « master password re-prompt ») ----------

const repromptOk = new Map();
export async function guard(item) {
  if (!item?.reprompt) return true;
  const t = repromptOk.get(item.id);
  if (t && Date.now() - t < 5 * 60 * 1000) return true;
  const r = await prompt({
    title: 'Élément protégé',
    message: 'Saisis ton mot de passe maître pour accéder à cet élément.',
    fields: [{ name: 'pw', label: 'Mot de passe maître', type: 'password', autocomplete: 'current-password' }],
    ok: 'Déverrouiller',
    validate: async ({ pw }) => { if (!(await session.vault.verifyPassword(pw))) throw new Error('Mot de passe incorrect.'); },
  });
  if (!r) return false;
  repromptOk.set(item.id, Date.now());
  return true;
}

// ---- construction de la coquille --------------------------------------------------------

let built = false;
export function buildShell() {
  const shell = $('#shell');
  shell.hidden = false;
  renderNav();
  if (built) { route(true); return; }
  built = true;
  on(shell, 'click', '.tap', (e, b) => { fx.ripple(e, b); });
  on(shell, 'pointerdown', '.tap', (e, b) => { if (fx.on) gsap.to(b, { scale: 0.96, duration: 0.12, overwrite: 'auto' }); });
  on(shell, 'pointerup', '.tap', (e, b) => { if (fx.on) gsap.to(b, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.4)', overwrite: 'auto' }); });
  on(shell, 'pointerleave', '.tap', (e, b) => { if (fx.on) gsap.to(b, { scale: 1, duration: 0.3, overwrite: 'auto' }); }, true);
  $('#back').addEventListener('click', () => { haptic('light'); app.back(); });
  on($('#top'), 'click', '.top-actions [data-act]', (e, b) => { haptic('light'); headerHandlers.main?.(b.dataset.act, b, e); });
  $('#fab').addEventListener('click', (e) => newItemMenu(e.currentTarget));
  window.addEventListener('hashchange', () => route());
  window.addEventListener('resize', () => { placeIndicators(false); applySplit(); });
  // Glisser vers le bas sur l'en-tête : palette de commandes.
  Observer.create({ target: $('#top'), type: 'touch,pointer', onDown: () => openPalette(), tolerance: 40, dragMinimum: 30 });
  prefs.on((sec) => { if (sec === 'modules' || sec === 'appearance' || sec === '*') renderNav(); });
  route();
}

function navItems() {
  const ids = prefs.m.tabs.filter((id) => prefs.moduleOn(id));
  return ids.length ? ids : ['home', 'vault', 'settings'];
}

function renderNav() {
  const tabs = $('#tabs');
  const rail = $('#rail-nav');
  if (!tabs) return;
  const ids = navItems();
  tabs.innerHTML = `<i class="ind"></i>${ids.map((id) => `<a href="${MODULES[id].route}" class="tab tap" data-tab="${id}">${icon(MODULES[id].icon, 22)}<span>${esc(MODULES[id].short || MODULES[id].name)}</span></a>`).join('')}`;
  const all = Object.keys(MODULES).filter((id) => prefs.moduleOn(id));
  rail.innerHTML = `<i class="ind"></i>${all.map((id) => `<a href="${MODULES[id].route}" class="rail-item tap" data-tab="${id}">${icon(MODULES[id].icon, 20)}<span>${esc(MODULES[id].name)}</span></a>`).join('')}`;
  markTab(current.tab, false);
}

function markTab(tab, animate = true) {
  $$('#tabs .tab, #rail-nav .rail-item').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  placeIndicators(animate);
}

function placeIndicators(animate = true) {
  const t = $('#tabs .tab.on');
  const ind = $('#tabs .ind');
  if (ind) {
    ind.style.opacity = t ? '1' : '0';
    if (t) { if (!animate) delete ind.dataset.ready; fx.slideIndicator(ind, t); }
  }
  const r = $('#rail-nav .rail-item.on');
  const rind = $('#rail-nav .ind');
  if (rind) {
    rind.style.opacity = r ? '1' : '0';
    if (r) { if (!animate) delete rind.dataset.ready; fx.slideIndicator(rind, r, true); }
  }
  if (t && animate && fx.on) {
    const svg = t.querySelector('svg');
    gsap.fromTo(svg, { y: -6, scale: 1.25, rotation: fx.wild ? -12 : 0 }, { y: 0, scale: 1, rotation: 0, duration: fx.d(0.7), ease: 'elastic.out(1,0.4)' });
  }
}

// ---- en-tête --------------------------------------------------------------------------

const headerHandlers = { main: null, aside: null };

function setHeader({ title = '', subtitle: sub = '', actions = '', back = false, big = false, onAction = null } = {}, target = 'main') {
  headerHandlers[target] = onAction;
  if (target === 'aside') {
    const h = $('#aside .aside-head');
    if (h) h.innerHTML = `<button class="ic-btn tap" data-aside-close aria-label="Fermer">${icon('x')}</button><div class="top-title"><small>${esc(sub)}</small><h1>${esc(title)}</h1></div><div class="top-actions">${actions}</div>`;
    return;
  }
  const top = $('#top');
  top.classList.toggle('big', big);
  $('#back').hidden = !back;
  $('#back').innerHTML = icon('arrow-left');
  const tt = top.querySelector('.top-title');
  tt.innerHTML = `<small>${esc(sub)}</small><h1>${esc(title)}</h1>`;
  top.querySelector('.top-actions').innerHTML = actions;
  if (fx.on) gsap.from(tt.children, { y: 12, opacity: 0, duration: fx.d(0.5), stagger: 0.05, ease: 'haiku' });
}

// ---- routeur ------------------------------------------------------------------------------

function match(hash) {
  for (const [re, view, tab, aside] of ROUTES) {
    const m = re.exec(hash);
    if (m) return { view, tab, aside: !!aside, params: m.slice(1) };
  }
  return null;
}

async function route(force = false) {
  if (!session.vault) return;
  const hash = location.hash || '#/home';
  const r = match(hash);
  if (!r) return app.go('#/home', { replace: true });
  const mod = Object.keys(MODULES).find((k) => k === r.tab);
  if (mod && !prefs.moduleOn(mod)) return app.go('#/home', { replace: true });

  // Pile de navigation (pour le sens de l'animation et le bouton retour).
  const idx = navStack.lastIndexOf(hash);
  let dir = 1;
  if (idx >= 0 && idx === navStack.length - 2) { navStack.pop(); dir = -1; } else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
  if (navStack.length > 40) navStack.shift();

  if (r.aside && isWide()) {
    // Écran large : l'élément s'ouvre à droite, la liste reste à gauche.
    if (!current.view || (current.view !== 'vault' && current.view !== 'home' && current.view !== 'folders' && current.view !== 'totp' && current.view !== 'health' && current.view !== 'trash' && current.view !== 'activity')) {
      await renderMain('#/vault', match('#/vault'), 1);
    }
    return renderAside(hash, force);
  }
  closeAside(false);
  if (!force && hash === current.hash) return;
  await renderMain(hash, r, dir);
}

async function renderMain(hash, r, dir) {
  const page = $('#page');
  const style = prefs.a.transition;
  const old = page.firstElementChild;
  if (old && current.hash && current.hash !== hash) await fx.pageOut(old, style, dir);
  try { current.cleanup?.(); } catch { /* vue déjà détruite */ }
  current = { view: r.view, hash, tab: r.tab, cleanup: null };
  markTab(r.tab);
  const container = el(`<div class="view view-${r.view}"></div>`);
  page.replaceChildren(container);
  page.scrollTop = 0;
  const showFab = ['home', 'vault', 'folders'].includes(r.view);
  const fab = $('#fab');
  const wasShown = fab.classList.contains('show');
  fab.classList.toggle('show', showFab);
  if (showFab !== wasShown) {
    gsap.killTweensOf(fab);
    if (showFab) gsap.fromTo(fab, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: fx.d(0.6) || 0.01, ease: 'back.out(2)', delay: fx.d(0.15) });
    else gsap.to(fab, { scale: 0, rotation: 90, duration: fx.d(0.25) || 0.01, ease: 'power2.in' });
  }
  try {
    const mod = await views[r.view]();
    const ctx = makeCtx(container, r, 'main');
    current.cleanup = (await mod.render(ctx)) || null;
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty"><h3>Oups</h3><p>${esc(e.message)}</p></div>`;
  }
  fx.pageIn(container, style, dir);
}

async function renderAside(hash, force) {
  const aside = $('#aside');
  if (!force && asideCurrent.hash === hash && aside.classList.contains('open')) return;
  try { asideCurrent.cleanup?.(); } catch { /* */ }
  const r = match(hash);
  asideCurrent = { hash, cleanup: null };
  document.body.classList.add('split');
  aside.classList.add('open');
  aside.innerHTML = '<header class="aside-head"></header><div class="aside-body"></div>';
  on(aside, 'click', '[data-aside-close]', () => { closeAside(); history.replaceState(null, '', current.hash); });
  on(aside, 'click', '.aside-head .top-actions [data-act]', (e, b) => { haptic('light'); headerHandlers.aside?.(b.dataset.act, b, e); });
  const body = aside.querySelector('.aside-body');
  const container = el(`<div class="view view-${r.view}"></div>`);
  body.appendChild(container);
  $$('#page [data-item]').forEach((n) => n.classList.toggle('selected', hash.endsWith(n.dataset.item)));
  const mod = await views[r.view]();
  asideCurrent.cleanup = (await mod.render(makeCtx(container, r, 'aside'))) || null;
  fx.pageIn(container, 'zoom', 1);
}

function closeAside(animate = true) {
  const aside = $('#aside');
  if (!aside?.classList.contains('open')) return;
  try { asideCurrent.cleanup?.(); } catch { /* */ }
  asideCurrent = { cleanup: null, hash: '' };
  $$('#page [data-item].selected').forEach((n) => n.classList.remove('selected'));
  const finish = () => { aside.classList.remove('open'); aside.innerHTML = ''; document.body.classList.remove('split'); };
  if (animate && fx.on) gsap.to(aside, { opacity: 0, x: 30, duration: fx.d(0.2), onComplete: () => { gsap.set(aside, { clearProps: 'all' }); finish(); } });
  else finish();
}

function applySplit() {
  if (!isWide() && asideCurrent.hash) {
    const h = asideCurrent.hash;
    closeAside(false);
    current.hash = '';
    renderMain(h, match(h), 1);
  }
}

function makeCtx(container, r, target) {
  return {
    el: container,
    params: r.params,
    view: r.view,
    target,
    vault: session.vault,
    header: (h) => setHeader(h, target),
    go: app.go,
    back: () => (target === 'aside' ? (closeAside(), history.replaceState(null, '', current.hash)) : app.back()),
    refresh: () => (target === 'aside' ? app.refreshAside() : app.refresh()),
    inAside: target === 'aside',
  };
}

// ---- bouton + -------------------------------------------------------------------------

export async function newItemMenu(from) {
  if (from && fx.on) gsap.to(from, { rotation: 135, duration: fx.d(0.4), ease: 'back.out(2)' });
  haptic('light');
  const t = await menu(TYPE_ORDER.map((k) => ({ icon: TYPES[k].icon, label: TYPES[k].label, value: k })), { title: 'Nouvel élément' });
  if (from && fx.on) gsap.to(from, { rotation: 0, duration: fx.d(0.4), ease: 'back.out(2)' });
  if (t) app.go(`#/new/${t}`);
}

// ---- bouton retour Android -------------------------------------------------------------

export function handleBack() {
  if ($('#palette.open')) return closePalette();
  if (closeTopSheet()) return;
  if (window.__haikuAutofill && (current.view === 'autofill' || !session.vault)) return autofill.cancel();
  if (asideCurrent.hash) { closeAside(); history.replaceState(null, '', current.hash); return; }
  if (navStack.length > 1 && current.view !== 'home') return app.back();
  if (current.view !== 'home') return app.go('#/home');
  if (Date.now() - lastBack < 1800) return exitApp();
  lastBack = Date.now();
  toast('Appuie encore une fois pour quitter', { icon: 'log-out' });
}

// ---- palette de commandes (Ctrl+K de Keyra, version tactile) -----------------------------

function commands() {
  const out = [];
  for (const [id, m] of Object.entries(MODULES)) if (prefs.moduleOn(id)) out.push({ icon: m.icon, label: m.name, hint: m.desc, run: () => app.go(m.route) });
  for (const k of TYPE_ORDER) out.push({ icon: 'plus', label: `Nouveau : ${TYPES[k].label}`, run: () => app.go(`#/new/${k}`) });
  out.push({ icon: 'lock', label: 'Verrouiller maintenant', run: () => session.lock('manual') });
  out.push({ icon: 'archive', label: 'Sauvegarder maintenant', run: async () => { const r = await session.backup(undefined, 'manuelle'); toast(`Sauvegarde : ${r.where}`, { icon: 'archive' }); } });
  return out;
}

let paletteSel = 0;
export function openPalette() {
  if (!session.vault || $('#palette.open') || sheetsOpen()) return;
  const p = $('#palette');
  p.innerHTML = `<div class="pal-box"><div class="pal-input">${icon('command', 18)}<input placeholder="Rechercher un élément ou une commande…" autocomplete="off" spellcheck="false"><kbd>Échap</kbd></div><div class="pal-list"></div></div>`;
  p.classList.add('open');
  const input = p.querySelector('input');
  const list = p.querySelector('.pal-list');
  let results = [];
  const render = () => {
    const q = input.value.trim();
    const cmds = commands().filter((c) => !q || norm(c.label).includes(norm(q)));
    const items = q ? session.vault.active.filter((it) => matches(it, q, session.vault.folderName(it.folderId))).slice(0, 12) : session.vault.active.slice().sort((a, b) => (b.usedAt || b.updatedAt || '').localeCompare(a.usedAt || a.updatedAt || '')).slice(0, 5);
    results = [...items.map((it) => ({ item: it, run: () => app.go(`#/item/${it.id}`) })), ...cmds.slice(0, q ? 8 : 12)];
    paletteSel = Math.min(paletteSel, results.length - 1);
    list.innerHTML = results.map((r, i) => r.item
      ? `<button class="pal-row ${i === paletteSel ? 'sel' : ''}" data-i="${i}">${monogram(r.item, 30)}<span><b>${esc(r.item.name)}</b><small>${esc(subtitle(r.item))}</small></span></button>`
      : `<button class="pal-row ${i === paletteSel ? 'sel' : ''}" data-i="${i}"><span class="pal-ic">${icon(r.icon, 18)}</span><span><b>${esc(r.label)}</b>${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span></button>`).join('') || '<p class="muted center">Aucun résultat</p>';
  };
  input.addEventListener('input', () => { paletteSel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { paletteSel = Math.min(results.length - 1, paletteSel + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { paletteSel = Math.max(0, paletteSel - 1); render(); e.preventDefault(); }
    if (e.key === 'Enter' && results[paletteSel]) { const r = results[paletteSel]; closePalette(); r.run(); }
    if (e.key === 'Escape') closePalette();
  });
  p.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { const r = results[+b.dataset.i]; closePalette(); r.run(); return; }
    if (e.target === p) closePalette();
  };
  render();
  gsap.fromTo(p, { opacity: 0 }, { opacity: 1, duration: fx.d(0.2) || 0.01 });
  gsap.fromTo(p.querySelector('.pal-box'), { y: -40, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: fx.d(0.45) || 0.01, ease: 'back.out(1.6)' });
  fx.stagger(list.children, { y: 10, each: 0.02 });
  setTimeout(() => input.focus(), 50);
}

export function closePalette() {
  const p = $('#palette');
  if (!p.classList.contains('open')) return;
  gsap.to(p, { opacity: 0, duration: fx.d(0.18) || 0.01, onComplete: () => { p.classList.remove('open'); p.innerHTML = ''; } });
}

export function resetShell() {
  try { current.cleanup?.(); } catch { /* */ }
  current = { view: null, cleanup: null, hash: '', tab: '' };
  closeAside(false);
  navStack.length = 0;
  $('#page').replaceChildren();
  $('#shell').hidden = true;
}

export { setHeader, sheet };
