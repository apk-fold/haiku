// Authentificateur : tous les codes 2FA du coffre, en direct, avec anneaux de compte à rebours.
// Ajout par QR (y compris l'export « Transférer des comptes » de Google Authenticator) ou par clé.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on, longPress } from '../ui/dom.js';
import { esc, debounce } from '../core/util.js';
import { totpCode, formatCode, parseTotp, parseMigration, isValidTotp, nextHotp } from '../core/totp.js';
import { monogram, copy, menu, toast, prompt, scanQr, emptyState, confirm } from '../ui/components.js';
import { guard } from '../app.js';
import { blankItem } from '../core/schema.js';
import { haptic } from '../platform.js';

export async function render(ctx) {
  const v = ctx.vault;
  let q = '';
  ctx.header({ title: 'Authentificateur', subtitle: 'Codes à usage unique', actions: `<button class="ic-btn tap accent" data-act="add" aria-label="Ajouter">${icon('plus')}</button>`, onAction: () => add() });
  ctx.el.innerHTML = `<div class="search-bar glass" data-in>${icon('search', 18)}<input type="search" placeholder="Filtrer…" autocomplete="off"></div><div class="totp-grid"></div>`;
  const grid = ctx.el.querySelector('.totp-grid');

  const items = () => v.active.filter((i) => i.data?.totp).filter((i) => !q || `${i.name} ${i.data.username || ''}`.toLowerCase().includes(q)).sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));

  const draw = () => {
    const list = items();
    if (!list.length) {
      grid.innerHTML = emptyState('timer', q ? 'Aucun code' : 'Aucun code 2FA', q ? '' : 'Ajoute la clé TOTP d\'un compte (QR code affiché par le site) pour générer ses codes ici, sans autre appli.', q ? '' : `<button class="btn primary tap" data-act="add">${icon('scan-line', 18)}<span>Scanner un QR code</span></button>`);
      return;
    }
    grid.innerHTML = list.map((it) => {
      const cfg = parseTotp(it.data.totp);
      const hotp = cfg?.kind === 'hotp';
      return `<button class="totp-card glass tap" data-id="${it.id}" data-in>
        <div class="tc-top">${monogram(it, 34)}<span class="tc-name"><b>${esc(it.name)}</b><small>${esc(it.data.username || cfg?.account || '')}</small></span>${it.favorite ? icon('star', 14, 'b-fav') : ''}</div>
        <div class="tc-code"><span class="code mono-font">${hotp ? '••• •••' : ''}</span>
          ${hotp ? `<span class="hotp-next" data-next="${it.id}">${icon('refresh-cw', 18)}</span>` : `<svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="ring-bg"/><circle cx="22" cy="22" r="18" class="ring-fg"/></svg><b class="sec"></b>`}</div>
        <div class="tc-next"><small>Suivant</small><span class="mono-font next"></span></div>
      </button>`;
    }).join('');
    fx.stagger(grid.children, { each: 0.04, y: 26 });
    if (fx.on) grid.querySelectorAll('.totp-card').forEach((c) => fx.tilt(c, 6));
    tick(true);
  };

  const tick = async (first = false) => {
    const now = Date.now();
    for (const card of grid.querySelectorAll('.totp-card')) {
      const it = v.item(card.dataset.id);
      if (!it?.data?.totp) continue;
      const cfg = parseTotp(it.data.totp);
      if (cfg?.kind === 'hotp') continue;
      const c = await totpCode(it.data.totp, now).catch(() => null);
      if (!c) { card.querySelector('.code').textContent = 'Clé invalide'; continue; }
      const codeEl = card.querySelector('.code');
      const txt = formatCode(c.code);
      if (codeEl.dataset.v !== c.code) {
        codeEl.dataset.v = c.code;
        if (!first && fx.on) {
          fx.scramble(codeEl, txt, { chars: '0123456789', duration: 0.8 });
          gsap.fromTo(card, { boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 0px transparent', duration: 1 });
        } else codeEl.textContent = txt;
        const nx = await totpCode(it.data.totp, now + c.period * 1000).catch(() => null);
        card.querySelector('.next').textContent = nx ? formatCode(nx.code) : '';
      }
      const ring = card.querySelector('.ring-fg');
      const R = 2 * Math.PI * 18;
      ring.style.strokeDasharray = `${R}`;
      if (first) gsap.set(ring, { strokeDashoffset: R * (1 - c.remaining / c.period) });
      else gsap.to(ring, { strokeDashoffset: R * (1 - (c.remaining - 1) / c.period), duration: 1, ease: 'none' });
      card.querySelector('.sec').textContent = c.remaining;
      card.classList.toggle('low', c.remaining <= 5);
    }
  };

  const add = async () => {
    const how = await menu([
      { icon: 'scan-line', label: 'Scanner un QR code', hint: 'Caméra ou capture d\'écran', value: 'scan' },
      { icon: 'key-round', label: 'Saisir une clé', hint: 'Clé base32 ou lien otpauth://', value: 'key' },
      { icon: 'smartphone', label: 'Importer depuis Google Authenticator', hint: 'Menu ⋮ › Transférer des comptes › Exporter, puis scanne le QR', value: 'ga' },
    ], { title: 'Ajouter un code 2FA' });
    if (!how) return;
    let text = null;
    if (how === 'scan' || how === 'ga') text = await scanQr({ title: how === 'ga' ? 'QR de transfert Google Authenticator' : 'QR code 2FA' });
    if (how === 'key') {
      const r = await prompt({ title: 'Clé 2FA', fields: [{ name: 'name', label: 'Nom du compte', placeholder: 'GitHub' }, { name: 'user', label: 'Identifiant (facultatif)' }, { name: 'key', label: 'Clé secrète', placeholder: 'JBSWY3DPEHPK3PXP' }], ok: 'Ajouter', validate: ({ key, name }) => { if (!name.trim()) throw new Error('Donne un nom.'); if (!isValidTotp(key)) throw new Error('Clé invalide.'); } });
      if (!r) return;
      return attach([{ issuer: r.name.trim(), account: r.user.trim(), totp: r.key.trim().replace(/\s/g, '').toUpperCase() }]);
    }
    if (!text) return;
    if (/^otpauth-migration:/i.test(text)) {
      let list;
      try { list = parseMigration(text); } catch { return toast('QR de transfert illisible', { icon: 'circle-alert', kind: 'error' }); }
      return attach(list, true);
    }
    const cfg = parseTotp(text);
    if (!cfg || !isValidTotp(text)) return toast("Ce QR n'est pas une clé 2FA", { icon: 'circle-alert', kind: 'error' });
    return attach([{ issuer: cfg.issuer, account: cfg.account, totp: text }]);
  };

  // Rattache une clé à un élément existant (même site / identifiant) ou en crée un nouveau.
  const attach = async (list, bulk = false) => {
    let created = 0;
    let linked = 0;
    for (const e of list) {
      const candidates = v.active.filter((i) => i.type === 'login' && !i.data.totp && (i.name.toLowerCase().includes((e.issuer || '~').toLowerCase()) || (e.account && i.data.username === e.account)));
      let target = null;
      if (!bulk && candidates.length) {
        const c = await menu([{ icon: 'plus', label: 'Nouvel élément', value: '__new' }, ...candidates.slice(0, 6).map((i) => ({ icon: 'key-round', label: `Ajouter à « ${i.name} »`, hint: i.data.username, value: i.id }))], { title: `${e.issuer || 'Compte'}${e.account ? ` · ${e.account}` : ''}` });
        if (!c) return;
        if (c !== '__new') target = v.item(c);
      } else if (bulk && candidates.length === 1) target = candidates[0];
      if (target) {
        await v.saveItem({ ...target, data: { ...target.data, totp: e.totp } });
        linked++;
      } else {
        const it = blankItem('login');
        it.name = e.issuer || e.account || 'Compte 2FA';
        it.data.username = e.account || '';
        it.data.totp = e.totp;
        await v.saveItem(it);
        created++;
      }
    }
    haptic('success');
    fx.confetti();
    toast(`${created ? `${created} créé${created > 1 ? 's' : ''}` : ''}${created && linked ? ' · ' : ''}${linked ? `${linked} rattaché${linked > 1 ? 's' : ''}` : ''}`, { icon: 'timer' });
    draw();
  };

  draw();
  const timer = setInterval(() => tick(), 1000);
  ctx.el.querySelector('input').addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 120));
  on(ctx.el, 'click', '[data-act=add]', () => add());
  on(grid, 'click', '.totp-card', async (e, card) => {
    if (card.dataset.longpressed) return;
    const it = v.item(card.dataset.id);
    if (!(await guard(it))) return;
    if (e.target.closest('[data-next]')) {
      await v.saveItem({ ...it, data: { ...it.data, totp: nextHotp(it.data.totp) } });
      const c = await totpCode(v.item(it.id).data.totp);
      card.querySelector('.code').textContent = formatCode(c.code);
      fx.pop(card.querySelector('.code'));
      return;
    }
    const c = await totpCode(it.data.totp);
    if (c?.code) copy(c.code, { label: 'Code copié', from: card.querySelector('.code') });
  });
  longPress(grid, '.totp-card', async (e, card) => {
    const it = v.item(card.dataset.id);
    haptic('medium');
    const c = await menu([
      { icon: 'external-link', label: "Ouvrir l'élément", value: 'open' },
      { icon: 'star', label: it.favorite ? 'Retirer des favoris' : 'Épingler en haut', value: 'fav' },
      { icon: 'trash-2', label: 'Retirer la clé 2FA', value: 'remove', danger: true },
    ], { title: it.name });
    if (c === 'open') ctx.go(`#/item/${it.id}`);
    if (c === 'fav') { await v.toggleFavorite(it.id); draw(); }
    if (c === 'remove' && (await guard(it)) && (await confirm({ title: 'Retirer la clé 2FA ?', message: 'Assure-toi d\'avoir désactivé la double authentification sur le site ou d\'avoir une autre appli configurée, sinon tu ne pourras plus te connecter.', ok: 'Retirer', danger: true }))) {
      await v.saveItem({ ...it, data: { ...it.data, totp: '' } });
      draw();
    }
  });
  return () => clearInterval(timer);
}
