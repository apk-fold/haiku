// Haiku Send : partager un texte ou un fichier chiffré sous forme de page HTML autonome.

import { fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, formatBytes, formatDateTime, timeAgo } from '../core/util.js';
import { buildSend, MAX_SEND_FILE } from '../core/send.js';
import { generatePassphrase } from '../core/generator.js';
import { segmented, bindSegmented, switchHtml, copy, toast, toastError, pickFile, bindSecretToggles, emptyState } from '../ui/components.js';
import { shareFile, shareText } from '../platform.js';
import { prefs } from '../prefs.js';

const EXPIRY = [['0', 'Jamais'], ['1', '1 heure'], ['24', '1 jour'], ['168', '7 jours'], ['720', '30 jours']];

export async function render(ctx) {
  const v = ctx.vault;
  let kind = 'text';
  let file = null;
  let expiry = '168';
  ctx.header({ title: 'Send', subtitle: 'Partage chiffré hors ligne' });
  ctx.el.innerHTML = `
    <section class="intro-card glass" data-in>${icon('send', 22)}<p>Crée une <b>page HTML autonome</b> qui contient ton texte ou fichier chiffré (AES-256). Envoie-la par n'importe quel canal, et transmets le mot de passe <b>par un autre</b>. Le destinataire l'ouvre dans son navigateur, sans appli ni serveur.</p></section>
    <form class="form card-sec glass send-form" data-in autocomplete="off">
      <label class="fld"><span>Titre</span><div class="inp"><input name="name" placeholder="Code Wi-Fi du salon" maxlength="80"></div></label>
      ${segmented('kind', [['text', 'Texte', 'type'], ['file', 'Fichier', 'paperclip']], kind)}
      <div class="k-text"><label class="fld"><span>Texte</span><textarea name="text" rows="5" placeholder="Le secret à transmettre…"></textarea></label>
        <label class="row-switch"><span>Masquer le texte à l'ouverture<small>Le destinataire touche pour l'afficher</small></span>${switchHtml('hide', false)}</label></div>
      <div class="k-file" hidden><button type="button" class="btn ghost block tap" data-act="pick">${icon('upload', 18)}<span>Choisir un fichier (${formatBytes(MAX_SEND_FILE)} max.)</span></button><p class="muted small file-info"></p></div>
      <label class="fld"><span>Mot de passe pour l'ouvrir</span><div class="inp secret"><input name="pw" type="password" autocomplete="new-password"><button type="button" class="ic-btn" data-toggle-secret>${icon('eye', 18)}</button><button type="button" class="ic-btn tap" data-act="genpw" aria-label="Générer">${icon('dices', 18)}</button></div></label>
      <div class="fld"><span>Expiration</span>${segmented('exp', EXPIRY, expiry)}<small class="hint">Indicative : la page refuse de s'ouvrir après la date, mais une copie du fichier reste une copie.</small></div>
      <button type="submit" class="btn primary block tap">${icon('sparkles', 18)}<span>Créer et partager</span></button>
    </form>
    <h3 class="section-h" data-in>Envois récents</h3>
    <div class="sends"></div>`;
  const form = ctx.el.querySelector('form');
  bindSecretToggles(form);
  bindSegmented(form, (name, val) => {
    if (name === 'kind') { kind = val; form.querySelector('.k-text').hidden = val !== 'text'; form.querySelector('.k-file').hidden = val !== 'file'; fx.stagger(form.querySelectorAll(val === 'text' ? '.k-text > *' : '.k-file > *'), { y: 10 }); }
    if (name === 'exp') expiry = val;
  });

  const drawSends = () => {
    const list = v.data.sends || [];
    ctx.el.querySelector('.sends').innerHTML = list.length ? `<div class="mini-list">${list.slice(0, 30).map((s) => `<div class="mini-row"><span class="r-ic">${icon(s.kind === 'file' ? 'paperclip' : 'type', 18)}</span><span><b>${esc(s.name)}</b><small>${formatDateTime(s.createdAt)}${s.expiresAt ? ` · ${new Date(s.expiresAt) < new Date() ? 'expiré' : `expire ${timeAgo(s.expiresAt).replace('il y a', 'dans')}`}` : ''}</small></span><em>${formatBytes(s.size || 0)}</em></div>`).join('')}</div>` : emptyState('send', 'Aucun envoi', 'Le contenu n\'est jamais conservé ici, seulement le titre et la date.');
  };
  drawSends();

  on(form, 'click', '[data-act=genpw]', async (e, b) => {
    const g = await generatePassphrase({ words: 4, separator: '-', capitalize: false, number: true, lang: prefs.g.passphrase.lang });
    const inp = form.pw;
    inp.type = 'text';
    fx.scramble(inp, g.value);
    inp.value = g.value;
    fx.pop(b);
  });
  on(form, 'click', '[data-act=pick]', async () => {
    const f = await pickFile({ as: 'file' });
    if (!f) return;
    if (f.size > MAX_SEND_FILE) return toast('Fichier trop lourd', { icon: 'circle-alert', kind: 'error' });
    file = f.file;
    form.querySelector('.file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    if (!form.name.value) form.name.value = f.name;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.classList.add('busy');
    try {
      const name = form.name.value.trim() || 'Haiku Send';
      const expiresAt = +expiry ? new Date(Date.now() + +expiry * 3600000).toISOString() : null;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const { html, size } = await buildSend({ name, kind, text: form.text.value, file, password: form.pw.value, expiresAt, hideText: form.hide.checked, accent });
      const fname = `${name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'send'}.html`;
      await shareFile(fname, html, name);
      await v.logSend({ name, kind, size, expiresAt });
      btn.classList.remove('busy');
      fx.confetti();
      const pw = form.pw.value;
      toast('Send créé · pense à transmettre le mot de passe séparément', { icon: 'send', ms: 3500 });
      form.reset();
      file = null;
      form.querySelector('.file-info').textContent = '';
      drawSends();
      setTimeout(async () => {
        const { menu } = await import('../ui/components.js');
        const c = await menu([{ icon: 'copy', label: 'Copier le mot de passe', value: 'copy' }, { icon: 'share-2', label: 'Partager le mot de passe', hint: 'Par une autre appli que le fichier', value: 'share' }], { title: 'Et le mot de passe ?' });
        if (c === 'copy') copy(pw, { label: 'Mot de passe copié' });
        if (c === 'share') shareText(pw, 'Mot de passe');
      }, 400);
    } catch (err) {
      btn.classList.remove('busy');
      toastError(err);
      fx.shake(form);
    }
  });
}
