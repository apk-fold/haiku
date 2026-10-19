// Import / export des mots de passe.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc } from '../core/util.js';
import { parseImport, applyImport, NeedsPassword, FORMATS } from '../core/importers.js';
import { buildExport, EXPORTS, exportFileName } from '../core/exporters.js';
import { sheet, prompt, toast, toastError, pickFile, switchHtml, menu, confirm, monogram } from '../ui/components.js';
import { shareFile, docs, haptic } from '../platform.js';
import { TYPES } from '../core/schema.js';

export async function render(ctx) {
  const v = ctx.vault;
  ctx.header({ title: 'Import / Export', subtitle: 'Tes mots de passe, partout' });
  ctx.el.innerHTML = `
    <section class="transfer-hero glass" data-in>
      <div class="th-anim"><span class="th-a">${icon('file-up', 26)}</span><span class="th-line"><i></i><i></i><i></i></span><span class="th-b">${icon('lock', 26)}</span></div>
      <h2>Importer</h2>
      <p class="muted">Bitwarden, Keyra, KeePass / KeePassXC, Chrome, Firefox, Safari, LastPass, 1Password, Dashlane, Proton Pass, NordPass, Aegis… Le format est détecté tout seul.</p>
      <button class="btn primary block tap" data-act="import">${icon('upload', 18)}<span>Choisir un fichier</span></button>
      <details class="formats"><summary>Formats reconnus</summary><ul>${Object.values(FORMATS).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <p class="muted small">KeePass .kdbx : exporte d'abord en CSV ou XML depuis KeePassXC / KeePass. Bitwarden : Outils › Exporter le coffre › JSON (ou « protégé par mot de passe »).</p></details>
    </section>
    <h3 class="section-h" data-in>Exporter</h3>
    <div class="export-list">${Object.entries(EXPORTS).map(([k, e]) => `<button class="export-card glass tap ${e.encrypted ? 'enc' : 'clear'}" data-export="${k}" data-in>
      <span class="ex-ic">${icon(e.encrypted ? 'file-key' : 'file-text', 22)}</span><span class="ex-txt"><b>${esc(e.label)}</b><small>${esc(e.help)}</small></span>${e.encrypted ? `<span class="badge ok">${icon('lock', 12)}Chiffré</span>` : `<span class="badge warn">${icon('triangle-alert', 12)}En clair</span>`}</button>`).join('')}</div>`;
  fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.03 });
  if (fx.on) {
    const dots = ctx.el.querySelectorAll('.th-line i');
    gsap.fromTo(dots, { x: -30, opacity: 0 }, { x: 30, opacity: 1, duration: 1.2, stagger: 0.25, repeat: -1, ease: 'sine.inOut' });
    gsap.to(ctx.el.querySelector('.th-b'), { scale: 1.12, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }

  on(ctx.el, 'click', '[data-act=import]', () => doImport());
  on(ctx.el, 'click', '[data-export]', (e, b) => doExport(b.dataset.export));

  async function doImport() {
    const f = await pickFile({ accept: '.csv,.json,.xml,.txt,.mcfexport,.haiku,text/*,application/json' });
    if (!f) return;
    let preview;
    let password;
    for (;;) {
      try {
        preview = await parseImport(f.content, { password, fileName: f.name });
        break;
      } catch (e) {
        if (e instanceof NeedsPassword) {
          const r = await prompt({ title: FORMATS[e.format] || 'Fichier chiffré', message: password ? `<span class="err-txt">${esc(e.message)}</span>` : 'Ce fichier est chiffré.', fields: [{ name: 'pw', label: e.prompt, type: 'password' }], ok: 'Déchiffrer' });
          if (!r) return;
          password = r.pw;
          continue;
        }
        return toastError(e);
      }
    }
    if (!preview.entries.length) return toast('Aucun élément à importer dans ce fichier', { icon: 'info' });
    showPreview(preview, f.name);
  }

  function showPreview(p, fileName) {
    const folders = [...new Set(p.entries.map((e) => e.folder).filter(Boolean))];
    const byType = {};
    for (const e of p.entries) byType[e.item.type] = (byType[e.item.type] || 0) + 1;
    const s = sheet({
      title: 'Aperçu de l\'import',
      full: true,
      body: `<div class="import-prev">
        <div class="ip-head"><span class="badge">${esc(p.label)}</span><small class="muted">${esc(fileName)}</small></div>
        <div class="ip-stats"><div><b>${p.entries.length}</b><small>éléments</small></div><div><b>${folders.length}</b><small>dossiers</small></div>${p.skipped ? `<div><b>${p.skipped}</b><small>lignes vides ignorées</small></div>` : ''}</div>
        <div class="chips wrap">${Object.entries(byType).map(([t, n]) => `<span class="chip">${icon(TYPES[t].icon, 13)}<span>${esc(TYPES[t].label)}</span><b>${n}</b></span>`).join('')}</div>
        <label class="row-switch"><span>Créer les dossiers manquants${folders.length ? `<small>${folders.slice(0, 6).map(esc).join(', ')}${folders.length > 6 ? '…' : ''}</small>` : ''}</span>${switchHtml('folders', true)}</label>
        <label class="row-switch"><span>Ignorer les doublons<small>Même nom, identifiant, adresse et mot de passe</small></span>${switchHtml('dups', true)}</label>
        <div class="mini-list">${p.entries.slice(0, 40).map((e) => `<div class="mini-row">${monogram(e.item, 30)}<span><b>${esc(e.item.name)}</b><small>${esc(e.item.data?.username || TYPES[e.item.type].label)}${e.folder ? ` · ${esc(e.folder)}` : ''}</small></span></div>`).join('')}${p.entries.length > 40 ? `<p class="muted small center">… et ${p.entries.length - 40} autres</p>` : ''}</div>
        <p class="muted small">Les mots de passe ne sont pas affichés dans cet aperçu.</p></div>`,
      actions: `<button class="btn ghost tap" data-close>Annuler</button><button class="btn primary tap" data-go>${icon('download', 18)}<span>Importer ${p.entries.length}</span></button>`,
    });
    s.el.querySelector('[data-go]').onclick = async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('busy');
      try {
        const r = await applyImport(v, p, { createFolders: s.el.querySelector('[name=folders]').checked, skipDuplicates: s.el.querySelector('[name=dups]').checked });
        s.close();
        haptic('success');
        fx.confetti();
        const parts = [`${r.imported} importé${r.imported > 1 ? 's' : ''}`];
        if (r.duplicates) parts.push(`${r.duplicates} doublon${r.duplicates > 1 ? 's' : ''} ignoré${r.duplicates > 1 ? 's' : ''}`);
        if (r.foldersCreated.length) parts.push(`${r.foldersCreated.length} dossier${r.foldersCreated.length > 1 ? 's' : ''} créé${r.foldersCreated.length > 1 ? 's' : ''}`);
        toast(parts.join(' · '), { icon: 'circle-check', ms: 4000 });
        if (/\.(csv|json|xml|txt)$/i.test(fileName) && !p.format.includes('protected') && p.format !== 'haiku' && p.format !== 'keyra') {
          setTimeout(() => confirm({ title: 'Pense à supprimer le fichier', message: `« ${esc(fileName)} » contient tes mots de passe <b>en clair</b>. Supprime-le de ton téléphone (et de ta corbeille) maintenant qu'ils sont à l'abri dans Haiku.`, ok: 'Compris', icon: 'triangle-alert' }), 900);
        }
      } catch (err) {
        btn.classList.remove('busy');
        toastError(err);
      }
    };
  }

  async function doExport(format) {
    const spec = EXPORTS[format];
    if (!v.active.length) return toast('Le coffre est vide', { icon: 'info' });
    if (!spec.encrypted && !(await confirm({ title: 'Export en clair', message: `Ce fichier contiendra tes mots de passe <b>lisibles par n'importe qui</b> qui y a accès. Supprime-le dès qu'il a servi.`, ok: 'Je comprends', danger: true }))) return;
    const fields = [{ name: 'master', label: 'Mot de passe maître (confirmation)', type: 'password', autocomplete: 'current-password' }];
    if (spec.encrypted) fields.push({ name: 'pw', label: "Mot de passe d'export", type: 'password', hint: format === 'haiku' ? 'Peut être différent du mot de passe maître.' : 'Il sera demandé à l\'import.' }, { name: 'pw2', label: 'Confirmation', type: 'password' });
    if (format === 'haiku') fields.push({ name: 'history', label: 'Inclure l\'historique', type: 'checkbox', value: true }, { name: 'att', label: 'Inclure les pièces jointes', type: 'checkbox', value: true });
    let content = null;
    const r = await prompt({
      title: spec.label,
      fields,
      ok: 'Exporter',
      validate: async (d) => {
        if (!(await v.verifyPassword(d.master))) throw new Error('Mot de passe maître incorrect.');
        if (spec.encrypted) {
          if ((d.pw || '').length < 8) throw new Error("Le mot de passe d'export doit contenir au moins 8 caractères.");
          if (d.pw !== d.pw2) throw new Error('La confirmation ne correspond pas.');
        }
        content = await buildExport(format, v, { password: d.pw, history: d.history !== false, attachments: d.att !== false });
      },
    });
    if (!r || !content) return;
    const name = exportFileName(format, v.name);
    const where = await menu([{ icon: 'share-2', label: 'Partager…', hint: 'Drive, e-mail, Nearby Share, autre appli', value: 'share' }, { icon: 'hard-drive', label: 'Enregistrer dans Documents/Haiku', value: 'save' }], { title: name });
    try {
      if (where === 'share') await shareFile(name, content, spec.label);
      if (where === 'save') {
        const res = await docs.write('Exports', name, content);
        toast(`Enregistré : ${res.where}`, { icon: 'hard-drive', ms: 4000 });
      }
      if (where) { fx.confetti(); haptic('success'); }
    } catch (err) { toastError(err); }
  }
}
