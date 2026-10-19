// Remplissage automatique : choisir l'identifiant à remplir dans une autre appli ou un site,
// ou enregistrer celui qui vient d'être saisi.

import { fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, debounce, norm } from '../core/util.js';
import { findLogins, appLabel, uriMatches } from '../core/match.js';
import { matches } from '../core/tags.js';
import { totpCode } from '../core/totp.js';
import { blankItem, subtitle } from '../core/schema.js';
import { monogram, menu, toast, toastError, copy, emptyState, switchHtml, bindSecretToggles } from '../ui/components.js';
import { generatePassword } from '../core/generator.js';
import { prefs } from '../prefs.js';
import { guard } from '../app.js';
import { autofill } from '../platform.js';

export async function render(ctx) {
  const v = ctx.vault;
  const req = window.__haikuAutofill || {};
  const target = { packageName: req.packageName || '', webDomain: req.webDomain || '' };
  const isBrowser = !!req.webDomain;
  const label = req.webDomain || appLabel(req.packageName);
  const targetUri = req.webDomain ? `https://${req.webDomain}` : `androidapp://${req.packageName}`;
  ctx.header({ title: req.mode === 'save' ? 'Enregistrer' : 'Remplir', subtitle: label, actions: `<button class="ic-btn tap" data-act="cancel" aria-label="Annuler">${icon('x')}</button>`, onAction: () => autofill.cancel() });

  if (req.mode === 'save') return renderSave(ctx, v, req, label, targetUri);

  let q = '';
  const draw = () => {
    const suggested = findLogins(v.items, target);
    const ids = new Set(suggested.map((i) => i.id));
    const others = v.active.filter((i) => i.type === 'login' && !ids.has(i.id) && (!q || matches(i, q, v.folderName(i.folderId)))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const row = (it, s) => `<button class="row tap" data-fill="${it.id}">${monogram(it, 40)}<span class="row-txt"><b>${esc(it.name)}</b><small>${esc(subtitle(it))}</small></span>${s ? `<span class="badge ok">${icon('check', 12)}Correspond</span>` : ''}${it.data.totp ? icon('timer', 14) : ''}</button>`;
    ctx.el.innerHTML = `
      <section class="af-target glass" data-in>${icon(isBrowser ? 'globe' : 'smartphone', 22)}<div><b>${esc(label)}</b><small>${esc(isBrowser ? req.webDomain : req.packageName)} · ${req.userFields ? `${req.userFields} champ identifiant` : ''}${req.userFields && req.passFields ? ', ' : ''}${req.passFields ? `${req.passFields} champ mot de passe` : ''}</small></div></section>
      ${suggested.length ? `<h3 class="section-h" data-in>Suggestions</h3><div class="list">${suggested.map((i) => row(i, true)).join('')}</div>` : ''}
      <div class="search-bar glass" data-in>${icon('search', 18)}<input type="search" placeholder="Chercher un autre identifiant…" value="${esc(q)}" autocomplete="off"></div>
      <div class="list others">${others.length ? others.slice(0, 80).map((i) => row(i, false)).join('') : emptyState('search', 'Aucun identifiant', '')}</div>
      <button class="btn ghost block tap" data-act="new">${icon('plus', 18)}<span>Créer un identifiant pour ${esc(label)}</span></button>`;
    fx.stagger(ctx.el.querySelectorAll('[data-in], .row'), { each: 0.02 });
    const input = ctx.el.querySelector('input');
    input.addEventListener('input', debounce(() => { q = input.value; const pos = input.selectionStart; draw(); const i2 = ctx.el.querySelector('input'); i2.focus(); i2.setSelectionRange(pos, pos); }, 200));
  };

  const fill = async (it, from) => {
    if (!(await guard(it))) return;
    const known = (it.data.uris || []).some((u) => uriMatches(u, target));
    if (!known) {
      const c = await menu([
        { icon: 'zap', label: 'Remplir', value: 'fill' },
        { icon: 'link', label: `Remplir et mémoriser pour ${label}`, hint: 'La prochaine fois, il sera proposé directement', value: 'remember' },
      ], { title: it.name });
      if (!c) return;
      if (c === 'remember') await v.saveItem({ ...it, data: { ...it.data, uris: [...(it.data.uris || []), { uri: targetUri, match: '' }] } });
    }
    await v.touch(it.id);
    if (it.data.totp) {
      const t = await totpCode(it.data.totp).catch(() => null);
      if (t?.code) await copy(t.code, { label: 'Code 2FA copié pour l\'étape suivante', sensitive: true });
    }
    try {
      fx.burst(from?.getBoundingClientRect().left + 30 || innerWidth / 2, from?.getBoundingClientRect().top + 20 || innerHeight / 2, { count: 12 });
      await autofill.complete({ username: it.data.username || '', password: it.data.password || '', label: it.name });
    } catch (e) { toastError(e); }
  };

  draw();
  on(ctx.el, 'click', '[data-fill]', (e, b) => fill(v.item(b.dataset.fill), b));
  on(ctx.el, 'click', '[data-act=new]', async () => {
    const it = blankItem('login');
    it.name = isBrowser ? req.webDomain.replace(/^www\./, '') : appLabel(req.packageName);
    it.data.uris = [{ uri: targetUri, match: '' }];
    it.data.password = generatePassword(prefs.g.password).value;
    const saved = await v.saveItem(it);
    toast('Identifiant créé avec un mot de passe généré', { icon: 'sparkles' });
    fill(saved);
  });
}

function renderSave(ctx, v, req, label, targetUri) {
  const existing = v.active.filter((i) => i.type === 'login' && (i.data.uris || []).some((u) => uriMatches(u, { packageName: req.packageName, webDomain: req.webDomain })) && (!req.username || norm(i.data.username) === norm(req.username)));
  ctx.el.innerHTML = `
    <section class="af-target glass" data-in>${icon('save', 22)}<div><b>Enregistrer cet identifiant ?</b><small>${esc(label)}</small></div></section>
    ${existing.length ? `<section class="card-sec glass" data-in><header>${icon('refresh-cw', 16)}<span>Mettre à jour un élément existant</span></header>${existing.map((it) => `<button class="frow tap" data-update="${it.id}">${monogram(it, 34)}<div class="fmain"><span class="fval">${esc(it.name)}</span><small>${esc(it.data.username || '')}</small></div>${icon('chevron-right', 18)}</button>`).join('')}</section>` : ''}
    <form class="form card-sec glass" data-in autocomplete="off" style="padding:14px">
      <label class="fld"><span>Nom</span><div class="inp"><input name="name" value="${esc(req.webDomain ? req.webDomain.replace(/^www\./, '') : label)}"></div></label>
      <label class="fld"><span>Nom d'utilisateur</span><div class="inp"><input name="user" value="${esc(req.username || '')}" autocapitalize="off"></div></label>
      <label class="fld"><span>Mot de passe</span><div class="inp secret"><input name="pass" type="password" value="${esc(req.password || '')}"><button type="button" class="ic-btn" data-toggle-secret>${icon('eye', 18)}</button></div></label>
      <label class="fld"><span>Dossier</span><div class="inp sel"><select name="folder"><option value="">Sans dossier</option>${v.folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div></label>
      <label class="row-switch"><span>Favori</span>${switchHtml('fav', false)}</label>
      <button class="btn primary block tap" type="submit">${icon('check', 18)}<span>Enregistrer dans Haiku</span></button>
    </form>`;
  bindSecretToggles(ctx.el);
  fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.05 });
  const form = ctx.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const it = blankItem('login');
    it.name = form.name.value.trim() || label;
    it.data.username = form.user.value;
    it.data.password = form.pass.value;
    it.data.uris = [{ uri: targetUri, match: '' }];
    it.folderId = form.folder.value || null;
    it.favorite = form.fav.checked;
    try {
      await v.saveItem(it);
      fx.confetti();
      toast('Enregistré dans Haiku', { icon: 'check' });
      setTimeout(() => autofill.cancel(), 900);
    } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-update]', async (e, b) => {
    const it = v.item(b.dataset.update);
    if (!(await guard(it))) return;
    await v.saveItem({ ...it, data: { ...it.data, password: form.pass.value || it.data.password, username: form.user.value || it.data.username } });
    fx.confetti();
    toast('Mot de passe mis à jour (l\'ancien est dans l\'historique)', { icon: 'refresh-cw' });
    setTimeout(() => autofill.cancel(), 900);
  });
}
