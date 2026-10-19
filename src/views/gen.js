// Générateur : mots de passe, phrases de passe, identifiants, PIN. Aussi utilisable en feuille
// depuis le formulaire d'un élément (bouton « dé »).

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, formatDateTime, debounce } from '../core/util.js';
import { prefs } from '../prefs.js';
import { generatePassword, generatePassphrase, generateUsername, generatePin } from '../core/generator.js';
import { loadDictionary, estimate, crackTime } from '../core/strength.js';
import { copy, sheet, segmented, bindSegmented, switchHtml, toast, confirm } from '../ui/components.js';
import { haptic } from '../platform.js';
import { session } from '../session.js';

const MODES = [['password', 'Aléatoire'], ['passphrase', 'Phrase'], ['username', 'Pseudo'], ['pin', 'PIN']];

function optionsHtml(mode) {
  const g = prefs.g;
  if (mode === 'password') {
    const o = g.password;
    return `<div class="opts">
      <label class="slider-row"><span>Longueur</span><b data-out="length">${o.length}</b><input type="range" name="length" min="5" max="128" value="${o.length}"></label>
      <div class="toggles">
        <label class="tgl tap ${o.upper ? 'on' : ''}"><input type="checkbox" name="upper" ${o.upper ? 'checked' : ''} hidden>A-Z</label>
        <label class="tgl tap ${o.lower ? 'on' : ''}"><input type="checkbox" name="lower" ${o.lower ? 'checked' : ''} hidden>a-z</label>
        <label class="tgl tap ${o.digits ? 'on' : ''}"><input type="checkbox" name="digits" ${o.digits ? 'checked' : ''} hidden>0-9</label>
        <label class="tgl tap ${o.symbols ? 'on' : ''}"><input type="checkbox" name="symbols" ${o.symbols ? 'checked' : ''} hidden>!@#$%</label>
      </div>
      <label class="slider-row"><span>Chiffres min.</span><b data-out="minDigits">${o.minDigits}</b><input type="range" name="minDigits" min="0" max="9" value="${o.minDigits}"></label>
      <label class="slider-row"><span>Symboles min.</span><b data-out="minSymbols">${o.minSymbols}</b><input type="range" name="minSymbols" min="0" max="9" value="${o.minSymbols}"></label>
      <label class="row-switch"><span>Éviter les caractères ambigus<small>I, l, 1, O, 0…</small></span>${switchHtml('avoidAmbiguous', o.avoidAmbiguous)}</label>
      <label class="fld"><span>Symboles autorisés (facultatif)</span><div class="inp"><input name="custom" value="${esc(o.custom || '')}" placeholder="!@#$%^&*()-_=+[]{};:,.?/~" spellcheck="false" autocapitalize="off"></div></label>
    </div>`;
  }
  if (mode === 'passphrase') {
    const o = g.passphrase;
    return `<div class="opts">
      <label class="slider-row"><span>Mots</span><b data-out="words">${o.words}</b><input type="range" name="words" min="3" max="20" value="${o.words}"></label>
      <label class="fld"><span>Séparateur</span><div class="inp"><input name="separator" value="${esc(o.separator)}" maxlength="3"></div></label>
      <label class="row-switch"><span>Majuscule à chaque mot</span>${switchHtml('capitalize', o.capitalize)}</label>
      <label class="row-switch"><span>Ajouter un chiffre</span>${switchHtml('number', o.number)}</label>
      ${segmented('lang', [['fr', 'Français'], ['en', 'English']], o.lang)}
    </div>`;
  }
  if (mode === 'username') {
    const o = g.username;
    return `<div class="opts">
      ${segmented('umode', [['word', 'Mots'], ['random', 'Aléatoire'], ['plus', 'E-mail +'], ['catchall', 'Catch-all']], o.mode)}
      <div class="u-word" ${o.mode === 'word' ? '' : 'hidden'}>
        <label class="row-switch"><span>Majuscule</span>${switchHtml('ucap', o.capitalize)}</label>
        <label class="row-switch"><span>Ajouter un nombre</span>${switchHtml('unum', o.number)}</label>
      </div>
      <label class="fld u-plus" ${o.mode === 'plus' ? '' : 'hidden'}><span>Ton adresse e-mail</span><div class="inp"><input name="email" type="email" value="${esc(o.email)}" placeholder="moi@gmail.com" autocapitalize="off"></div><small class="hint">Génère moi+xxxx@gmail.com : chaque site reçoit une adresse différente qui arrive dans ta boîte.</small></label>
      <label class="fld u-catch" ${o.mode === 'catchall' ? '' : 'hidden'}><span>Ton domaine</span><div class="inp"><input name="domain" value="${esc(o.domain)}" placeholder="mondomaine.fr" autocapitalize="off"></div><small class="hint">Pour un domaine qui accepte toutes les adresses (catch-all).</small></label>
    </div>`;
  }
  return `<div class="opts"><label class="slider-row"><span>Chiffres</span><b data-out="pinLength">${g.pinLength}</b><input type="range" name="pinLength" min="4" max="12" value="${g.pinLength}"></label></div>`;
}

/** Monte le générateur dans `root`. Renvoie { value() }. */
function mountGenerator(root, { onUse = null, compact = false } = {}) {
  let mode = prefs.g.mode || 'password';
  let current = null;
  root.innerHTML = `<div class="gen ${compact ? 'compact' : ''}">
    <div class="gen-mode">${segmented('mode', MODES, mode)}</div>
    <div class="gen-out glass" data-in>
      <code class="gen-val mono-font"></code>
      <div class="gen-meter"><div class="meter-bar"><i></i></div><div class="gen-info"><b class="gen-label"></b><small class="gen-bits"></small></div></div>
      <div class="gen-actions">
        <button class="btn ghost round tap" data-act="regen" aria-label="Régénérer">${icon('dices', 22)}</button>
        <button class="btn primary tap" data-act="${onUse ? 'use' : 'copy'}">${icon(onUse ? 'check' : 'copy', 18)}<span>${onUse ? 'Utiliser' : 'Copier'}</span></button>
        ${onUse ? `<button class="btn ghost round tap" data-act="copy" aria-label="Copier">${icon('copy', 20)}</button>` : ''}
      </div>
    </div>
    <div class="gen-opts"></div>
    ${compact ? '' : `<button class="btn ghost block tap" data-act="history">${icon('history', 18)}<span>Historique des valeurs générées</span></button>`}
  </div>`;
  const optsBox = root.querySelector('.gen-opts');
  const out = root.querySelector('.gen-val');

  const generate = async (animate = true) => {
    const g = prefs.g;
    try {
      if (mode === 'password') current = generatePassword(g.password);
      else if (mode === 'passphrase') current = await generatePassphrase(g.passphrase);
      else if (mode === 'username') current = await generateUsername(g.username);
      else current = generatePin(g.pinLength);
    } catch (e) {
      current = null;
      out.textContent = e.message;
      out.classList.add('err');
      return;
    }
    out.classList.remove('err');
    if (animate && fx.on) fx.scramble(out, current.value, { duration: Math.min(1, 0.35 + current.value.length * 0.012) }); else out.textContent = current.value;
    colorize(out, current.value, animate);
    const s = mode === 'username' ? null : estimate(current.value);
    const bits = mode === 'password' || mode === 'passphrase' || mode === 'pin' ? current.entropy : s?.bits || 0;
    const score = mode === 'username' ? 2 : bits >= 80 ? 4 : bits >= 60 ? 3 : bits >= 40 ? 2 : bits >= 28 ? 1 : 0;
    root.querySelector('.gen-meter').dataset.score = String(score);
    root.querySelector('.gen-label').textContent = mode === 'username' ? 'Identifiant' : ['Très faible', 'Faible', 'Moyen', 'Robuste', 'Très robuste'][score];
    root.querySelector('.gen-bits').textContent = mode === 'username' ? `${current.value.length} caractères` : `${Math.round(bits)} bits d'entropie · ${crackTime(bits)}`;
    gsap.to(root.querySelector('.meter-bar i'), { width: `${Math.min(100, (bits / 128) * 100)}%`, duration: fx.d(0.8) || 0.01, ease: 'elastic.out(1,0.6)' });
  };

  const optSeg = bindSegmented(optsBox, (name, val) => {
      if (name === 'lang') prefs.set('generator', { passphrase: { ...prefs.g.passphrase, lang: val } });
      if (name === 'umode') {
        prefs.set('generator', { username: { ...prefs.g.username, mode: val } });
        optsBox.querySelector('.u-word').hidden = val !== 'word';
        optsBox.querySelector('.u-plus').hidden = val !== 'plus';
        optsBox.querySelector('.u-catch').hidden = val !== 'catchall';
      }
      generate();
  });
  const renderOpts = () => {
    optsBox.innerHTML = optionsHtml(mode);
    optSeg.refresh();
    optsBox.querySelectorAll('input[type=range]').forEach((r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`));
    fx.stagger(optsBox.querySelectorAll('.opts > *'), { y: 12, each: 0.03 });
  };

  const readOpts = debounce(() => {
    const f = (n) => optsBox.querySelector(`[name=${n}]`);
    if (mode === 'password') {
      prefs.set('generator', { password: { ...prefs.g.password, length: +f('length').value, upper: f('upper').checked, lower: f('lower').checked, digits: f('digits').checked, symbols: f('symbols').checked, minDigits: +f('minDigits').value, minSymbols: +f('minSymbols').value, avoidAmbiguous: f('avoidAmbiguous').checked, custom: f('custom').value } });
    } else if (mode === 'passphrase') {
      prefs.set('generator', { passphrase: { ...prefs.g.passphrase, words: +f('words').value, separator: f('separator').value, capitalize: f('capitalize').checked, number: f('number').checked } });
    } else if (mode === 'username') {
      prefs.set('generator', { username: { ...prefs.g.username, capitalize: f('ucap').checked, number: f('unum').checked, email: f('email').value, domain: f('domain').value } });
    } else prefs.set('generator', { pinLength: +f('pinLength').value });
    generate();
  }, 60);

  optsBox.addEventListener('input', (e) => {
    const r = e.target.closest('input[type=range]');
    if (r) {
      optsBox.querySelector(`[data-out=${r.name}]`).textContent = r.value;
      r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
    }
    readOpts();
  });
  optsBox.addEventListener('change', (e) => {
    const t = e.target.closest('.tgl');
    if (t) {
      const boxes = optsBox.querySelectorAll('.tgl input');
      if (![...boxes].some((b) => b.checked)) { e.target.checked = true; fx.shake(t); return; }
      t.classList.toggle('on', e.target.checked);
      fx.pop(t, 1.15);
      haptic('select');
    }
    readOpts();
  });

  bindSegmented(root.querySelector('.gen-mode'), (name, val) => {
    if (name !== 'mode') return;
    mode = val;
    prefs.set('generator', { mode });
    renderOpts();
    generate();
  });

  on(root, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'regen') {
      haptic('light');
      if (fx.on) gsap.fromTo(b.querySelector('svg'), { rotation: 0 }, { rotation: fx.wild ? 720 : 360, duration: fx.d(0.7), ease: 'back.out(1.6)' });
      generate();
    }
    if (a === 'copy' && current) {
      await copy(current.value, { label: 'Copié', from: b });
      session.vault?.addGenerated(current.value, current.kind).catch(() => {});
    }
    if (a === 'use' && current) {
      session.vault?.addGenerated(current.value, current.kind).catch(() => {});
      onUse(current.value, mode);
    }
    if (a === 'history') showHistory();
  });

  renderOpts();
  generate(false);
  return { value: () => current?.value };
}

/** Colore chiffres et symboles comme Bitwarden (lisibilité). */
function colorize(out, value, animate) {
  const apply = () => {
    out.innerHTML = [...value].map((c) => `<span class="${/\d/.test(c) ? 'd' : /[^\p{L}\d]/u.test(c) ? 's' : ''}">${esc(c)}</span>`).join('');
  };
  if (animate && fx.on) setTimeout(apply, fx.d(Math.min(1, 0.35 + value.length * 0.012)) * 1000 + 30);
  else apply();
}

function showHistory() {
  const v = session.vault;
  const list = v?.data.genHistory || [];
  const s = sheet({
    title: 'Historique du générateur',
    body: list.length ? `<div class="mini-list">${list.map((g, i) => `<div class="frow"><div class="fmain"><small>${formatDateTime(g.date)}</small><span class="fval mono-font">${esc(g.value)}</span></div><button class="ic-btn tap" data-i="${i}">${icon('copy', 18)}</button></div>`).join('')}</div>` : '<p class="muted">Rien pour l\'instant. Les valeurs copiées ou utilisées sont gardées ici, chiffrées dans le coffre.</p>',
    actions: list.length ? `<button class="btn ghost danger-txt tap" data-clear>${icon('trash-2', 16)}<span>Effacer</span></button>` : '',
  });
  on(s.el, 'click', '[data-i]', (e, b) => copy(list[+b.dataset.i].value, { label: 'Copié', from: b }));
  s.el.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (await confirm({ title: 'Effacer l\'historique du générateur ?', ok: 'Effacer', danger: true })) { await v.clearGenHistory(); s.close(); toast('Historique effacé'); }
  });
}

export async function render(ctx) {
  await loadDictionary();
  ctx.header({ title: 'Générateur', subtitle: 'Hasard cryptographique', actions: '' });
  mountGenerator(ctx.el);
}

/** Feuille « générateur » pour remplir un champ. */
export function openGeneratorSheet({ mode, onUse }) {
  if (mode) prefs.set('generator', { mode });
  const s = sheet({ title: 'Générer', body: '<div></div>' });
  loadDictionary().then(() => mountGenerator(s.body.firstElementChild, { compact: true, onUse: (val, m) => { onUse(val, m); s.close(); } }));
  return s;
}
