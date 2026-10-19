// Corbeille : restaurer, supprimer définitivement, vider ; purge automatique réglable.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, timeAgo } from '../core/util.js';
import { monogram, confirm, toast, emptyState, menu } from '../ui/components.js';
import { subtitle } from '../core/schema.js';
import { prefs } from '../prefs.js';

export async function render(ctx) {
  const v = ctx.vault;
  const draw = () => {
    const list = v.trash.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    const days = prefs.s.trashDays;
    ctx.header({ title: 'Corbeille', subtitle: `${list.length} élément${list.length > 1 ? 's' : ''}`, actions: list.length ? `<button class="ic-btn tap danger-txt" data-act="empty" aria-label="Vider">${icon('trash-2')}</button>` : '', onAction: () => emptyAll() });
    ctx.el.innerHTML = `<section class="intro-card glass" data-in>${icon('info', 20)}<p>${days ? `Les éléments sont supprimés définitivement <b>${days} jours</b> après leur mise à la corbeille.` : 'Purge automatique désactivée.'} <a href="#/settings">Changer</a></p></section>
      ${list.length ? `<div class="list">${list.map((it) => {
        const left = days ? Math.max(0, days - Math.floor((Date.now() - new Date(it.deletedAt).getTime()) / 86400000)) : null;
        return `<div class="row-wrap" data-in><div class="row trash-row" data-id="${it.id}">${monogram(it, 40)}<span class="row-txt"><b>${esc(it.name)}</b><small>${esc(subtitle(it))} · supprimé ${timeAgo(it.deletedAt)}${left != null ? ` · ${left} j restant${left > 1 ? 's' : ''}` : ''}</small></span>
          <button class="ic-btn tap" data-restore="${it.id}" aria-label="Restaurer">${icon('rotate-ccw', 18)}</button><button class="ic-btn tap danger-txt" data-kill="${it.id}" aria-label="Supprimer">${icon('x', 18)}</button></div></div>`;
      }).join('')}</div>` : emptyState('trash-2', 'Corbeille vide', 'Rien à jeter. Comme un jardin zen ratissé.')}`;
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.03 });
  };

  const emptyAll = async () => {
    if (!(await confirm({ title: 'Vider la corbeille ?', message: 'Les éléments et leur historique seront supprimés définitivement.', ok: 'Vider', danger: true }))) return;
    const rows = ctx.el.querySelectorAll('.row-wrap');
    if (fx.on) await gsap.to(rows, { x: 80, opacity: 0, stagger: 0.03, duration: fx.d(0.3) }).then();
    await v.emptyTrash();
    toast('Corbeille vidée', { icon: 'trash-2' });
    draw();
  };

  draw();
  on(ctx.el, 'click', '[data-restore]', async (e, b) => {
    const row = b.closest('.row-wrap');
    const r = b.getBoundingClientRect();
    fx.burst(r.left, r.top, { count: 10 });
    if (fx.on) await gsap.to(row, { x: -60, opacity: 0, duration: fx.d(0.3) }).then();
    await v.restoreItems(b.dataset.restore);
    toast('Restauré', { icon: 'rotate-ccw' });
    draw();
  });
  on(ctx.el, 'click', '[data-kill]', async (e, b) => {
    if (!(await confirm({ title: 'Supprimer définitivement ?', message: 'Cet élément et son historique seront effacés.', ok: 'Supprimer', danger: true }))) return;
    const row = b.closest('.row-wrap');
    if (fx.on) await gsap.to(row, { scale: 0.8, opacity: 0, duration: fx.d(0.3) }).then();
    await v.deleteForever(b.dataset.kill);
    draw();
  });
  on(ctx.el, 'click', '.trash-row', async (e, row) => {
    if (e.target.closest('button')) return;
    const c = await menu([{ icon: 'rotate-ccw', label: 'Restaurer', value: 'r' }, { icon: 'x', label: 'Supprimer définitivement', value: 'd', danger: true }], { title: v.item(row.dataset.id).name });
    if (c === 'r') row.querySelector('[data-restore]').click();
    if (c === 'd') row.querySelector('[data-kill]').click();
  });
}
