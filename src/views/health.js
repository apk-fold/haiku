// Santé du coffre : score, rapports dépliables, vérifications en ligne à la demande.

import { gsap, fx, Flip } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, formatDate } from '../core/util.js';
import { runAudit, REPORTS, checkExposed, fetchTwoFactorDomains } from '../core/audit.js';
import { loadDictionary } from '../core/strength.js';
import { monogram, toast, emptyState } from '../ui/components.js';
import { subtitle } from '../core/schema.js';

// Résultats en ligne gardés pour la session (jamais écrits sur le disque).
const online = { exposed: null, twofa: null, at: null };

export async function render(ctx) {
  const v = ctx.vault;
  await loadDictionary();
  ctx.header({ title: 'Santé', subtitle: 'Rapports du coffre', actions: '' });
  let open = null;

  const draw = (animateScore = true) => {
    const r = runAudit(v.items, { exposed: online.exposed || undefined, twofa: online.twofa || undefined });
    const grade = r.score >= 90 ? ['Excellent', 'Ton coffre est en pleine forme.'] : r.score >= 70 ? ['Correct', 'Quelques points à revoir.'] : r.score >= 40 ? ['À améliorer', 'Plusieurs mots de passe méritent un changement.'] : ['Fragile', 'Commence par les mots de passe exposés et réutilisés.'];
    ctx.el.innerHTML = `
      <section class="score-card glass" data-in>
        <div class="big-ring"><svg viewBox="0 0 200 200"><defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
          <circle cx="100" cy="100" r="84" class="ring-bg"/><circle cx="100" cy="100" r="84" class="ring-fg" stroke="url(#hg)"/>
          ${Array.from({ length: 40 }, (_, i) => `<line x1="100" y1="6" x2="100" y2="12" transform="rotate(${i * 9} 100 100)" class="tick"/>`).join('')}</svg>
          <div class="ring-center"><b class="score-num">${r.score}</b><small>/ 100</small></div></div>
        <h2>${grade[0]}</h2><p class="muted">${grade[1]}</p>
        <div class="online-checks">
          <button class="btn ghost small tap" data-check="exposed">${icon(online.exposed ? 'shield-check' : 'shield-alert', 16)}<span>${online.exposed ? 'Fuites vérifiées' : 'Vérifier les fuites'}</span></button>
          <button class="btn ghost small tap" data-check="twofa">${icon(online.twofa ? 'shield-check' : 'smartphone', 16)}<span>${online.twofa ? '2FA vérifiée' : 'Vérifier la 2FA'}</span></button>
        </div>
        <p class="muted small">Analyse locale. Les deux vérifications en ligne sont facultatives : Have I Been Pwned ne reçoit que 5 caractères d'empreinte, 2fa.directory ne reçoit rien de ton coffre.</p>
      </section>
      <div class="reports">${Object.entries(REPORTS).map(([k, rep]) => {
        const list = r.results[k];
        const pending = rep.online && !(k === 'exposed' ? r.checked.exposed : r.checked.twofa);
        return `<section class="report glass ${list.length ? 'bad' : 'ok'} ${open === k ? 'open' : ''}" data-flip-id="r-${k}" data-in>
          <button class="report-head tap" data-report="${k}"><span class="r-ic">${icon(rep.icon, 20)}</span><span class="r-txt"><b>${esc(rep.label)}</b><small>${pending ? 'Non vérifié' : list.length ? `${list.length} élément${list.length > 1 ? 's' : ''}` : 'Rien à signaler'}</small></span><b class="r-count">${pending ? '?' : list.length}</b>${icon('chevron-down', 18, 'r-chev')}</button>
          <div class="report-body">${open === k ? reportBody(k, list, rep) : ''}</div></section>`;
      }).join('')}</div>`;
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.04 });
    const ring = ctx.el.querySelector('.ring-fg');
    if (animateScore) {
      fx.ring(ring, r.score / 100, { duration: 1.6 });
      fx.countUp(ctx.el.querySelector('.score-num'), r.score, { duration: 1.6 });
      if (fx.on) gsap.from(ctx.el.querySelectorAll('.tick'), { opacity: 0, scale: 0, transformOrigin: '100px 100px', stagger: { each: 0.015, from: 'start' }, duration: 0.3, delay: 0.2 });
    } else fx.ring(ring, r.score / 100, { duration: 0.01 });
    return r;
  };

  const reportBody = (k, list, rep) => `<p class="muted small">${esc(rep.help)}</p>${list.length ? `<div class="mini-list">${list.map(({ item, count, date, label }) => `<a class="mini-row tap" href="#/item/${item.id}">${monogram(item, 32)}<span><b>${esc(item.name)}</b><small>${esc(subtitle(item))}</small></span><em>${k === 'exposed' ? `${count.toLocaleString('fr-FR')} fuite${count > 1 ? 's' : ''}` : k === 'reused' ? `×${count}` : k === 'old' ? formatDate(date) : k === 'weak' ? esc(label) : ''}</em></a>`).join('')}</div>` : emptyState('circle-check', 'Parfait', '')}`;

  let r = draw();

  on(ctx.el, 'click', '[data-report]', (e, b) => {
    const k = b.dataset.report;
    const state = Flip.getState(ctx.el.querySelectorAll('.report'));
    const sec = b.closest('.report');
    const wasOpen = sec.classList.contains('open');
    ctx.el.querySelectorAll('.report.open').forEach((x) => { x.classList.remove('open'); x.querySelector('.report-body').innerHTML = ''; });
    open = wasOpen ? null : k;
    if (!wasOpen) {
      sec.classList.add('open');
      sec.querySelector('.report-body').innerHTML = reportBody(k, r.results[k], REPORTS[k]);
    }
    fx.flip(state, ctx.el.querySelectorAll('.report'));
    if (!wasOpen) fx.stagger(sec.querySelectorAll('.mini-row'), { y: 8, each: 0.025 });
  });

  on(ctx.el, 'click', '[data-check]', async (e, b) => {
    const k = b.dataset.check;
    b.classList.add('busy');
    const label = b.querySelector('span');
    try {
      if (k === 'exposed') {
        online.exposed = await checkExposed(v.items, (p) => { label.textContent = `Vérification… ${Math.round(p * 100)} %`; });
        const n = online.exposed.size;
        toast(n ? `${n} mot${n > 1 ? 's' : ''} de passe exposé${n > 1 ? 's' : ''}` : 'Aucun mot de passe exposé', { icon: n ? 'shield-alert' : 'shield-check', kind: n ? 'error' : '' });
        if (!n) fx.confetti();
      } else {
        label.textContent = 'Téléchargement…';
        online.twofa = await fetchTwoFactorDomains();
        toast('Liste 2FA chargée', { icon: 'smartphone' });
      }
      open = k;
      r = draw(false);
    } catch (err) {
      b.classList.remove('busy');
      label.textContent = k === 'exposed' ? 'Vérifier les fuites' : 'Vérifier la 2FA';
      toast(`Connexion impossible : ${err.message}`, { icon: 'cloud-off', kind: 'error', ms: 4000 });
    }
  });
}
