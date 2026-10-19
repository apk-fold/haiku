// Sauvegardes chiffrées du coffre (fichiers .haiku dans Documents/Haiku/Sauvegardes).

import { fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, formatDateTime, formatBytes, timeAgo } from '../core/util.js';
import { session } from '../session.js';
import { prefs } from '../prefs.js';
import { menu, prompt, confirm, toast, toastError, switchHtml, emptyState } from '../ui/components.js';
import { shareFile, isNative } from '../platform.js';

export async function render(ctx) {
  const v = ctx.vault;
  ctx.header({ title: 'Sauvegardes', subtitle: 'Copies chiffrées du coffre', actions: `<button class="ic-btn tap accent" data-act="now" aria-label="Sauvegarder">${icon('save')}</button>`, onAction: () => backupNow() });

  let list = [];
  const draw = async () => {
    list = isNative ? await session.listBackups() : [];
    ctx.el.innerHTML = `
      <section class="intro-card glass" data-in>${icon('archive', 22)}<p>Une sauvegarde est une copie du fichier chiffré du coffre. Elle s'ouvre avec le mot de passe maître <b>en vigueur au moment où elle a été faite</b> et se restaure comme un nouveau coffre (rien n'est écrasé). Dossier : <b>Documents/Haiku/Sauvegardes</b>.</p></section>
      <section class="card-sec glass" data-in>
        <label class="row-switch"><span>Sauvegarde automatique<small>Au verrouillage, si le coffre a changé</small></span>${switchHtml('auto', prefs.s.autoBackup)}</label>
        <label class="slider-row"><span>Copies automatiques gardées</span><b data-out>${prefs.s.backupKeep}</b><input type="range" name="keep" min="1" max="50" value="${prefs.s.backupKeep}"></label>
        <button class="btn primary block tap" data-act="now">${icon('save', 18)}<span>Sauvegarder maintenant</span></button>
        <button class="btn ghost block tap" data-act="share">${icon('share-2', 18)}<span>Partager le coffre chiffré…</span></button>
      </section>
      <h3 class="section-h" data-in>Fichiers <small>${list.length}</small></h3>
      ${!isNative ? '<p class="muted">Dans le navigateur, les sauvegardes sont téléchargées.</p>' : list.length ? `<div class="mini-list">${list.map((b, i) => `<button class="mini-row tap" data-b="${i}"><span class="r-ic ${b.vaultShort === v.id.slice(0, 8) ? 'acc' : ''}">${icon(b.kind === 'auto' ? 'clock' : 'archive', 18)}</span><span><b>${esc(b.label)}</b><small>${b.date ? `${formatDateTime(b.date)} · ${timeAgo(b.date)}` : ''} · ${esc(b.kind)}${b.directory === 'DATA' ? ' · interne' : ''}</small></span><em>${formatBytes(b.size)}</em></button>`).join('')}</div>` : emptyState('archive', 'Aucune sauvegarde', 'Touche « Sauvegarder maintenant ».')}`;
    fx.stagger(ctx.el.querySelectorAll('[data-in], .mini-row'), { each: 0.03 });
    const range = ctx.el.querySelector('[name=keep]');
    range.style.setProperty('--p', `${((range.value - 1) / 49) * 100}%`);
    range.oninput = () => { ctx.el.querySelector('[data-out]').textContent = range.value; range.style.setProperty('--p', `${((range.value - 1) / 49) * 100}%`); prefs.set('security', { backupKeep: +range.value }); };
    ctx.el.querySelector('[name=auto]').onchange = (e) => prefs.set('security', { autoBackup: e.target.checked });
  };

  const backupNow = async () => {
    try {
      const r = await session.backup(v, 'manuelle');
      fx.confetti();
      toast(`Sauvegardé : ${r.where}`, { icon: 'archive', ms: 3500 });
      draw();
    } catch (e) { toastError(e); }
  };

  const backupMenu = async (b) => {
    const c = await menu([
      { icon: 'share-2', label: 'Partager', hint: 'Vers Drive, un PC, une clé USB…', value: 'share' },
      { icon: 'archive-restore', label: 'Restaurer comme nouveau coffre', value: 'restore' },
      { icon: 'trash-2', label: 'Supprimer', value: 'delete', danger: true },
    ], { title: b.name });
    try {
      if (c === 'share') await shareFile(b.name, await session.readBackup(b), 'Sauvegarde Haiku');
      if (c === 'restore') {
        const text = await session.readBackup(b);
        let id = null;
        await prompt({ title: 'Restaurer', message: 'Mot de passe maître en vigueur au moment de cette sauvegarde.', fields: [{ name: 'pw', label: 'Mot de passe maître', type: 'password' }], ok: 'Restaurer', validate: async ({ pw }) => { id = await session.restoreVaultFile(text, pw); } });
        if (id) { fx.confetti(); toast('Restauré : verrouille pour ouvrir le nouveau coffre', { icon: 'archive-restore', ms: 4000 }); }
      }
      if (c === 'delete' && (await confirm({ title: 'Supprimer cette sauvegarde ?', ok: 'Supprimer', danger: true }))) { await session.deleteBackup(b); draw(); }
    } catch (e) { toastError(e); }
  };

  await draw();
  on(ctx.el, 'click', '[data-b]', (e, b) => backupMenu(list[+b.dataset.b]));
  on(ctx.el, 'click', '[data-act=now]', () => backupNow());
  on(ctx.el, 'click', '[data-act=share]', async () => {
    const text = await v.serialize();
    await shareFile(`${v.name.replace(/[^\w-]+/g, '-')}.haiku`, text, 'Coffre Haiku chiffré');
  });
}
