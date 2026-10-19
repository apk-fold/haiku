// Coffre : recherche (#étiquettes, filtres), puces de filtre, tri, liste animée (Flip),
// gestes (glisser à droite = copier, à gauche = favori), appui long = menu, sélection multiple.

import { gsap, fx, Flip, Draggable } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on, longPress, $$, isWide } from '../ui/dom.js';
import { esc, debounce, norm } from '../core/util.js';
import { prefs } from '../prefs.js';
import { monogram, copy, menu, toast, emptyState, confirm } from '../ui/components.js';
import { subtitle, TYPES, TYPE_ORDER, mainPassword } from '../core/schema.js';
import { matches, parseQuery } from '../core/tags.js';
import { guard, newItemMenu } from '../app.js';
import { haptic } from '../platform.js';

let state = { q: '', filter: 'all', folder: '' };

const SORTS = {
  name: ['Nom (A → Z)', (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })],
  updated: ['Modifiés récemment', (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')],
  created: ['Créés récemment', (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')],
  used: ['Utilisés récemment', (a, b) => (b.usedAt || '').localeCompare(a.usedAt || '')],
};

export async function render(ctx) {
  const v = ctx.vault;
  const pending = sessionStorage.getItem('haiku.vault.q');
  if (pending != null) { state.q = pending; state.filter = 'all'; sessionStorage.removeItem('haiku.vault.q'); }
  let selecting = false;
  const selected = new Set();

  const header = () => ctx.header({
    onAction: (act, b) => headerAction(act, b),
    title: selecting ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : 'Coffre',
    subtitle: selecting ? 'Sélection multiple' : `${v.active.length} élément${v.active.length > 1 ? 's' : ''}`,
    actions: selecting
      ? `<button class="ic-btn tap" data-act="bulk">${icon('ellipsis-vertical')}</button><button class="ic-btn tap" data-act="endsel">${icon('x')}</button>`
      : `<button class="ic-btn tap" data-act="sort" aria-label="Trier">${icon('arrow-up-down')}</button><button class="ic-btn tap" data-act="select" aria-label="Sélectionner">${icon('list')}</button>`,
  });
  header();

  ctx.el.innerHTML = `<div class="search-bar glass" data-in>${icon('search', 18)}<input type="search" placeholder="Rechercher, #étiquette, type:carte, is:fav…" value="${esc(state.q)}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button class="ic-btn clear" ${state.q ? '' : 'hidden'} aria-label="Effacer">${icon('x', 16)}</button></div>
    <div class="chips scroll filters" data-in></div>
    <div class="list" role="list"></div>`;
  const input = ctx.el.querySelector('input');
  const list = ctx.el.querySelector('.list');
  const chips = ctx.el.querySelector('.filters');

  const renderChips = () => {
    const counts = { all: v.active.length, fav: v.active.filter((i) => i.favorite).length, totp: v.active.filter((i) => i.data?.totp).length };
    for (const t of TYPE_ORDER) counts[t] = v.active.filter((i) => i.type === t).length;
    const opts = [['all', 'Tout', 'layers'], ['fav', 'Favoris', 'star'], ['totp', '2FA', 'timer'], ...TYPE_ORDER.filter((t) => counts[t]).map((t) => [t, TYPES[t].label, TYPES[t].icon])];
    chips.innerHTML = opts.map(([k, l, ic]) => `<button class="chip tap ${state.filter === k ? 'on' : ''}" data-filter="${k}">${icon(ic, 14)}<span>${esc(l)}</span><b>${counts[k] ?? ''}</b></button>`).join('')
      + `<button class="chip tap ${state.folder ? 'on' : ''}" data-act="folder">${icon('folder', 14)}<span>${state.folder === '__none' ? 'Sans dossier' : esc(v.folderName(state.folder) || 'Dossier')}</span>${icon('chevron-down', 12)}</button>`;
  };

  const filtered = () => {
    const q = parseQuery(state.q);
    let items = v.active.filter((it) => matches(it, q, v.folderName(it.folderId)));
    if (state.filter === 'fav') items = items.filter((i) => i.favorite);
    else if (state.filter === 'totp') items = items.filter((i) => i.data?.totp);
    else if (TYPES[state.filter]) items = items.filter((i) => i.type === state.filter);
    if (state.folder === '__none') items = items.filter((i) => !i.folderId);
    else if (state.folder) items = items.filter((i) => i.folderId === state.folder);
    const [, cmp] = SORTS[prefs.get().vault.sort] || SORTS.name;
    items.sort(cmp);
    if (prefs.get().vault.sort === 'name') items.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    return items;
  };

  const row = (it) => {
    const badges = [it.favorite ? icon('star', 13, 'b-fav') : '', it.data?.totp ? icon('timer', 13) : '', it.attachments?.length ? icon('paperclip', 13) : '', it.reprompt ? icon('lock', 13) : ''].join('');
    const quick = mainPassword(it) ? 'key-round' : it.type === 'card' ? 'credit-card' : it.data?.username ? 'user' : '';
    return `<div class="row-wrap" data-flip-id="${it.id}" data-item="${it.id}" role="listitem">
      <div class="swipe-bg"><span class="sw-left">${icon('copy', 18)}<small>Copier</small></span><span class="sw-right">${icon('star', 18)}<small>Favori</small></span></div>
      <a class="row tap ${selected.has(it.id) ? 'sel' : ''}" href="#/item/${it.id}" data-id="${it.id}" draggable="false">
        ${monogram(it, 42)}
        <span class="row-txt"><b>${esc(it.name)}</b><small>${esc(subtitle(it)) || '&nbsp;'}</small></span>
        <span class="row-badges">${badges}</span>
        ${quick && !selecting ? `<button class="ic-btn quick tap" data-quick="${it.id}" aria-label="Copier">${icon('copy', 17)}</button>` : ''}
        ${selecting ? `<span class="check">${icon('check', 14)}</span>` : ''}
      </a></div>`;
  };

  let draggables = [];
  const renderList = (animate = false) => {
    const items = filtered();
    const st = animate && fx.on ? Flip.getState(list.querySelectorAll('.row-wrap')) : null;
    draggables.forEach((d) => d.kill());
    draggables = [];
    if (!items.length) {
      list.innerHTML = v.active.length
        ? emptyState('search', 'Aucun résultat', `Rien ne correspond à « ${esc(state.q || TYPES[state.filter]?.label || state.filter)} ».`)
        : emptyState('lock-open', 'Coffre vide', 'Ajoute ton premier élément ou importe tes mots de passe.', `<div class="row gap center"><button class="btn primary tap" data-act="new">${icon('plus', 18)}<span>Ajouter</span></button><a class="btn ghost tap" href="#/transfer">${icon('arrow-down-up', 18)}<span>Importer</span></a></div>`);
    } else {
      // Regroupement par initiale (tri par nom) façon répertoire
      let html = '';
      let last = '';
      const byName = prefs.get().vault.sort === 'name' && !state.q;
      for (const it of items) {
        if (byName) {
          const L = it.favorite ? '★' : (norm(it.name)[0] || '#').toUpperCase();
          const g = /[A-Z★]/.test(L) ? L : '#';
          if (g !== last) { html += `<div class="group-h" data-flip-id="g-${g}">${g === '★' ? 'Favoris' : g}</div>`; last = g; }
        }
        html += row(it);
      }
      list.innerHTML = html;
      if (!selecting) list.querySelectorAll('.row-wrap').forEach(bindSwipe);
    }
    if (st) fx.flip(st, list.querySelectorAll('.row-wrap, .group-h'));
    else fx.stagger(list.querySelectorAll('.row-wrap, .group-h, .empty'), { each: 0.025, y: 18 });
    if (isWide()) list.querySelectorAll('[data-item]').forEach((n) => n.classList.toggle('selected', location.hash.endsWith(n.dataset.item)));
  };

  // Glisser une ligne : → copier le secret principal, ← basculer favori.
  const bindSwipe = (wrap) => {
    const rowEl = wrap.querySelector('.row');
    const id = rowEl.dataset.id;
    const d = Draggable.create(rowEl, {
      type: 'x',
      lockAxis: true,
      minimumMovement: 8,
      allowContextMenu: true,
      dragClickables: true,
      edgeResistance: 0.6,
      bounds: { minX: -110, maxX: 110 },
      onDrag() {
        wrap.classList.toggle('sw-copy', this.x > 60);
        wrap.classList.toggle('sw-fav', this.x < -60);
        wrap.style.setProperty('--sw', `${Math.min(1, Math.abs(this.x) / 80)}`);
      },
      async onRelease() {
        const x = this.x;
        gsap.to(rowEl, { x: 0, duration: 0.5, ease: 'elastic.out(1,0.6)' });
        wrap.classList.remove('sw-copy', 'sw-fav');
        if (x > 60) await quickCopy(id, rowEl);
        else if (x < -60) {
          const fav = await v.toggleFavorite(id);
          haptic('medium');
          toast(fav ? 'Ajouté aux favoris' : 'Retiré des favoris', { icon: 'star' });
          renderChips();
          renderList(true);
        }
      },
      onClick(e) { /* le lien gère le clic */ void e; },
    })[0];
    draggables.push(d);
  };

  const quickCopy = async (id, from) => {
    const it = v.item(id);
    if (!(await guard(it))) return;
    const pw = mainPassword(it);
    if (pw) { await copy(pw, { label: 'Mot de passe copié', from }); v.touch(id); return; }
    if (it.type === 'card' && it.data.number) return copy(it.data.number.replace(/\s/g, ''), { label: 'Numéro copié', from });
    if (it.data?.username) return copy(it.data.username, { label: 'Identifiant copié', sensitive: false, from });
    toast('Rien à copier', { icon: 'info' });
  };

  const itemMenu = async (id, from) => {
    const it = v.item(id);
    haptic('medium');
    fx.press(from);
    const pw = mainPassword(it);
    const choice = await menu([
      it.data?.username && { icon: 'user', label: "Copier l'identifiant", value: 'user' },
      pw && { icon: 'key-round', label: 'Copier le mot de passe', value: 'pw' },
      { icon: 'square-pen', label: 'Modifier', value: 'edit' },
      { icon: 'star', label: it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', value: 'fav' },
      { icon: 'copy', label: 'Dupliquer', value: 'clone' },
      { icon: 'folder', label: 'Déplacer vers un dossier', value: 'move' },
      { icon: 'list', label: 'Sélection multiple', value: 'select' },
      '-',
      { icon: 'trash-2', label: 'Mettre à la corbeille', value: 'trash', danger: true },
    ], { title: it.name });
    if (!choice) return;
    if (choice === 'user') copy(it.data.username, { label: 'Identifiant copié', sensitive: false });
    if (choice === 'pw' && (await guard(it))) { copy(pw, { label: 'Mot de passe copié' }); v.touch(id); }
    if (choice === 'edit') ctx.go(`#/edit/${id}`);
    if (choice === 'fav') { await v.toggleFavorite(id); renderList(true); }
    if (choice === 'clone') { const c = await v.clone(id); toast('Élément dupliqué'); ctx.go(`#/edit/${c.id}`); }
    if (choice === 'move') { await moveTo([id]); }
    if (choice === 'select') { startSelect(id); }
    if (choice === 'trash') { await v.trashItems(id); toast('Mis à la corbeille', { icon: 'trash-2' }); renderChips(); renderList(true); }
  };

  const moveTo = async (ids) => {
    const f = await menu([{ icon: 'folder-open', label: 'Sans dossier', value: '__none' }, ...v.folders.map((x) => ({ icon: 'folder', label: x.name, value: x.id }))], { title: 'Déplacer vers…' });
    if (!f) return;
    await v.moveToFolder(ids, f === '__none' ? null : f);
    toast(`${ids.length} élément${ids.length > 1 ? 's' : ''} déplacé${ids.length > 1 ? 's' : ''}`, { icon: 'folder' });
    renderList(true);
  };

  const startSelect = (id) => {
    selecting = true;
    selected.clear();
    if (id) selected.add(id);
    document.body.classList.add('selecting');
    header();
    renderList(true);
  };
  const endSelect = () => {
    selecting = false;
    selected.clear();
    document.body.classList.remove('selecting');
    header();
    renderList(true);
  };

  renderChips();
  renderList();

  const onInput = debounce(() => {
    state.q = input.value;
    ctx.el.querySelector('.clear').hidden = !state.q;
    renderList(true);
  }, 150);
  input.addEventListener('input', onInput);
  ctx.el.querySelector('.clear').onclick = () => { input.value = ''; state.q = ''; ctx.el.querySelector('.clear').hidden = true; renderList(true); input.focus(); };

  on(chips, 'click', '[data-filter]', (e, b) => {
    state.filter = b.dataset.filter;
    chips.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('on', c === b));
    fx.pop(b, 1.1);
    haptic('select');
    renderList(true);
  });
  on(chips, 'click', '[data-act=folder]', async () => {
    const f = await menu([{ icon: 'layers', label: 'Tous les dossiers', value: '' }, { icon: 'folder-open', label: 'Sans dossier', value: '__none' }, ...v.folders.map((x) => ({ icon: 'folder', label: x.name, value: x.id }))], { title: 'Filtrer par dossier' });
    if (f === null) return;
    state.folder = f;
    renderChips();
    renderList(true);
  });

  on(ctx.el, 'click', '[data-quick]', (e, b) => { e.preventDefault(); e.stopPropagation(); quickCopy(b.dataset.quick, b); });
  on(ctx.el, 'click', '[data-act=new]', (e, b) => newItemMenu(b));
  on(list, 'click', '.row', (e, a) => {
    if (a.dataset.longpressed) { e.preventDefault(); return; }
    if (selecting) {
      e.preventDefault();
      const id = a.dataset.id;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      a.classList.toggle('sel', selected.has(id));
      fx.pop(a.querySelector('.check'), 1.4);
      haptic('select');
      header();
    }
  });
  longPress(list, '.row', (e, a) => (selecting ? null : itemMenu(a.dataset.id, a)));

  async function headerAction(act) {
    if (act === 'sort') {
      const s = await menu(Object.entries(SORTS).map(([k, [l]]) => ({ icon: prefs.get().vault.sort === k ? 'circle-check' : 'arrow-up-down', label: l, value: k })), { title: 'Trier par' });
      if (s) { prefs.set('vault', { sort: s }); renderList(true); }
    }
    if (act === 'select') startSelect();
    if (act === 'endsel') endSelect();
    if (act === 'bulk') {
      if (!selected.size) return toast('Rien de sélectionné', { icon: 'info' });
      const ids = [...selected];
      const c = await menu([
        { icon: 'circle-check', label: 'Tout sélectionner', value: 'all' },
        { icon: 'folder', label: 'Déplacer vers un dossier', value: 'move' },
        { icon: 'star', label: 'Ajouter aux favoris', value: 'fav' },
        { icon: 'trash-2', label: 'Mettre à la corbeille', value: 'trash', danger: true },
      ], { title: `${ids.length} élément${ids.length > 1 ? 's' : ''}` });
      if (c === 'all') { filtered().forEach((i) => selected.add(i.id)); header(); renderList(); }
      if (c === 'move') { await moveTo(ids); endSelect(); }
      if (c === 'fav') { for (const id of ids) { const it = v.item(id); if (!it.favorite) it.favorite = true; } await v.persist(); endSelect(); }
      if (c === 'trash' && (await confirm({ title: `Mettre ${ids.length} élément${ids.length > 1 ? 's' : ''} à la corbeille ?`, ok: 'Corbeille', danger: true }))) { await v.trashItems(ids); toast('Mis à la corbeille', { icon: 'trash-2' }); renderChips(); endSelect(); }
    }
  }

  const unsub = v.subscribe(() => { renderChips(); renderList(true); });
  if (!isWide() && state.q === '' && fx.on) gsap.from(ctx.el.querySelector('.search-bar'), { scaleX: 0.85, opacity: 0, duration: fx.d(0.6), ease: 'back.out(1.5)' });
  return () => { unsub(); draggables.forEach((d) => d.kill()); document.body.classList.remove('selecting'); };
}

export { $$ };
