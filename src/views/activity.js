// Historique : toutes les modifications du coffre, regroupées par jour (comme la page Historique de Keyra).

import { fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { esc } from '../core/util.js';
import { monogram, emptyState } from '../ui/components.js';

export async function render(ctx) {
  const v = ctx.vault;
  ctx.header({ title: 'Historique', subtitle: 'Créations, modifications, suppressions' });
  const events = [];
  for (const it of v.items) {
    if (it.createdAt) events.push({ date: it.createdAt, kind: 'created', it });
    for (const h of it.history || []) events.push({ date: h.date, kind: 'version', it, name: h.snapshot?.name });
    if (it.updatedAt && it.updatedAt !== it.createdAt) events.push({ date: it.updatedAt, kind: 'edited', it });
    if (it.deletedAt) events.push({ date: it.deletedAt, kind: 'trashed', it });
    for (const p of it.passwordHistory || []) events.push({ date: p.date, kind: 'password', it });
  }
  // Une version enregistrée = l'état AVANT la modification suivante : on garde « modifié ».
  const list = events.filter((e) => e.kind !== 'version').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 400);
  if (!list.length) {
    ctx.el.innerHTML = emptyState('history', 'Rien pour l\'instant', 'Chaque création ou modification apparaîtra ici.');
    return;
  }
  const days = new Map();
  for (const e of list) {
    const k = new Date(e.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  const label = { created: ['Créé', 'plus', 'ok'], edited: ['Modifié', 'square-pen', ''], trashed: ['Mis à la corbeille', 'trash-2', 'bad'], password: ['Mot de passe changé', 'key-round', 'acc'] };
  ctx.el.innerHTML = `<div class="timeline">${[...days].map(([d, evs]) => `<h3 class="tl-day" data-in>${esc(d)}</h3>${evs.map((e) => `<a class="tl-row tap" href="${e.it.deletedAt ? '#/trash' : `#/item/${e.it.id}`}" data-in><span class="tl-dot ${label[e.kind][2]}">${icon(label[e.kind][1], 13)}</span>${monogram(e.it, 34)}<span class="tl-txt"><b>${esc(e.it.name)}</b><small>${label[e.kind][0]} · ${new Date(e.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></span>${e.it.history?.length ? `<em>${e.it.history.length} v.</em>` : ''}</a>`).join('')}`).join('')}</div>`;
  fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.02, y: 14 });
}
