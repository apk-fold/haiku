// Accueil : tableau de bord fait de widgets (activables et réordonnables dans Modules).

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on, longPress } from '../ui/dom.js';
import { esc, timeAgo } from '../core/util.js';
import { prefs, MODULES, WIDGETS } from '../prefs.js';
import { monogram, copy, toast } from '../ui/components.js';
import { subtitle, TYPES, TYPE_ORDER, mainPassword } from '../core/schema.js';
import { totpCode, formatCode, parseTotp } from '../core/totp.js';
import { runAudit } from '../core/audit.js';
import { generatePassword } from '../core/generator.js';
import { haikuOfDay } from '../ui/haikus.js';
import { guard, openPalette, newItemMenu } from '../app.js';
import { session } from '../session.js';
import { loadDictionary } from '../core/strength.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

export async function render(ctx) {
  const v = ctx.vault;
  await loadDictionary();
  ctx.header({ title: greeting(), subtitle: v.name, big: true, onAction: (a) => (a === 'palette' ? openPalette() : session.lock('manual')), actions: `<button class="ic-btn tap" data-act="palette" aria-label="Commandes">${icon('command')}</button><button class="ic-btn tap" data-act="lock" aria-label="Verrouiller">${icon('lock')}</button>` });
  const ids = prefs.m.home.filter((w) => WIDGETS[w] && (w !== 'totp' || prefs.moduleOn('totp')) && (w !== 'health' || prefs.moduleOn('health')) && (w !== 'quickgen' || prefs.moduleOn('gen')));
  const a = v.active;
  ctx.el.innerHTML = `<div class="widgets">${ids.map((id) => widget(id, v, a)).filter(Boolean).join('')}</div>${!a.length ? `<div class="onboard glass" data-in>${icon('sparkles', 22)}<div><b>Ton coffre est vide</b><p>Ajoute un premier élément avec le bouton +, ou importe tes mots de passe depuis Bitwarden, Keyra, ton navigateur…</p><a class="btn ghost small tap" href="#/transfer">${icon('arrow-down-up', 16)}<span>Importer</span></a></div></div>` : ''}`;
  const root = ctx.el;

  on(root, 'click', '[data-go]', (e, b) => { if (!b.dataset.longpressed) ctx.go(b.dataset.go); });
  on(root, 'click', '[data-copy-totp]', async (e, b) => {
    const it = v.item(b.dataset.copyTotp);
    if (!(await guard(it))) return;
    const c = await totpCode(it.data.totp);
    copy(c.code, { label: 'Code copié', from: b });
  });
  on(root, 'click', '[data-act=search]', () => openPalette());
  on(root, 'click', '[data-act=new]', (e, b) => newItemMenu(b));
  on(root, 'click', '[data-act=regen]', (e, b) => regen(root, b));
  on(root, 'click', '[data-act=copygen]', (e, b) => copy(root.querySelector('.qg-out').textContent, { label: 'Mot de passe copié', from: b }));
  on(root, 'click', '[data-tag]', (e, b) => { sessionStorage.setItem('haiku.vault.q', `#${b.dataset.tag.includes(' ') ? `"${b.dataset.tag}"` : b.dataset.tag}`); ctx.go('#/vault'); });
  on(root, 'click', '[data-folder]', (e, b) => { sessionStorage.setItem('haiku.vault.q', `in:${b.dataset.folder}`); ctx.go('#/vault'); });
  longPress(root, '[data-fav]', async (e, b) => {
    const it = v.item(b.dataset.fav);
    const pw = mainPassword(it);
    if (pw && (await guard(it))) copy(pw, { label: 'Mot de passe copié', from: b });
  });

  // Animations d'entrée propres aux widgets
  root.querySelectorAll('.w-card').forEach((c) => { c.dataset.in = ''; if (prefs.a.tilt) fx.tilt(c, 4); });
  const poem = root.querySelector('.w-haiku .poem');
  if (poem) fx.splitIn(poem, { type: 'words', each: 0.06, delay: fx.d(0.25) });
  const score = root.querySelector('.w-health');
  if (score) {
    const val = +score.dataset.score;
    fx.ring(score.querySelector('.ring-fg'), val / 100, { delay: fx.d(0.3) });
    fx.countUp(score.querySelector('.ring-num'), val);
  }
  root.querySelectorAll('.stat-bar i').forEach((b) => fx.on && gsap.from(b, { scaleX: 0, transformOrigin: '0 50%', duration: fx.d(1), ease: 'power3.out', delay: fx.d(0.3) }));
  if (fx.on) gsap.from(root.querySelectorAll('.fav'), { scale: 0.5, opacity: 0, rotation: () => gsap.utils.random(-12, 12), duration: fx.d(0.7), stagger: fx.d(0.05), ease: 'back.out(2)', delay: fx.d(0.2) });
  if (root.querySelector('.qg-out')) regen(root, null, true);

  // Codes 2FA en direct
  let timer = null;
  const tick = async () => {
    for (const row of root.querySelectorAll('[data-totp-id]')) {
      const it = v.item(row.dataset.totpId);
      if (!it?.data?.totp) continue;
      const c = await totpCode(it.data.totp).catch(() => null);
      if (!c) continue;
      const codeEl = row.querySelector('.code');
      const txt = formatCode(c.code);
      if (codeEl.dataset.v !== c.code) {
        codeEl.dataset.v = c.code;
        if (codeEl.textContent && fx.on) fx.scramble(codeEl, txt, { chars: '0123456789', duration: 0.6 }); else codeEl.textContent = txt;
      }
      const ring = row.querySelector('.mini-ring circle:last-child');
      if (ring && c.period) {
        const r = 2 * Math.PI * 9;
        ring.style.strokeDasharray = `${r}`;
        ring.style.strokeDashoffset = `${r * (1 - c.remaining / c.period)}`;
        row.classList.toggle('low', c.remaining <= 5);
      }
    }
  };
  if (root.querySelector('[data-totp-id]')) { tick(); timer = setInterval(tick, 1000); }
  return () => clearInterval(timer);
}

function regen(root, btn, silent = false) {
  const out = root.querySelector('.qg-out');
  const g = generatePassword(prefs.g.password);
  if (btn) { fx.press(btn); if (fx.on) gsap.fromTo(btn.querySelector('svg'), { rotation: 0 }, { rotation: 360, duration: fx.d(0.6), ease: 'back.out(2)' }); }
  if (silent || !fx.on) out.textContent = g.value; else fx.scramble(out, g.value, { duration: 0.5 });
}

function card(id, inner, extra = '') {
  return `<section class="w-card w-${id} glass ${extra}"><header class="w-head">${icon(WIDGETS[id].icon, 16)}<span>${esc(WIDGETS[id].name)}</span></header>${inner}</section>`;
}

function widget(id, v, a) {
  switch (id) {
    case 'haiku': {
      const p = haikuOfDay();
      return `<section class="w-card w-haiku glass wide"><div class="poem">${p.map((l) => `<span>${esc(l)}</span>`).join('<br>')}</div><div class="hanko">俳句</div></section>`;
    }
    case 'search':
      return `<button class="w-search glass tap" data-act="search">${icon('search', 18)}<span>Rechercher dans ${a.length} élément${a.length > 1 ? 's' : ''}…</span><kbd>${icon('command', 12)}K</kbd></button>`;
    case 'shortcuts': {
      const mods = Object.keys(MODULES).filter((m) => prefs.moduleOn(m) && !['home', 'settings', 'studio'].includes(m) && !prefs.m.tabs.includes(m)).slice(0, 8);
      return card('shortcuts', `<div class="shortcuts"><button class="sc tap" data-act="new"><span class="sc-ic accent">${icon('plus', 20)}</span><small>Ajouter</small></button>${mods.map((m) => `<button class="sc tap" data-go="${MODULES[m].route}"><span class="sc-ic">${icon(MODULES[m].icon, 20)}</span><small>${esc(MODULES[m].short || MODULES[m].name)}</small></button>`).join('')}</div>`, 'wide');
    }
    case 'favorites': {
      const favs = a.filter((i) => i.favorite).slice(0, 12);
      if (!favs.length) return card('favorites', '<p class="muted small">Touche l\'étoile d\'un élément pour l\'épingler ici. Appui long sur un favori : copier son mot de passe.</p>', 'wide');
      return card('favorites', `<div class="favs">${favs.map((it) => `<button class="fav tap" data-go="#/item/${it.id}" data-fav="${it.id}">${monogram(it, 48)}<small>${esc(it.name)}</small></button>`).join('')}</div>`, 'wide');
    }
    case 'totp': {
      const list = a.filter((i) => i.data?.totp && parseTotp(i.data.totp)?.kind !== 'hotp').slice(0, 4);
      if (!list.length) return '';
      return card('totp', `<div class="w-totp-list">${list.map((it) => `<button class="w-totp tap" data-totp-id="${it.id}" data-copy-totp="${it.id}"><span class="t-name">${esc(it.name)}</span><span class="code mono-font"></span><svg class="mini-ring" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/><circle cx="11" cy="11" r="9"/></svg></button>`).join('')}</div><a class="w-more tap" href="#/totp">Tous les codes ${icon('chevron-right', 14)}</a>`);
    }
    case 'health': {
      const r = runAudit(v.items);
      const n = Object.values(r.results).reduce((s, l) => s + l.length, 0);
      return `<section class="w-card w-health glass tap" data-go="#/health" data-score="${r.score}"><header class="w-head">${icon('gauge', 16)}<span>Santé du coffre</span></header>
        <div class="health-row"><div class="ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" class="ring-bg"/><circle cx="40" cy="40" r="32" class="ring-fg"/></svg><b class="ring-num">0</b></div>
        <div class="health-txt"><b>${r.score >= 90 ? 'Excellent' : r.score >= 70 ? 'Correct' : r.score >= 40 ? 'À améliorer' : 'Fragile'}</b><small>${n ? `${n} point${n > 1 ? 's' : ''} à revoir` : 'Rien à signaler'}</small><small>${r.results.reused.length} réutilisé${r.results.reused.length > 1 ? 's' : ''} · ${r.results.weak.length} faible${r.results.weak.length > 1 ? 's' : ''}</small></div></div></section>`;
    }
    case 'recent': {
      const list = a.slice().sort((x, y) => (y.usedAt || y.updatedAt || '').localeCompare(x.usedAt || x.updatedAt || '')).slice(0, 5);
      if (!list.length) return '';
      return card('recent', `<div class="mini-list">${list.map((it) => `<button class="mini-row tap" data-go="#/item/${it.id}">${monogram(it, 34)}<span><b>${esc(it.name)}</b><small>${esc(subtitle(it))}</small></span><time>${timeAgo(it.usedAt || it.updatedAt)}</time></button>`).join('')}</div>`, 'wide');
    }
    case 'quickgen':
      return card('quickgen', `<div class="qg"><code class="qg-out mono-font"></code><div class="qg-act"><button class="ic-btn tap" data-act="regen" aria-label="Nouveau">${icon('refresh-cw', 18)}</button><button class="ic-btn tap accent" data-act="copygen" aria-label="Copier">${icon('copy', 18)}</button></div></div><a class="w-more tap" href="#/gen">Options ${icon('chevron-right', 14)}</a>`);
    case 'stats': {
      const s = v.stats();
      const max = Math.max(1, ...Object.values(s.byType));
      return card('stats', `<div class="stats-top"><div><b>${s.total}</b><small>éléments</small></div><div><b>${s.favorites}</b><small>favoris</small></div><div><b>${s.totp}</b><small>2FA</small></div></div>
        <div class="stat-bars">${TYPE_ORDER.filter((t) => s.byType[t]).map((t) => `<div class="stat-bar"><span>${icon(TYPES[t].icon, 14)}${esc(TYPES[t].label)}</span><i style="--w:${(s.byType[t] / max) * 100}%;--h:${TYPES[t].hue}"></i><b>${s.byType[t]}</b></div>`).join('')}</div>`, 'wide');
    }
    case 'folders': {
      const counts = new Map();
      for (const it of a) counts.set(it.folderId || '', (counts.get(it.folderId || '') || 0) + 1);
      return card('folders', `<div class="chips wrap">${v.folders.map((f) => `<button class="chip tap" data-folder="${esc(f.name)}" style="${f.color ? `--chip:${f.color}` : ''}">${icon('folder', 14)}<span>${esc(f.name)}</span><b>${counts.get(f.id) || 0}</b></button>`).join('')}</div>`, 'wide');
    }
    case 'tags': {
      const tags = v.allTags().slice(0, 24);
      if (!tags.length) return '';
      const max = Math.max(...tags.map((t) => t.count));
      return card('tags', `<div class="tag-cloud">${tags.map((t) => `<button class="tag tap" data-tag="${esc(t.tag)}" style="--s:${0.8 + (t.count / max) * 0.7}">#${esc(t.tag)}</button>`).join('')}</div>`, 'wide');
    }
    default:
      return '';
  }
}

export { toast };
