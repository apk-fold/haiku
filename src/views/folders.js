// Dossiers (renommer, colorer, réordonner par glisser) et étiquettes (renommer, supprimer).

import { gsap, fx, Draggable } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on, longPress } from '../ui/dom.js';
import { esc } from '../core/util.js';
import { menu, prompt, confirm, toast, toastError, emptyState } from '../ui/components.js';
import { haptic } from '../platform.js';

const COLORS = ['', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8'];

export async function render(ctx) {
  const v = ctx.vault;
  ctx.header({ title: 'Dossiers & étiquettes', subtitle: `${v.folders.length} dossier${v.folders.length > 1 ? 's' : ''}`, actions: `<button class="ic-btn tap accent" data-act="add" aria-label="Nouveau dossier">${icon('folder-plus')}</button>`, onAction: () => addFolder() });
  let drags = [];

  const draw = () => {
    const counts = new Map();
    for (const it of v.active) counts.set(it.folderId || '', (counts.get(it.folderId || '') || 0) + 1);
    const tags = v.allTags();
    ctx.el.innerHTML = `
      <h3 class="section-h" data-in>Dossiers <small>appui long pour les options · glisser ⋮⋮ pour ranger</small></h3>
      <div class="folder-list">${v.folders.map((f) => `<div class="folder-row glass" data-id="${f.id}" style="${f.color ? `--fc:${f.color}` : ''}" data-in>
        <span class="drag-h">${icon('grip-vertical', 18)}</span>
        <button class="folder-main tap" data-open="${esc(f.name)}"><span class="f-ic">${icon('folder', 20)}</span><b>${esc(f.name)}</b><em>${counts.get(f.id) || 0}</em></button>
        <button class="ic-btn tap" data-opts="${f.id}">${icon('ellipsis-vertical', 18)}</button></div>`).join('')}
        <div class="folder-row ghosted" data-in><span class="drag-h"></span><button class="folder-main tap" data-none><span class="f-ic">${icon('folder-open', 20)}</span><b>Sans dossier</b><em>${counts.get('') || 0}</em></button></div>
      </div>
      <h3 class="section-h" data-in>Étiquettes <small>${tags.length}</small></h3>
      ${tags.length ? `<div class="tag-cloud big" data-in>${tags.map((t) => `<button class="tag tap" data-tag="${esc(t.tag)}">#${esc(t.tag)}<b>${t.count}</b></button>`).join('')}</div>` : emptyState('tags', 'Aucune étiquette', 'Ajoute des étiquettes à tes éléments pour les retrouver avec #mot dans la recherche.')}`;
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.035 });
    bindSort();
  };

  // Réordonner les dossiers en glissant la poignée.
  const bindSort = () => {
    drags.forEach((d) => d.kill());
    drags = [];
    const list = ctx.el.querySelector('.folder-list');
    const rows = () => [...list.querySelectorAll('.folder-row[data-id]')];
    rows().forEach((row) => {
      const d = Draggable.create(row, {
        type: 'y',
        trigger: row.querySelector('.drag-h'),
        zIndexBoost: true,
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
            gsap.to(r, { y: shift, duration: 0.25, ease: 'power2.out' });
          });
          row.dataset.target = target;
        },
        async onRelease() {
          row.classList.remove('dragging');
          const all = rows();
          const idx = all.indexOf(row);
          const target = row.dataset.target != null ? +row.dataset.target : idx;
          gsap.set(all, { y: 0 });
          if (target !== idx) {
            const ids = all.map((r) => r.dataset.id);
            ids.splice(target, 0, ids.splice(idx, 1)[0]);
            await v.reorderFolders(ids);
            haptic('medium');
            draw();
          }
        },
      })[0];
      drags.push(d);
    });
  };

  const addFolder = async () => {
    const r = await prompt({ title: 'Nouveau dossier', fields: [{ name: 'n', label: 'Nom', maxlength: 60 }], ok: 'Créer' });
    if (!r?.n?.trim()) return;
    await v.addFolder(r.n);
    draw();
    fx.pop(ctx.el.querySelector('.folder-list .folder-row:nth-last-child(2)'), 1.06);
  };

  const folderOpts = async (id) => {
    const f = v.folder(id);
    const c = await menu([
      { icon: 'pencil', label: 'Renommer', value: 'rename' },
      { icon: 'palette', label: 'Couleur', value: 'color' },
      '-',
      { icon: 'trash-2', label: 'Supprimer le dossier', hint: 'Ses éléments deviennent « sans dossier »', value: 'delete', danger: true },
    ], { title: f.name });
    if (c === 'rename') {
      const r = await prompt({ title: 'Renommer', fields: [{ name: 'n', label: 'Nom', value: f.name }], ok: 'Renommer', validate: ({ n }) => v.updateFolder(id, { name: n }) });
      if (r) draw();
    }
    if (c === 'color') {
      const col = await menu(COLORS.map((x) => ({ icon: x ? 'droplet' : 'circle-dashed', label: x || 'Aucune', value: x || 'none' })), { title: 'Couleur du dossier' });
      if (col) { await v.updateFolder(id, { color: col === 'none' ? '' : col }); draw(); }
    }
    if (c === 'delete' && (await confirm({ title: `Supprimer « ${esc(f.name)} » ?`, message: 'Aucun élément n\'est supprimé.', ok: 'Supprimer', danger: true }))) {
      await v.deleteFolder(id);
      toast('Dossier supprimé', { icon: 'trash-2' });
      draw();
    }
  };

  draw();
  on(ctx.el, 'click', '[data-open]', (e, b) => { sessionStorage.setItem('haiku.vault.q', `in:${b.dataset.open}`); ctx.go('#/vault'); });
  on(ctx.el, 'click', '[data-opts]', (e, b) => folderOpts(b.dataset.opts));
  on(ctx.el, 'click', '[data-tag]', (e, b) => { if (b.dataset.longpressed) return; sessionStorage.setItem('haiku.vault.q', `#${b.dataset.tag.includes(' ') ? `"${b.dataset.tag}"` : b.dataset.tag}`); ctx.go('#/vault'); });
  longPress(ctx.el, '.folder-main[data-open]', (e, b) => folderOpts(b.closest('.folder-row').dataset.id));
  longPress(ctx.el, '[data-tag]', async (e, b) => {
    const tag = b.dataset.tag;
    haptic('medium');
    const c = await menu([{ icon: 'pencil', label: 'Renommer partout', value: 'rename' }, { icon: 'trash-2', label: 'Retirer de tous les éléments', value: 'delete', danger: true }], { title: `#${tag}` });
    try {
      if (c === 'rename') {
        const r = await prompt({ title: 'Renommer l\'étiquette', fields: [{ name: 'n', label: 'Nouveau nom', value: tag }], ok: 'Renommer' });
        if (r?.n) { await v.renameTag(tag, r.n); draw(); }
      }
      if (c === 'delete' && (await confirm({ title: `Retirer #${esc(tag)} ?`, ok: 'Retirer', danger: true }))) { await v.deleteTag(tag); draw(); }
    } catch (err) { toastError(err); }
  });
  return () => drags.forEach((d) => d.kill());
}
