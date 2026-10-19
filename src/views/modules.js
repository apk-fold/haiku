// Modules : activer / désactiver chaque fonction, composer la barre d'onglets (5 au plus)
// et l'accueil (widgets activables, réordonnables par glisser).

import { gsap, fx, Draggable } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc } from '../core/util.js';
import { prefs, MODULES, WIDGETS, DEFAULTS } from '../prefs.js';
import { switchHtml, toast, confirm } from '../ui/components.js';
import { haptic } from '../platform.js';

const MAX_TABS = 5;

export async function render(ctx) {
  ctx.header({ title: 'Modules', subtitle: 'Compose ton Haiku' });
  let drags = [];

  const draw = () => {
    const m = prefs.m;
    const tabs = m.tabs.filter((id) => prefs.moduleOn(id));
    const homeOn = m.home.filter((w) => WIDGETS[w]);
    const homeOff = Object.keys(WIDGETS).filter((w) => !homeOn.includes(w));
    ctx.el.innerHTML = `
      <section class="intro-card glass" data-in>${icon('blocks', 22)}<p>Chaque fonction de Haiku est un module. Désactive ce dont tu ne te sers pas, choisis tes onglets et compose l'accueil. Les données ne sont jamais supprimées en désactivant un module.</p></section>
      <h3 class="section-h" data-in>Barre d'onglets <small>${tabs.length}/${MAX_TABS} · glisser pour ranger</small></h3>
      <div class="sort-list tabs-sort" data-list="tabs">${tabs.map((id) => sortRow(id, MODULES[id].icon, MODULES[id].name, true)).join('')}</div>
      <h3 class="section-h" data-in>Fonctions</h3>
      <div class="mod-list">${Object.entries(MODULES).map(([id, mod]) => `<div class="mod-row glass ${prefs.moduleOn(id) ? 'on' : ''}" data-in>
        <span class="mod-ic">${icon(mod.icon, 20)}</span><span class="mod-txt"><b>${esc(mod.name)}</b><small>${esc(mod.desc)}</small></span>
        <button class="ic-btn tap ${tabs.includes(id) ? 'accent' : ''}" data-tab="${id}" ${prefs.moduleOn(id) ? '' : 'disabled'} aria-label="Dans la barre">${icon(tabs.includes(id) ? 'bookmark' : 'plus', 16)}</button>
        ${mod.core ? `<span class="core-badge">${icon('lock', 12)}</span>` : switchHtml(`mod-${id}`, prefs.moduleOn(id))}</div>`).join('')}</div>
      <h3 class="section-h" data-in>Accueil <small>widgets · glisser pour ranger</small></h3>
      <div class="sort-list home-sort" data-list="home">${homeOn.map((w) => sortRow(w, WIDGETS[w].icon, WIDGETS[w].name, true, 'home')).join('')}</div>
      ${homeOff.length ? `<div class="chips wrap" data-in>${homeOff.map((w) => `<button class="chip tap ghost" data-addw="${w}">${icon('plus', 13)}<span>${esc(WIDGETS[w].name)}</span></button>`).join('')}</div>` : ''}
      <button class="btn ghost block tap" data-act="reset" data-in>${icon('rotate-ccw', 16)}<span>Disposition par défaut</span></button>`;
    fx.stagger(ctx.el.querySelectorAll('[data-in], .sort-row'), { each: 0.025 });
    bindSort('tabs');
    bindSort('home');
  };

  const sortRow = (id, ic, name, removable, list = 'tabs') => `<div class="sort-row glass" data-id="${id}"><span class="drag-h">${icon('grip-vertical', 18)}</span><span class="mod-ic">${icon(ic, 18)}</span><b>${esc(name)}</b>${removable ? `<button class="ic-btn tap" data-remove="${list}:${id}" aria-label="Retirer">${icon('x', 16)}</button>` : ''}</div>`;

  const bindSort = (key) => {
    const list = ctx.el.querySelector(`[data-list=${key}]`);
    if (!list) return;
    const rows = () => [...list.querySelectorAll('.sort-row')];
    rows().forEach((row) => {
      drags.push(Draggable.create(row, {
        type: 'y',
        trigger: row.querySelector('.drag-h'),
        zIndexBoost: true,
        bounds: list,
        onPress() { row.classList.add('dragging'); haptic('light'); },
        onDrag() {
          const all = rows();
          const h = row.offsetHeight + 8;
          const idx = all.indexOf(row);
          const target = Math.max(0, Math.min(all.length - 1, idx + Math.round(this.y / h)));
          all.forEach((r, i) => {
            if (r === row) return;
            let shift = 0;
            if (idx < target && i > idx && i <= target) shift = -h;
            if (idx > target && i < idx && i >= target) shift = h;
            gsap.to(r, { y: shift, duration: 0.2 });
          });
          row.dataset.target = target;
        },
        onRelease() {
          row.classList.remove('dragging');
          const all = rows();
          const idx = all.indexOf(row);
          const target = row.dataset.target != null ? +row.dataset.target : idx;
          gsap.set(all, { y: 0 });
          if (target === idx) return;
          const ids = all.map((r) => r.dataset.id);
          ids.splice(target, 0, ids.splice(idx, 1)[0]);
          prefs.set('modules', { [key]: ids });
          haptic('medium');
          redraw();
        },
      })[0]);
    });
  };

  const redraw = () => { drags.forEach((d) => d.kill()); drags = []; draw(); };

  draw();

  ctx.el.addEventListener('change', (e) => {
    const n = e.target.name;
    if (!n?.startsWith('mod-')) return;
    const id = n.slice(4);
    prefs.set('modules', { enabled: { ...prefs.m.enabled, [id]: e.target.checked } });
    if (!e.target.checked) prefs.set('modules', { tabs: prefs.m.tabs.filter((t) => t !== id) });
    haptic('select');
    fx.pop(e.target.closest('.mod-row'), 1.03);
    redraw();
  });
  on(ctx.el, 'click', '[data-tab]', (e, b) => {
    const id = b.dataset.tab;
    const tabs = prefs.m.tabs.filter((t) => prefs.moduleOn(t));
    if (tabs.includes(id)) {
      if (tabs.length <= 2) return toast('Il faut au moins 2 onglets', { icon: 'info' });
      prefs.set('modules', { tabs: tabs.filter((t) => t !== id) });
    } else {
      if (tabs.length >= MAX_TABS) return toast(`${MAX_TABS} onglets au plus : retires-en un d'abord`, { icon: 'info' });
      prefs.set('modules', { tabs: [...tabs, id] });
    }
    haptic('select');
    redraw();
  });
  on(ctx.el, 'click', '[data-remove]', (e, b) => {
    const [list, id] = b.dataset.remove.split(':');
    if (list === 'tabs') {
      const tabs = prefs.m.tabs.filter((t) => prefs.moduleOn(t));
      if (tabs.length <= 2) return toast('Il faut au moins 2 onglets', { icon: 'info' });
      prefs.set('modules', { tabs: tabs.filter((t) => t !== id) });
    } else prefs.set('modules', { home: prefs.m.home.filter((w) => w !== id) });
    const row = b.closest('.sort-row');
    gsap.to(row, { x: 60, opacity: 0, duration: fx.d(0.25) || 0.01, onComplete: redraw });
  });
  on(ctx.el, 'click', '[data-addw]', (e, b) => { prefs.set('modules', { home: [...prefs.m.home, b.dataset.addw] }); haptic('select'); redraw(); });
  on(ctx.el, 'click', '[data-act=reset]', async () => {
    if (!(await confirm({ title: 'Disposition par défaut ?', message: 'Modules, onglets et widgets reviennent à l\'origine.', ok: 'Réinitialiser' }))) return;
    prefs.set('modules', JSON.parse(JSON.stringify(DEFAULTS.modules)));
    redraw();
  });
  return () => drags.forEach((d) => d.kill());
}
