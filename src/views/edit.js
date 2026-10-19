// Formulaire d'un élément (création / modification), tous types.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, deepClone, uuid, formatBytes, hostname } from '../core/util.js';
import { TYPES, TYPE_ORDER, URI_MATCH, blankItem, cardBrand } from '../core/schema.js';
import { cleanTag, normalizeTags, tagKey, MAX_TAGS } from '../core/tags.js';
import { isValidTotp, parseTotp, parseMigration } from '../core/totp.js';
import { generateEd25519, fingerprintOf, sshSupported } from '../core/ssh.js';
import { loadDictionary } from '../core/strength.js';
import { strengthHtml, updateStrength, switchHtml, bindSecretToggles, menu, toast, toastError, confirm, prompt, scanQr, pickFile, monogram } from '../ui/components.js';
import { openGeneratorSheet } from './gen.js';
import { guard } from '../app.js';
import { haptic } from '../platform.js';

const MAX_ATTACHMENT = 10 * 1024 * 1024;

export async function render(ctx) {
  const v = ctx.vault;
  const isNew = ctx.view === 'edit' && location.hash.startsWith('#/new/');
  let it;
  if (isNew) {
    it = blankItem(TYPES[ctx.params[0]] ? ctx.params[0] : 'login');
    const preset = sessionStorage.getItem('haiku.new.preset');
    if (preset) { try { const p = JSON.parse(preset); Object.assign(it, p, { data: { ...it.data, ...(p.data || {}) } }); } catch { /* */ } sessionStorage.removeItem('haiku.new.preset'); }
  } else {
    const src = v.item(ctx.params[0]);
    if (!src) { ctx.el.innerHTML = '<div class="empty"><h3>Élément introuvable</h3></div>'; return; }
    if (!(await guard(src))) { ctx.back(); return; }
    it = deepClone(src);
  }
  await loadDictionary();
  const original = JSON.stringify(it);
  let dirty = false;

  ctx.header({ title: isNew ? `Nouveau : ${TYPES[it.type].label}` : 'Modifier', subtitle: isNew ? '' : it.name, back: !ctx.inAside, actions: `<button class="ic-btn tap accent" data-act="save" aria-label="Enregistrer">${icon('check')}</button>`, onAction: (a) => a === 'save' && save() });

  const draw = () => {
    const t = TYPES[it.type];
    ctx.el.innerHTML = `<form class="form edit-form" autocomplete="off" novalidate>
      ${isNew ? `<div class="chips scroll type-pick" data-in>${TYPE_ORDER.map((k) => `<button type="button" class="chip tap ${k === it.type ? 'on' : ''}" data-type="${k}">${icon(TYPES[k].icon, 14)}<span>${esc(TYPES[k].label)}</span></button>`).join('')}</div>` : ''}
      <div class="edit-hero" data-in><span class="hero-mono">${monogram({ ...it, name: it.name || TYPES[it.type].label }, 56)}</span>
        <label class="fld grow"><span>Nom</span><div class="inp"><input name="name" value="${esc(it.name)}" placeholder="${esc(t.label)}" maxlength="200"></div></label></div>
      <section class="card-sec glass" data-in>${t.fields.map((f) => fieldHtml(f, it.data[f.key])).join('')}
        ${it.type === 'ssh' ? `<button type="button" class="btn ghost small tap" data-act="sshgen">${icon('wand-sparkles', 16)}<span>Générer une paire de clés Ed25519</span></button>` : ''}
      </section>
      ${it.type === 'login' ? urisHtml(it) : ''}
      <section class="card-sec glass" data-in><header>${icon('folder', 16)}<span>Organisation</span></header>
        <label class="fld"><span>Dossier</span><div class="inp sel"><select name="folderId"><option value="">Sans dossier</option>${v.folders.map((f) => `<option value="${f.id}" ${f.id === it.folderId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}<option value="__new">+ Nouveau dossier…</option></select></div></label>
        <div class="fld"><span>Étiquettes <small class="muted">(${MAX_TAGS} au plus)</small></span><div class="tag-editor"><div class="tag-list">${it.tags.map((tg) => tagChip(tg)).join('')}</div><input class="tag-input" placeholder="Ajouter… (Entrée)" enterkeyhint="done" autocapitalize="off"></div><div class="tag-sugg chips wrap"></div></div>
        <label class="row-switch"><span>Favori</span>${switchHtml('favorite', it.favorite)}</label>
        <label class="row-switch"><span>Redemander le mot de passe maître<small>Pour afficher, copier ou modifier cet élément</small></span>${switchHtml('reprompt', it.reprompt)}</label>
      </section>
      <section class="card-sec glass" data-in><header>${icon('scroll-text', 16)}<span>Notes</span></header><textarea name="notes" rows="4" placeholder="Notes chiffrées…">${esc(it.notes)}</textarea></section>
      <section class="card-sec glass" data-in><header>${icon('sliders-horizontal', 16)}<span>Champs personnalisés</span></header><div class="cfields">${it.fields.map((f, i) => customFieldHtml(f, i)).join('')}</div>
        <button type="button" class="btn ghost small tap" data-act="addfield">${icon('plus', 16)}<span>Ajouter un champ</span></button></section>
      <section class="card-sec glass" data-in><header>${icon('paperclip', 16)}<span>Pièces jointes</span></header><div class="atts">${it.attachments.map(attHtml).join('')}</div>
        <button type="button" class="btn ghost small tap" data-act="addatt">${icon('upload', 16)}<span>Joindre un fichier (10 Mo max.)</span></button></section>
      <div class="edit-foot"><button type="button" class="btn ghost tap" data-act="cancel">Annuler</button><button type="submit" class="btn primary tap">${icon('check', 18)}<span>Enregistrer</span></button></div>
    </form>`;
    const form = ctx.el.querySelector('form');
    bindSecretToggles(form);
    form.querySelectorAll('.strength').forEach((m) => updateStrength(m, form.querySelector(`[name="d.${m.dataset.for}"]`)?.value));
    fx.stagger(form.querySelectorAll('[data-in]'), { each: 0.04 });
    renderTagSugg();
    return form;
  };

  const fieldHtml = (f, val) => {
    const name = `d.${f.key}`;
    if (f.kind === 'bool') return `<label class="row-switch"><span>${esc(f.label)}</span>${switchHtml(name, !!val)}</label>`;
    if (f.kind === 'select') return `<label class="fld ${f.half ? 'half' : ''}"><span>${esc(f.label)}</span><div class="inp sel"><select name="${name}">${f.options.map((o) => `<option value="${esc(o)}" ${o === (val || '') ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></div></label>`;
    if (f.kind === 'textarea' || f.multiline) return `<label class="fld"><span>${esc(f.label)}</span><textarea name="${name}" rows="${f.multiline ? 5 : 3}" class="${f.mono ? 'mono-font' : ''} ${f.kind === 'secret' ? 'blurry' : ''}" spellcheck="false" autocapitalize="off">${esc(val || '')}</textarea></label>`;
    if (f.kind === 'totp') return `<label class="fld"><span>${esc(f.label)}</span><div class="inp"><input name="${name}" value="${esc(val || '')}" placeholder="Clé base32 ou lien otpauth://" spellcheck="false" autocapitalize="characters" class="mono-font"><button type="button" class="ic-btn tap" data-act="scan" aria-label="Scanner un QR">${icon('scan-line', 18)}</button></div><small class="hint totp-hint">${val ? (isValidTotp(val) ? '✓ Clé valide' : '⚠ Clé invalide') : 'Scanne le QR code affiché par le site lors de l\'activation de la double authentification.'}</small></label>`;
    const type = f.kind === 'secret' ? 'password' : f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : f.kind === 'date' ? 'date' : 'text';
    const secret = f.kind === 'secret';
    return `<label class="fld ${f.half ? 'half' : ''}"><span>${esc(f.label)}</span><div class="inp ${secret ? 'secret' : ''}">
      <input name="${name}" type="${type}" value="${esc(val || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} class="${f.mono ? 'mono-font' : ''}" autocapitalize="off" spellcheck="false" ${f.auto === 'username' ? 'autocomplete="username"' : secret ? 'autocomplete="new-password"' : ''}>
      ${secret ? `<button type="button" class="ic-btn" data-toggle-secret aria-label="Afficher">${icon('eye', 18)}</button>` : ''}
      ${f.gen ? `<button type="button" class="ic-btn tap" data-gen="${f.key}" aria-label="Générer">${icon('dices', 18)}</button>` : ''}
      ${f.auto === 'username' ? `<button type="button" class="ic-btn tap" data-gen-user="${f.key}" aria-label="Générer un identifiant">${icon('wand-sparkles', 18)}</button>` : ''}
    </div>${f.key === 'password' || (f.gen && f.kind === 'secret') ? `<div data-for="${f.key}" class="strength-slot">${strengthHtml().replace('class="strength"', `class="strength" data-for="${f.key}"`)}</div>` : ''}</label>`;
  };

  const urisHtml = (item) => `<section class="card-sec glass" data-in><header>${icon('globe', 16)}<span>Sites et applis</span></header><div class="uris">${(item.data.uris.length ? item.data.uris : [{ uri: '', match: '' }]).map((u, i) => uriRow(u, i)).join('')}</div>
    <button type="button" class="btn ghost small tap" data-act="adduri">${icon('plus', 16)}<span>Ajouter une adresse</span></button></section>`;
  const uriRow = (u, i) => `<div class="uri-row" data-i="${i}"><div class="inp"><input name="uri" value="${esc(u.uri)}" placeholder="https://exemple.fr" inputmode="url" autocapitalize="off" spellcheck="false"><button type="button" class="ic-btn tap" data-uri-opt="${i}" aria-label="Détection">${icon('sliders-horizontal', 16)}</button><button type="button" class="ic-btn tap" data-del-uri="${i}" aria-label="Retirer">${icon('x', 16)}</button></div>${u.match ? `<small class="hint">Détection : ${esc(URI_MATCH.find(([k]) => k === u.match)?.[1] || u.match)}</small>` : ''}<input type="hidden" name="match" value="${esc(u.match || '')}"></div>`;
  const tagChip = (tg) => `<span class="chip tag">#${esc(tg)}<button type="button" data-del-tag="${esc(tg)}" aria-label="Retirer">${icon('x', 12)}</button></span>`;
  const customFieldHtml = (f, i) => `<div class="cf-row" data-i="${i}">
    <div class="inp"><input name="cf-name" value="${esc(f.name)}" placeholder="Nom du champ"></div>
    <div class="inp ${f.type === 'hidden' ? 'secret' : ''}">${f.type === 'bool' ? `<span class="cf-bool">${switchHtml('cf-value', f.value === 'true' || f.value === true)}</span>` : `<input name="cf-value" type="${f.type === 'hidden' ? 'password' : 'text'}" value="${esc(f.value)}" placeholder="Valeur">`}${f.type === 'hidden' ? `<button type="button" class="ic-btn" data-toggle-secret>${icon('eye', 16)}</button>` : ''}</div>
    <button type="button" class="ic-btn tap" data-cf-type="${i}" aria-label="Type">${icon(f.type === 'hidden' ? 'eye-off' : f.type === 'bool' ? 'toggle-right' : 'type', 16)}</button>
    <button type="button" class="ic-btn tap" data-del-cf="${i}" aria-label="Supprimer">${icon('trash-2', 16)}</button></div>`;
  const attHtml = (a) => `<div class="att-row"><span class="att-ic">${icon('file-text', 16)}</span><span class="grow"><b>${esc(a.name)}</b><small>${formatBytes(a.size)}</small></span><button type="button" class="ic-btn tap" data-del-att="${a.id}">${icon('trash-2', 16)}</button></div>`;

  // Lit le formulaire dans `it` (sans enregistrer).
  const read = () => {
    const form = ctx.el.querySelector('form');
    if (!form) return;
    it.name = form.name.value;
    for (const f of TYPES[it.type].fields) {
      const el = form.querySelector(`[name="d.${f.key}"]`);
      if (!el) continue;
      it.data[f.key] = f.kind === 'bool' ? el.checked : el.value;
    }
    if (it.type === 'login') {
      it.data.uris = [...form.querySelectorAll('.uri-row')].map((r) => ({ uri: r.querySelector('[name=uri]').value.trim(), match: r.querySelector('[name=match]').value })).filter((u) => u.uri);
    }
    if (it.type === 'card' && !it.data.brand) it.data.brand = cardBrand(it.data.number);
    const fid = form.folderId.value;
    if (fid !== '__new') it.folderId = fid || null;
    it.favorite = form.favorite.checked;
    it.reprompt = form.reprompt.checked;
    it.notes = form.notes.value;
    it.fields = [...form.querySelectorAll('.cf-row')].map((r, i) => {
      const prev = it.fields[i] || { type: 'text' };
      const valEl = r.querySelector('[name=cf-value]');
      return { name: r.querySelector('[name=cf-name]').value, value: prev.type === 'bool' ? String(valEl.checked) : valEl.value, type: prev.type };
    });
    dirty = JSON.stringify(it) !== original;
  };

  const renderTagSugg = () => {
    const box = ctx.el.querySelector('.tag-sugg');
    if (!box) return;
    const input = ctx.el.querySelector('.tag-input');
    const q = tagKey(input?.value || '');
    const have = new Set(it.tags.map(tagKey));
    const sugg = v.allTags().filter((t) => !have.has(tagKey(t.tag)) && (!q || tagKey(t.tag).includes(q))).slice(0, 8);
    box.innerHTML = sugg.map((t) => `<button type="button" class="chip tap ghost" data-add-tag="${esc(t.tag)}">#${esc(t.tag)}</button>`).join('');
  };

  const addTag = (raw) => {
    const t = cleanTag(raw);
    if (!t) { if (raw.trim()) toast('Étiquette invalide (virgule ou caractère interdit)', { icon: 'circle-alert', kind: 'error' }); return; }
    if (it.tags.length >= MAX_TAGS) return toast(`${MAX_TAGS} étiquettes au plus`, { icon: 'circle-alert', kind: 'error' });
    const before = it.tags.length;
    it.tags = normalizeTags([...it.tags, t]);
    if (it.tags.length === before) return;
    const list = ctx.el.querySelector('.tag-list');
    list.insertAdjacentHTML('beforeend', tagChip(it.tags[it.tags.length - 1]));
    fx.pop(list.lastElementChild, 1.3);
    renderTagSugg();
  };

  const save = async () => {
    read();
    if (!it.name.trim()) {
      const d = it.data;
      it.name = (d.uris && hostname(d.uris[0]?.uri)) || d.ssid || d.hostname || d.cardholderName || d.username || TYPES[it.type].label;
    }
    if (it.data.totp && !isValidTotp(it.data.totp)) {
      toast('La clé 2FA est invalide', { icon: 'circle-alert', kind: 'error' });
      fx.shake(ctx.el.querySelector('[name="d.totp"]').closest('.fld'));
      return;
    }
    try {
      const saved = await v.saveItem(it);
      haptic('success');
      const btn = ctx.el.querySelector('[type=submit]');
      if (btn) { const r = btn.getBoundingClientRect(); fx.burst(r.left + r.width / 2, r.top, { count: 16, spread: 120 }); }
      toast(isNew ? 'Élément créé' : 'Enregistré', { icon: 'check' });
      dirty = false;
      if (isNew) ctx.go(`#/item/${saved.id}`, { replace: true });
      else ctx.back();
    } catch (e) { toastError(e); }
  };

  draw();

  // ---- événements ----------------------------------------------------------------------
  ctx.el.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  ctx.el.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n?.startsWith('d.')) {
      const key = n.slice(2);
      const m = ctx.el.querySelector(`.strength[data-for="${key}"]`);
      if (m) updateStrength(m, e.target.value);
      if (key === 'totp') {
        const h = ctx.el.querySelector('.totp-hint');
        h.textContent = e.target.value ? (isValidTotp(e.target.value) ? '✓ Clé valide' : '⚠ Clé invalide') : '';
      }
      if (key === 'number') {
        const b = cardBrand(e.target.value);
        const sel = ctx.el.querySelector('[name="d.brand"]');
        if (b && sel && !sel.value) sel.value = b;
      }
      if (key === 'publicKey') fingerprintOf(e.target.value).then((fp) => { const f = ctx.el.querySelector('[name="d.fingerprint"]'); if (fp && f && !f.value) f.value = fp; });
    }
    if (e.target.classList.contains('tag-input')) {
      if (e.target.value.includes(',')) { e.target.value.split(',').forEach((x) => addTag(x)); e.target.value = ''; }
      renderTagSugg();
    }
    if (e.target.name === 'name') ctx.el.querySelector('.hero-mono').innerHTML = monogram({ ...it, name: e.target.value || TYPES[it.type].label }, 56);
  });
  ctx.el.addEventListener('keydown', (e) => {
    if (e.target.classList?.contains('tag-input') && e.key === 'Enter') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; }
    if (e.target.classList?.contains('tag-input') && e.key === 'Backspace' && !e.target.value && it.tags.length) { it.tags.pop(); ctx.el.querySelector('.tag-list').lastElementChild?.remove(); renderTagSugg(); }
  });
  ctx.el.addEventListener('change', async (e) => {
    if (e.target.name === 'folderId' && e.target.value === '__new') {
      const r = await prompt({ title: 'Nouveau dossier', fields: [{ name: 'n', label: 'Nom' }], ok: 'Créer' });
      if (r?.n?.trim()) {
        const f = await v.addFolder(r.n);
        e.target.insertAdjacentHTML('afterbegin', '');
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        e.target.insertBefore(opt, e.target.lastElementChild);
        e.target.value = f.id;
        it.folderId = f.id;
      } else e.target.value = it.folderId || '';
    }
  });

  on(ctx.el, 'click', '[data-type]', (e, b) => {
    read();
    const nt = b.dataset.type;
    if (nt === it.type) return;
    const keep = { name: it.name, notes: it.notes, tags: it.tags, folderId: it.folderId, favorite: it.favorite, fields: it.fields, attachments: it.attachments, reprompt: it.reprompt };
    it = { ...blankItem(nt), ...keep };
    ctx.header({ title: `Nouveau : ${TYPES[nt].label}`, back: !ctx.inAside, actions: `<button class="ic-btn tap accent" data-act="save" aria-label="Enregistrer">${icon('check')}</button>`, onAction: (a) => a === 'save' && save() });
    draw();
    haptic('select');
  });
  on(ctx.el, 'click', '[data-gen]', (e, b) => {
    const key = b.dataset.gen;
    openGeneratorSheet({
      mode: 'password',
      onUse: (val) => {
        const inp = ctx.el.querySelector(`[name="d.${key}"]`);
        inp.type = 'text';
        fx.scramble(inp, val);
        inp.value = val;
        updateStrength(ctx.el.querySelector(`.strength[data-for="${key}"]`), val);
        fx.pop(inp.closest('.inp'), 1.05);
      },
    });
  });
  on(ctx.el, 'click', '[data-gen-user]', (e, b) => {
    openGeneratorSheet({ mode: 'username', onUse: (val) => { const inp = ctx.el.querySelector(`[name="d.${b.dataset.genUser}"]`); inp.value = val; fx.pop(inp.closest('.inp'), 1.05); } });
  });
  on(ctx.el, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'cancel') return cancel();
    if (a === 'scan') {
      const txt = await scanQr({ title: 'QR code de double authentification' });
      if (!txt) return;
      let val = txt;
      if (/^otpauth-migration:/i.test(txt)) {
        const list = parseMigration(txt);
        if (!list.length) return toast('QR de transfert vide', { icon: 'circle-alert', kind: 'error' });
        val = list[0].totp;
        if (list.length > 1) toast(`${list.length} comptes dans ce QR : le premier est utilisé. Pour tout importer, passe par l'Authentificateur.`, { icon: 'info', ms: 4500 });
      }
      const cfg = parseTotp(val);
      if (!cfg || !isValidTotp(val)) return toast("Ce QR n'est pas une clé 2FA", { icon: 'circle-alert', kind: 'error' });
      const inp = ctx.el.querySelector('[name="d.totp"]');
      inp.value = val;
      ctx.el.querySelector('.totp-hint').textContent = `✓ ${cfg.issuer || 'Clé'}${cfg.account ? ` · ${cfg.account}` : ''}`;
      const nameInp = ctx.el.querySelector('[name=name]');
      if (!nameInp.value && cfg.issuer) nameInp.value = cfg.issuer;
      const userInp = ctx.el.querySelector('[name="d.username"]');
      if (userInp && !userInp.value && cfg.account) userInp.value = cfg.account;
      fx.pop(inp.closest('.inp'), 1.06);
    }
    if (a === 'adduri') {
      read();
      it.data.uris.push({ uri: '', match: '' });
      const box = ctx.el.querySelector('.uris');
      box.insertAdjacentHTML('beforeend', uriRow({ uri: '', match: '' }, box.children.length));
      fx.stagger([box.lastElementChild], { y: 10 });
      box.lastElementChild.querySelector('input').focus();
    }
    if (a === 'addfield') {
      const type = await menu([{ icon: 'type', label: 'Texte', value: 'text' }, { icon: 'eye-off', label: 'Masqué', value: 'hidden' }, { icon: 'toggle-right', label: 'Oui / Non', value: 'bool' }], { title: 'Type de champ' });
      if (!type) return;
      read();
      it.fields.push({ name: '', value: type === 'bool' ? 'false' : '', type });
      const box = ctx.el.querySelector('.cfields');
      box.insertAdjacentHTML('beforeend', customFieldHtml(it.fields[it.fields.length - 1], it.fields.length - 1));
      fx.stagger([box.lastElementChild], { y: 10 });
      box.lastElementChild.querySelector('input').focus();
    }
    if (a === 'addatt') {
      const f = await pickFile({ as: 'dataurl' });
      if (!f) return;
      if (f.size > MAX_ATTACHMENT) return toast('Fichier trop lourd (10 Mo max.)', { icon: 'circle-alert', kind: 'error' });
      const data = String(f.content).split(',')[1] || '';
      it.attachments.push({ id: uuid(), name: f.name, size: f.size, mime: f.type || 'application/octet-stream', data });
      const box = ctx.el.querySelector('.atts');
      box.insertAdjacentHTML('beforeend', attHtml(it.attachments[it.attachments.length - 1]));
      fx.pop(box.lastElementChild, 1.05);
    }
    if (a === 'sshgen') {
      if (!(await sshSupported())) return toast('Ed25519 indisponible sur ce WebView : mets à jour Android System WebView.', { icon: 'circle-alert', kind: 'error', ms: 4000 });
      const k = await generateEd25519((ctx.el.querySelector('[name=name]').value || 'haiku').replace(/\s+/g, '-'));
      for (const [key, val] of Object.entries(k)) { const el = ctx.el.querySelector(`[name="d.${key}"]`); if (el) { el.value = val; fx.pop(el, 1.03); } }
      toast('Paire de clés générée', { icon: 'key-round' });
    }
  });
  on(ctx.el, 'click', '[data-del-uri]', (e, b) => {
    const row = b.closest('.uri-row');
    gsap.to(row, { height: 0, opacity: 0, duration: fx.d(0.25) || 0.01, onComplete: () => row.remove() });
  });
  on(ctx.el, 'click', '[data-uri-opt]', async (e, b) => {
    const row = b.closest('.uri-row');
    const m = await menu(URI_MATCH.map(([k, l]) => ({ icon: row.querySelector('[name=match]').value === k ? 'circle-check' : 'link', label: l, value: k || 'default' })), { title: 'Détection de cette adresse' });
    if (m == null) return;
    row.querySelector('[name=match]').value = m === 'default' ? '' : m;
    let hint = row.querySelector('.hint');
    if (!hint) { row.insertAdjacentHTML('beforeend', '<small class="hint"></small>'); hint = row.querySelector('.hint'); }
    hint.textContent = m === 'default' ? '' : `Détection : ${URI_MATCH.find(([k]) => k === m)?.[1]}`;
  });
  on(ctx.el, 'click', '[data-del-tag]', (e, b) => {
    const k = tagKey(b.dataset.delTag);
    it.tags = it.tags.filter((t) => tagKey(t) !== k);
    const chip = b.closest('.chip');
    gsap.to(chip, { scale: 0, opacity: 0, duration: fx.d(0.25) || 0.01, onComplete: () => { chip.remove(); renderTagSugg(); } });
  });
  on(ctx.el, 'click', '[data-add-tag]', (e, b) => addTag(b.dataset.addTag));
  on(ctx.el, 'click', '[data-cf-type]', async (e, b) => {
    read();
    const i = +b.dataset.cfType;
    const type = await menu([{ icon: 'type', label: 'Texte', value: 'text' }, { icon: 'eye-off', label: 'Masqué', value: 'hidden' }, { icon: 'toggle-right', label: 'Oui / Non', value: 'bool' }], { title: 'Type de champ' });
    if (!type) return;
    it.fields[i].type = type;
    if (type === 'bool') it.fields[i].value = 'false';
    b.closest('.cf-row').outerHTML = customFieldHtml(it.fields[i], i);
  });
  on(ctx.el, 'click', '[data-del-cf]', (e, b) => {
    read();
    const i = +b.dataset.delCf;
    it.fields.splice(i, 1);
    ctx.el.querySelector('.cfields').innerHTML = it.fields.map((f, j) => customFieldHtml(f, j)).join('');
  });
  on(ctx.el, 'click', '[data-del-att]', (e, b) => {
    it.attachments = it.attachments.filter((a) => a.id !== b.dataset.delAtt);
    const row = b.closest('.att-row');
    gsap.to(row, { x: 60, opacity: 0, duration: fx.d(0.25) || 0.01, onComplete: () => row.remove() });
  });
  // Les clés privées SSH sont floutées tant que le champ n'a pas le focus.
  ctx.el.addEventListener('focusin', (e) => { if (e.target.matches?.('textarea.blurry')) e.target.classList.add('unblur'); });
  ctx.el.addEventListener('focusout', (e) => { if (e.target.matches?.('textarea.blurry')) e.target.classList.remove('unblur'); });

  const cancel = async () => {
    read();
    if (dirty && !(await confirm({ title: 'Abandonner les modifications ?', ok: 'Abandonner', danger: true }))) return;
    ctx.back();
  };

  return () => {};
}
