// Fiche d'un élément : champs (secrets révélés façon « décryptage »), code 2FA en direct,
// carte bancaire 3D retournable, QR Wi-Fi, historique des versions et des mots de passe.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on, longPress } from '../ui/dom.js';
import { esc, formatDateTime, timeAgo, formatBytes, hostname } from '../core/util.js';
import { TYPES, subtitle, cardBrand, cardExpired } from '../core/schema.js';
import { totpCode, formatCode, parseTotp, nextHotp } from '../core/totp.js';
import { estimate } from '../core/strength.js';
import { monogram, copy, menu, toast, confirm, showQr, sheet } from '../ui/components.js';
import { guard } from '../app.js';
import { prefs } from '../prefs.js';
import { openUrl, saveBlob, haptic } from '../platform.js';
import { Vault } from '../core/vault.js';

const MASK = '••••••••••';

export async function render(ctx) {
  const v = ctx.vault;
  const id = ctx.params[0];
  let it = v.item(id);
  if (!it) {
    ctx.header({ title: 'Introuvable', back: true });
    ctx.el.innerHTML = '<div class="empty"><h3>Élément introuvable</h3></div>';
    return;
  }
  const t = TYPES[it.type];
  const headerActions = `<button class="ic-btn tap" data-act="fav" aria-label="Favori">${icon('star', 20, it.favorite ? 'filled' : '')}</button><button class="ic-btn tap" data-act="edit" aria-label="Modifier">${icon('square-pen')}</button><button class="ic-btn tap" data-act="more" aria-label="Plus">${icon('ellipsis-vertical')}</button>`;
  ctx.header({ title: it.name, subtitle: t.label, back: !ctx.inAside, actions: headerActions, onAction: (a, b) => headerAction(a, b) });

  if (it.reprompt && !(await guard(it))) {
    ctx.el.innerHTML = `<div class="empty">${icon('lock', 34)}<h3>Élément protégé</h3><p>Le mot de passe maître est demandé pour l'afficher.</p><button class="btn primary tap" data-act="unlock">Déverrouiller</button></div>`;
    ctx.el.querySelector('[data-act=unlock]').onclick = () => ctx.refresh();
    return;
  }

  let totpTimer = null;
  const draw = () => {
    it = v.item(id);
    if (!it) return;
    ctx.el.innerHTML = `
      <div class="hero" data-in>
        <div class="hero-mono">${monogram(it, 76)}</div>
        <div class="hero-txt"><h2>${esc(it.name)}</h2><p>${esc(subtitle(it))}</p>
          <div class="chips wrap">${it.folderId ? `<button class="chip tap" data-folder="${esc(v.folderName(it.folderId))}">${icon('folder', 13)}<span>${esc(v.folderName(it.folderId))}</span></button>` : ''}${(it.tags || []).map((tg) => `<button class="chip tag tap" data-tag="${esc(tg)}">#${esc(tg)}</button>`).join('')}${it.reprompt ? `<span class="chip warn">${icon('lock', 13)}<span>Protégé</span></span>` : ''}</div>
        </div>
      </div>
      ${it.type === 'card' ? cardVisual(it) : ''}
      ${fieldsHtml(it, v)}
      ${it.data?.totp ? totpHtml(it) : ''}
      ${it.type === 'login' && (it.data.uris || []).length ? urisHtml(it) : ''}
      ${it.type === 'wifi' ? `<button class="btn ghost block tap" data-act="wifiqr" data-in>${icon('qr-code', 18)}<span>Partager le Wi-Fi par QR code</span></button>` : ''}
      ${it.type === 'server' && it.data.hostname ? `<button class="btn ghost block tap" data-act="sshcmd" data-in>${icon('terminal', 18)}<span>Copier la commande de connexion</span></button>` : ''}
      ${it.notes ? `<section class="card-sec glass" data-in><header>${icon('scroll-text', 16)}<span>Notes</span><button class="ic-btn tap" data-copy-notes>${icon('copy', 16)}</button></header><div class="notes">${esc(it.notes).replace(/\n/g, '<br>')}</div></section>` : ''}
      ${customFieldsHtml(it)}
      ${attachmentsHtml(it)}
      ${historyHtml(it)}
      <section class="meta" data-in>
        <div><small>Créé</small><span>${formatDateTime(it.createdAt)}</span></div>
        <div><small>Modifié</small><span>${formatDateTime(it.updatedAt)}</span></div>
        ${it.data?.passwordRevisionDate ? `<div><small>Mot de passe changé</small><span>${formatDateTime(it.data.passwordRevisionDate)}</span></div>` : ''}
        ${it.usedAt ? `<div><small>Dernière utilisation</small><span>${timeAgo(it.usedAt)}</span></div>` : ''}
      </section>`;
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.05 });
    if (fx.on) gsap.from(ctx.el.querySelector('.hero-mono'), { scale: 0.4, rotation: -20, duration: fx.d(0.9), ease: 'elastic.out(1,0.5)' });
    const card = ctx.el.querySelector('.ccard');
    if (card && prefs.a.tilt) fx.tilt(card.parentElement, 12);
    if (it.data?.totp) startTotp();
  };

  const startTotp = () => {
    clearInterval(totpTimer);
    const box = ctx.el.querySelector('.totp-box');
    if (!box) return;
    const ring = box.querySelector('.ring-fg');
    const R = 2 * Math.PI * 26;
    let last = '';
    const tick = async () => {
      const c = await totpCode(it.data.totp).catch(() => null);
      if (!c) { box.querySelector('.code').textContent = 'Clé invalide'; return; }
      const txt = formatCode(c.code);
      if (c.code !== last) {
        if (last && fx.on) fx.scramble(box.querySelector('.code'), txt, { chars: '0123456789', duration: 0.7 }); else box.querySelector('.code').textContent = txt;
        last = c.code;
        box.dataset.code = c.code;
      }
      if (c.period) {
        ring.style.strokeDasharray = `${R}`;
        gsap.to(ring, { strokeDashoffset: R * (1 - (c.remaining - 1) / c.period), duration: 1, ease: 'none' });
        box.querySelector('.sec').textContent = c.remaining;
        box.classList.toggle('low', c.remaining <= 5);
        if (c.remaining <= 5 && fx.on) gsap.fromTo(box.querySelector('.sec'), { scale: 1.4 }, { scale: 1, duration: 0.4 });
      }
    };
    tick();
    if (parseTotp(it.data.totp)?.kind !== 'hotp') totpTimer = setInterval(tick, 1000);
  };

  draw();
  if (fx.on && ctx.el.querySelector('.ccard')) gsap.from(ctx.el.querySelector('.ccard'), { rotationY: -100, rotationX: 20, y: 40, opacity: 0, duration: fx.d(1.1), ease: 'back.out(1.4)', transformPerspective: 900 });

  // ---- interactions -------------------------------------------------------------------
  on(ctx.el, 'click', '[data-reveal]', async (e, b) => {
    const row = b.closest('.frow');
    const valEl = row.querySelector('.fval');
    const shown = row.classList.toggle('shown');
    const val = row.dataset.secret;
    b.innerHTML = icon(shown ? 'eye-off' : 'eye', 18);
    fx.pop(b);
    if (shown) {
      fx.scramble(valEl, val, { duration: Math.min(1.2, 0.3 + val.length * 0.02) });
      if (row.dataset.k === 'password' && fx.on) gsap.fromTo(valEl, { textShadow: '0 0 18px var(--accent)' }, { textShadow: '0 0 0px transparent', duration: 1.2 });
    } else {
      gsap.killTweensOf(valEl);
      valEl.textContent = MASK;
    }
  });
  on(ctx.el, 'click', '[data-copy]', async (e, b) => {
    const row = b.closest('.frow');
    const val = row.dataset.secret ?? row.querySelector('.fval').textContent;
    const sensitive = !!row.dataset.secret;
    await copy(row.dataset.k === 'number' ? val.replace(/\s/g, '') : val, { label: `${row.dataset.label} copié`, sensitive, from: b });
    v.touch(id);
  });
  longPress(ctx.el, '.frow[data-secret]', (e, row) => {
    // Appui long sur un secret : grand affichage lisible (comme Bitwarden)
    const val = row.dataset.secret;
    const s = sheet({ title: row.dataset.label, body: `<div class="big-secret mono-font">${[...val].map((c) => `<span class="${/\d/.test(c) ? 'd' : /[^a-z0-9]/i.test(c) ? 's' : /[A-Z]/.test(c) ? 'u' : ''}">${esc(c)}</span>`).join('')}</div><p class="muted center small">Chiffres, symboles et majuscules sont colorés différemment.</p>` });
    fx.stagger(s.el.querySelectorAll('.big-secret span'), { y: 10, each: 0.015 });
  });
  on(ctx.el, 'click', '[data-copy-totp]', async (e, b) => {
    const box = ctx.el.querySelector('.totp-box');
    await copy(box.dataset.code, { label: 'Code 2FA copié', from: box.querySelector('.code') });
  });
  on(ctx.el, 'click', '[data-act=hotp-next]', async () => {
    await v.saveItem({ ...it, data: { ...it.data, totp: nextHotp(it.data.totp) } });
    draw();
  });
  on(ctx.el, 'click', '[data-open]', (e, b) => { openUrl(b.dataset.open); v.touch(id); });
  on(ctx.el, 'click', '[data-copy-uri]', (e, b) => copy(b.dataset.copyUri, { label: 'Adresse copiée', sensitive: false, from: b }));
  on(ctx.el, 'click', '[data-copy-notes]', (e, b) => copy(it.notes, { label: 'Notes copiées', from: b }));
  on(ctx.el, 'click', '[data-tag]', (e, b) => { sessionStorage.setItem('haiku.vault.q', `#${b.dataset.tag.includes(' ') ? `"${b.dataset.tag}"` : b.dataset.tag}`); ctx.go('#/vault'); });
  on(ctx.el, 'click', '[data-folder]', (e, b) => { sessionStorage.setItem('haiku.vault.q', `in:${b.dataset.folder}`); ctx.go('#/vault'); });
  on(ctx.el, 'click', '[data-att]', async (e, b) => {
    const a = it.attachments.find((x) => x.id === b.dataset.att);
    if (a) await saveBlob(a.name, a.data, a.mime || 'application/octet-stream');
  });
  on(ctx.el, 'click', '.ccard-wrap', async (e, w) => {
    const c = w.querySelector('.ccard');
    const flipped = c.classList.toggle('flipped');
    haptic('light');
    gsap.to(c, { rotationY: flipped ? 180 : 0, duration: fx.d(0.8) || 0.01, ease: 'back.out(1.4)' });
  });
  on(ctx.el, 'click', '[data-act=wifiqr]', () => {
    const d = it.data;
    const sec = d.security === 'Ouvert' ? 'nopass' : d.security === 'WEP' ? 'WEP' : 'WPA';
    const e = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
    showQr(`WIFI:T:${sec};S:${e(d.ssid)};P:${e(d.password)};${d.hidden ? 'H:true;' : ''};`, { title: d.ssid || it.name, caption: 'Scanne ce code avec l\'appareil photo d\'un autre téléphone pour rejoindre le réseau.' });
  });
  on(ctx.el, 'click', '[data-act=sshcmd]', (e, b) => {
    const d = it.data;
    const p = (d.protocol || 'SSH').toUpperCase();
    const cmd = p === 'SFTP' ? `sftp ${d.port ? `-P ${d.port} ` : ''}${d.username ? `${d.username}@` : ''}${d.hostname}` : p === 'RDP' ? `mstsc /v:${d.hostname}${d.port ? `:${d.port}` : ''}` : `ssh ${d.username ? `${d.username}@` : ''}${d.hostname}${d.port && d.port !== '22' ? ` -p ${d.port}` : ''}`;
    copy(cmd, { label: 'Commande copiée', sensitive: false, from: b });
  });
  on(ctx.el, 'click', '[data-pwh]', async (e, b) => {
    const p = it.passwordHistory[+b.dataset.pwh];
    copy(p.password, { label: 'Ancien mot de passe copié', from: b });
  });
  on(ctx.el, 'click', '[data-ver]', (e, b) => showVersion(+b.dataset.ver));
  on(ctx.el, 'click', '[data-act=checkpw]', async (e, b) => {
    b.classList.add('busy');
    try {
      const { checkExposed } = await import('../core/audit.js');
      const m = await checkExposed([it]);
      const n = m.get(it.id);
      toast(n ? `Trouvé dans ${n.toLocaleString('fr-FR')} fuite${n > 1 ? 's' : ''} : change-le !` : 'Aucune fuite connue', { icon: n ? 'shield-alert' : 'shield-check', kind: n ? 'error' : '', ms: 4000 });
      if (!n) fx.burst(e.clientX, e.clientY, { count: 12 });
    } catch (err) {
      toast(`Vérification impossible : ${err.message}`, { icon: 'cloud-off', kind: 'error' });
    }
    b.classList.remove('busy');
  });

  const showVersion = (i) => {
    const ver = it.history[i];
    const snap = ver.snapshot;
    const cur = Vault.snapshot(it);
    const rows = [];
    const label = (k) => TYPES[it.type].fields.find((f) => f.key === k)?.label || k;
    if (snap.name !== cur.name) rows.push(['Nom', snap.name, cur.name]);
    if (snap.notes !== cur.notes) rows.push(['Notes', snap.notes, cur.notes]);
    if ((snap.tags || []).join(', ') !== (cur.tags || []).join(', ')) rows.push(['Étiquettes', (snap.tags || []).join(', '), (cur.tags || []).join(', ')]);
    if (snap.folderId !== cur.folderId) rows.push(['Dossier', v.folderName(snap.folderId), v.folderName(cur.folderId)]);
    for (const k of new Set([...Object.keys(snap.data || {}), ...Object.keys(cur.data || {})])) {
      if (k === 'uris') {
        const a = (snap.data.uris || []).map((u) => u.uri).join('\n');
        const b = (cur.data.uris || []).map((u) => u.uri).join('\n');
        if (a !== b) rows.push(['Adresses', a, b]);
        continue;
      }
      if (k === 'passwordRevisionDate') continue;
      if (String(snap.data?.[k] ?? '') !== String(cur.data?.[k] ?? '')) rows.push([label(k), String(snap.data?.[k] ?? ''), String(cur.data?.[k] ?? ''), TYPES[it.type].fields.find((f) => f.key === k)?.kind === 'secret']);
    }
    if (JSON.stringify(snap.fields || []) !== JSON.stringify(cur.fields || [])) rows.push(['Champs personnalisés', (snap.fields || []).map((f) => `${f.name}: ${f.type === 'hidden' ? MASK : f.value}`).join('\n'), (cur.fields || []).map((f) => `${f.name}: ${f.type === 'hidden' ? MASK : f.value}`).join('\n')]);
    const s = sheet({
      title: `Version du ${formatDateTime(ver.date)}`,
      body: rows.length ? `<div class="diff">${rows.map(([l, a, b, secret]) => `<div class="diff-row"><small>${esc(l)}</small><div class="diff-old ${secret ? 'secret' : ''}" data-v="${esc(a)}">${secret ? MASK : esc(a || '—').replace(/\n/g, '<br>')}</div><div class="diff-new ${secret ? 'secret' : ''}" data-v="${esc(b)}">${secret ? MASK : esc(b || '—').replace(/\n/g, '<br>')}</div></div>`).join('')}</div><p class="muted small">En haut : cette version. En bas : la version actuelle. Touche un secret pour l'afficher.</p>` : '<p class="muted">Identique à la version actuelle.</p>',
      actions: `<button class="btn ghost tap" data-close>Fermer</button><button class="btn primary tap" data-restore>${icon('rotate-ccw', 16)}<span>Restaurer</span></button>`,
    });
    on(s.el, 'click', '.secret', (e, d) => { fx.scramble(d, d.dataset.v || '—'); d.classList.remove('secret'); });
    s.el.querySelector('[data-restore]').onclick = async () => {
      await v.restoreVersion(id, i);
      s.close();
      toast('Version restaurée (la version actuelle a été gardée dans l\'historique)', { icon: 'rotate-ccw', ms: 3200 });
      fx.confetti();
      draw();
    };
  };

  // En-tête
  async function headerAction(a, b) {
    if (a === 'edit') ctx.go(`#/edit/${id}`);
    if (a === 'fav') {
      const f = await v.toggleFavorite(id);
      b.innerHTML = icon('star', 20, f ? 'filled' : '');
      fx.pop(b, 1.6);
      if (f) { const r = b.getBoundingClientRect(); fx.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 12, colors: ['#facc15', '#fde68a', '#fff'] }); }
      haptic('medium');
    }
    if (a === 'more') {
      const c = await menu([
        { icon: 'copy', label: 'Dupliquer', value: 'clone' },
        { icon: 'folder', label: 'Déplacer vers un dossier', value: 'move' },
        it.data?.totp && { icon: 'qr-code', label: 'Afficher le QR de la clé 2FA', hint: 'Pour la transférer vers une autre appli', value: 'totpqr' },
        it.history?.length && { icon: 'history', label: "Effacer l'historique", value: 'clearhist' },
        '-',
        { icon: 'trash-2', label: 'Mettre à la corbeille', value: 'trash', danger: true },
      ], { title: it.name });
      if (c === 'clone') { const n = await v.clone(id); toast('Élément dupliqué'); ctx.go(`#/edit/${n.id}`); }
      if (c === 'move') {
        const f = await menu([{ icon: 'folder-open', label: 'Sans dossier', value: '__none' }, ...v.folders.map((x) => ({ icon: 'folder', label: x.name, value: x.id }))], { title: 'Déplacer vers…' });
        if (f) { await v.moveToFolder(id, f === '__none' ? null : f); draw(); toast('Déplacé', { icon: 'folder' }); }
      }
      if (c === 'totpqr' && (await guard(it))) {
        const cfg = parseTotp(it.data.totp);
        const uri = /^otpauth:/i.test(it.data.totp) ? it.data.totp : `otpauth://totp/${encodeURIComponent(`${it.name}:${it.data.username || ''}`)}?secret=${cfg.secret}&issuer=${encodeURIComponent(it.name)}`;
        showQr(uri, { title: 'Clé 2FA', caption: 'Ce QR contient le secret : ne le montre qu\'à ta propre appli d\'authentification.' });
      }
      if (c === 'clearhist' && (await confirm({ title: "Effacer l'historique ?", message: 'Les versions précédentes et les anciens mots de passe de cet élément seront supprimés.', ok: 'Effacer', danger: true }))) { await v.clearHistory(id); draw(); }
      if (c === 'trash') { await v.trashItems(id); toast('Mis à la corbeille', { icon: 'trash-2' }); ctx.back(); }
    }
  }

  const unsub = v.subscribe(() => { if (!v.item(id)) return; });
  return () => { clearInterval(totpTimer); unsub(); };
}

// ---- gabarits ---------------------------------------------------------------------------

function frow(k, label, value, { secret = false, mono = false, copyable = true, extra = '' } = {}) {
  if (value === '' || value == null || value === false) return '';
  const val = String(value);
  return `<div class="frow ${secret ? 'is-secret' : ''}" data-k="${k}" data-label="${esc(label)}" ${secret ? `data-secret="${esc(val)}"` : ''}>
    <div class="fmain"><small>${esc(label)}</small><span class="fval ${mono || secret ? 'mono-font' : ''}">${secret ? MASK : esc(val)}</span>${extra}</div>
    ${secret ? `<button class="ic-btn tap" data-reveal aria-label="Afficher">${icon('eye', 18)}</button>` : ''}
    ${copyable ? `<button class="ic-btn tap" data-copy aria-label="Copier">${icon('copy', 18)}</button>` : ''}
  </div>`;
}

function fieldsHtml(it) {
  const d = it.data || {};
  const rows = [];
  for (const f of TYPES[it.type].fields) {
    if (f.kind === 'totp') continue;
    if (it.type === 'card' && ['expMonth', 'expYear'].includes(f.key)) continue;
    let val = d[f.key];
    if (f.kind === 'bool') { if (val) rows.push(frow(f.key, f.label, 'Oui', { copyable: false })); continue; }
    let extra = '';
    if (f.key === 'password' && val) {
      const s = estimate(val);
      extra = `<span class="pw-badge s${s.score}">${esc(s.label)}</span><button class="link small tap" data-act="checkpw">${icon('shield-alert', 13)}Vérifier les fuites</button>`;
    }
    if (f.key === 'number' && val) val = String(val).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
    rows.push(frow(f.key, f.label, val, { secret: f.kind === 'secret', mono: f.mono, extra }));
    if (it.type === 'card' && f.key === 'brand' && (d.expMonth || d.expYear)) rows.push(frow('exp', 'Expiration', `${d.expMonth || '--'}/${d.expYear || '----'}`, { extra: cardExpired(d) ? '<span class="pw-badge s0">Expirée</span>' : '' }));
  }
  const html = rows.filter(Boolean).join('');
  return html ? `<section class="card-sec glass fields" data-in>${html}</section>` : '';
}

function totpHtml(it) {
  const cfg = parseTotp(it.data.totp);
  const hotp = cfg?.kind === 'hotp';
  return `<section class="totp-box glass" data-in>
    <div class="ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="ring-bg"/><circle cx="30" cy="30" r="26" class="ring-fg"/></svg><b class="sec">${hotp ? '#' : ''}</b></div>
    <div class="totp-main"><small>Code 2FA${cfg?.kind === 'steam' ? ' Steam' : hotp ? ` HOTP (compteur ${cfg.counter})` : ''}</small><button class="code mono-font tap" data-copy-totp></button></div>
    ${hotp ? `<button class="ic-btn tap" data-act="hotp-next" aria-label="Code suivant">${icon('refresh-cw', 18)}</button>` : `<button class="ic-btn tap" data-copy-totp aria-label="Copier">${icon('copy', 18)}</button>`}
  </section>`;
}

function urisHtml(it) {
  return `<section class="card-sec glass" data-in><header>${icon('globe', 16)}<span>Sites et applis</span></header>${it.data.uris.map((u) => `<div class="frow"><div class="fmain"><small>${esc(hostname(u.uri) || 'Adresse')}${/^http:\/\//i.test(u.uri) ? ' · <span class="warn-txt">non sécurisé</span>' : ''}</small><span class="fval">${esc(u.uri)}</span></div>${/^https?:|^[\w.-]+\.[a-z]{2,}/i.test(u.uri) ? `<button class="ic-btn tap" data-open="${esc(u.uri)}" aria-label="Ouvrir">${icon('external-link', 18)}</button>` : ''}<button class="ic-btn tap" data-copy-uri="${esc(u.uri)}" aria-label="Copier">${icon('copy', 18)}</button></div>`).join('')}</section>`;
}

function customFieldsHtml(it) {
  if (!it.fields?.length) return '';
  return `<section class="card-sec glass" data-in><header>${icon('sliders-horizontal', 16)}<span>Champs personnalisés</span></header>${it.fields.map((f, i) => (f.type === 'bool'
    ? frow(`cf${i}`, f.name, f.value === 'true' || f.value === true ? 'Oui' : 'Non', { copyable: false })
    : frow(`cf${i}`, f.name || 'Champ', f.value, { secret: f.type === 'hidden' }))).join('')}</section>`;
}

function attachmentsHtml(it) {
  if (!it.attachments?.length) return '';
  return `<section class="card-sec glass" data-in><header>${icon('paperclip', 16)}<span>Pièces jointes</span></header>${it.attachments.map((a) => `<button class="frow tap att" data-att="${a.id}"><span class="att-ic">${icon('file-text', 18)}</span><div class="fmain"><span class="fval">${esc(a.name)}</span><small>${formatBytes(a.size)}</small></div>${icon('share-2', 18)}</button>`).join('')}</section>`;
}

function historyHtml(it) {
  const pwh = it.passwordHistory || [];
  const hist = it.history || [];
  if (!pwh.length && !hist.length) return '';
  return `<section class="card-sec glass" data-in><header>${icon('history', 16)}<span>Historique</span></header>
    ${pwh.length ? `<details class="hist"><summary>${icon('key-round', 15)}<span>Anciens mots de passe</span><b>${pwh.length}</b></summary>${pwh.map((p, i) => `<div class="frow" data-secret="${esc(p.password)}" data-k="old" data-label="Ancien mot de passe"><div class="fmain"><small>${formatDateTime(p.date)}</small><span class="fval mono-font">${MASK}</span></div><button class="ic-btn tap" data-reveal>${icon('eye', 18)}</button><button class="ic-btn tap" data-pwh="${i}">${icon('copy', 18)}</button></div>`).join('')}</details>` : ''}
    ${hist.length ? `<details class="hist"><summary>${icon('rotate-ccw', 15)}<span>Versions précédentes</span><b>${hist.length}</b></summary>${hist.map((h, i) => `<button class="frow tap" data-ver="${i}"><div class="fmain"><span class="fval">${formatDateTime(h.date)}</span><small>${timeAgo(h.date)} · ${esc(h.snapshot.name)}</small></div>${icon('chevron-right', 18)}</button>`).join('')}</details>` : ''}
  </section>`;
}

function cardVisual(it) {
  const d = it.data;
  const num = String(d.number || '').replace(/\s/g, '');
  const brand = d.brand || cardBrand(num) || 'Carte';
  const masked = num ? `•••• •••• •••• ${num.slice(-4)}` : '•••• •••• •••• ••••';
  const hue = { Visa: 230, Mastercard: 20, Amex: 190, CB: 140, Discover: 30, Maestro: 210, JCB: 340, UnionPay: 0 }[brand] ?? 268;
  return `<div class="ccard-wrap" data-in><div class="ccard" style="--h:${hue}">
    <div class="ccard-face front"><div class="cc-top"><span class="chip-ic"></span><b>${esc(brand)}</b></div><div class="cc-num mono-font">${masked}</div>
      <div class="cc-bottom"><div><small>Titulaire</small><span>${esc(d.cardholderName || '—')}</span></div><div><small>Expire</small><span>${esc(d.expMonth || '--')}/${esc(String(d.expYear || '--').slice(-2))}</span></div></div><i class="shine"></i></div>
    <div class="ccard-face back"><div class="cc-strip"></div><div class="cc-cvv"><small>CVV</small><span class="mono-font">${esc(d.code || '•••')}</span></div><small class="cc-tip">Touche pour retourner</small></div>
  </div></div>`;
}
