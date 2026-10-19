// Studio : tout ce qui se voit est réglable, en direct.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc } from '../core/util.js';
import { prefs, SKINS, FONTS, BACKGROUNDS, TRANSITIONS, DEFAULTS } from '../prefs.js';
import { applyTheme } from '../ui/theme.js';
import { segmented, bindSegmented, switchHtml, copy, prompt, toast, confirm, monogram } from '../ui/components.js';
import { haptic } from '../platform.js';

const SWATCHES = ['#a78bfa', '#c084fc', '#f472b6', '#fb7185', '#f87171', '#fb923c', '#fbbf24', '#facc15', '#a3e635', '#4ade80', '#2dd4bf', '#22d3ee', '#38bdf8', '#60a5fa', '#818cf8', '#e8e4da', '#f5f5f5'];

export async function render(ctx) {
  ctx.header({ title: 'Studio', subtitle: 'Personnalisation', actions: `<button class="ic-btn tap" data-act="io" aria-label="Partager le thème">${icon('share-2')}</button>`, onAction: () => themeIO() });

  const set = (patch, { pulse = null } = {}) => {
    prefs.set('appearance', patch);
    applyTheme();
    haptic('select');
    if (pulse) fx.pop(pulse, 1.08);
    const prev = ctx.el.querySelector('.preview');
    if (prev && fx.on) gsap.fromTo(prev, { scale: 0.97 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.5)' });
  };

  const draw = () => {
    const a = prefs.a;
    const sample = { id: 'demo', type: 'login', name: 'Haïku', data: { username: 'moi@haiku.app' } };
    ctx.el.innerHTML = `
      <section class="preview glass" data-in>
        <div class="pv-row">${monogram(sample, 46)}<span><b>Aperçu en direct</b><small>Chaque réglage s'applique tout de suite</small></span><span class="pv-badge">${icon('star', 14, 'filled')}</span></div>
        <div class="pv-pw mono-font">Ki7#mp-Sakura-<span class="d">42</span></div>
        <div class="row gap"><button class="btn primary tap">${icon('copy', 16)}<span>Bouton</span></button><button class="btn ghost tap">Secondaire</button><span class="chip on">Puce</span></div>
      </section>

      <h3 class="section-h" data-in>Thèmes</h3>
      <div class="skins" data-in>${Object.entries(SKINS).map(([k, s]) => `<button class="skin tap ${a.skin === k ? 'on' : ''}" data-skin="${k}" style="--s1:${s.accent};--s2:${s.accent2}"><span class="skin-sw ${s.mode}"><i></i><i></i></span><small>${esc(s.name)}</small></button>`).join('')}</div>

      <section class="set-group glass" data-in><h3>${icon('contrast', 16)}Mode</h3>
        ${segmented('mode', [['dark', 'Sombre'], ['amoled', 'AMOLED'], ['light', 'Clair'], ['glass', 'Verre']], a.mode)}
      </section>

      <section class="set-group glass" data-in><h3>${icon('palette', 16)}Couleurs</h3>
        <div class="color-pick"><small>Accent</small><div class="sw-row">${SWATCHES.map((c) => `<button class="sw tap ${a.accent === c ? 'on' : ''}" data-accent="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}<label class="sw custom tap" style="--c:${a.accent}">${icon('plus', 14)}<input type="color" name="accent" value="${a.accent}"></label></div></div>
        <div class="color-pick"><small>Second accent (dégradés)</small><div class="sw-row">${SWATCHES.map((c) => `<button class="sw tap ${a.accent2 === c ? 'on' : ''}" data-accent2="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}<label class="sw custom tap" style="--c:${a.accent2}">${icon('plus', 14)}<input type="color" name="accent2" value="${a.accent2}"></label></div></div>
        <button class="btn ghost small tap" data-act="random">${icon('shuffle', 16)}<span>Harmonie au hasard</span></button>
      </section>

      <section class="set-group glass" data-in><h3>${icon('waves', 16)}Fond animé</h3>
        <div class="bg-grid">${Object.entries(BACKGROUNDS).map(([k, l]) => `<button class="bg-opt tap ${a.bg === k ? 'on' : ''}" data-bg="${k}"><span class="bg-prev bgp-${k}"></span><small>${esc(l)}</small></button>`).join('')}</div>
        <label class="slider-row"><span>Intensité</span><b data-out="bgIntensity">${Math.round(a.bgIntensity * 100)}%</b><input type="range" name="bgIntensity" min="0.1" max="1" step="0.05" value="${a.bgIntensity}"></label>
        <label class="row-switch"><span>Grain de papier</span>${switchHtml('grain', a.grain)}</label>
        <label class="row-switch"><span>Halo lumineux</span>${switchHtml('glow', a.glow)}</label>
      </section>

      <section class="set-group glass" data-in><h3>${icon('type', 16)}Typographie</h3>
        <small class="muted">Texte</small>
        <div class="font-grid">${Object.entries(FONTS).filter(([k]) => k !== 'shippori').map(([k, l]) => `<button class="font-opt tap ${a.font === k ? 'on' : ''}" data-font="${k}" style="font-family:${k === 'system' ? 'system-ui' : `'${l}'`}"><b>Aa</b><small>${esc(l)}</small></button>`).join('')}</div>
        <small class="muted">Titres</small>
        <div class="font-grid">${Object.entries(FONTS).filter(([k]) => k !== 'system').map(([k, l]) => `<button class="font-opt tap ${a.display === k ? 'on' : ''}" data-display="${k}" style="font-family:'${l}'"><b>Haïku</b><small>${esc(l)}</small></button>`).join('')}</div>
      </section>

      <section class="set-group glass" data-in><h3>${icon('layout-grid', 16)}Formes et densité</h3>
        <label class="slider-row"><span>Arrondis</span><b data-out="radius">${a.radius}px</b><input type="range" name="radius" min="0" max="32" value="${a.radius}"></label>
        <label class="slider-row"><span>Flou du verre</span><b data-out="blur">${a.blur}px</b><input type="range" name="blur" min="0" max="40" value="${a.blur}"></label>
        ${segmented('density', [['comfortable', 'Aéré'], ['compact', 'Compact']], a.density)}
        <small class="muted">Liste du coffre</small>
        ${segmented('listStyle', [['cards', 'Cartes'], ['rows', 'Lignes'], ['grid', 'Grille']], a.listStyle)}
        <small class="muted">Icônes des éléments</small>
        ${segmented('iconStyle', [['monogram', 'Initiales'], ['type', 'Pictogrammes']], a.iconStyle)}
        <label class="row-switch"><span>Libellés de la barre d'onglets</span>${switchHtml('tabLabels', a.tabLabels)}</label>
      </section>

      <section class="set-group glass" data-in><h3>${icon('sparkles', 16)}Animations</h3>
        ${segmented('motion', [['0', 'Aucune'], ['1', 'Douces'], ['2', 'Normales'], ['3', 'De fou']], String(a.motion))}
        <small class="muted">Transition entre les pages</small>
        <div class="chips wrap">${Object.entries(TRANSITIONS).map(([k, l]) => `<button class="chip tap ${a.transition === k ? 'on' : ''}" data-transition="${k}">${esc(l)}</button>`).join('')}</div>
        <label class="row-switch"><span>Inclinaison 3D au toucher</span>${switchHtml('tilt', a.tilt)}</label>
        <label class="row-switch"><span>Vibrations</span>${switchHtml('haptics', a.haptics)}</label>
        <label class="row-switch"><span>Introduction au lancement</span>${switchHtml('intro', a.intro)}</label>
        <button class="btn ghost small tap" data-act="demo">${icon('wand-sparkles', 16)}<span>Tester les effets</span></button>
      </section>

      <section class="set-group glass" data-in><h3>${icon('lock', 16)}Écran de verrouillage</h3>
        ${segmented('lockArt', [['enso', 'Ensō'], ['haiku', 'Haïku'], ['minimal', 'Minimal']], a.lockArt)}
      </section>

      <button class="btn ghost block tap danger-txt" data-act="reset" data-in>${icon('rotate-ccw', 16)}<span>Tout réinitialiser</span></button>`;
    segs.refresh();
    ctx.el.querySelectorAll('input[type=range]').forEach(paintRange);
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.035 });
  };

  const segs = bindSegmented(ctx.el, (name, val, btn) => {
    if (name === 'motion') return set({ motion: +val }, { pulse: btn });
    set({ [name]: val }, { pulse: btn });
  });
  const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);

  draw();

  on(ctx.el, 'click', '[data-skin]', (e, b) => {
    const s = SKINS[b.dataset.skin];
    set({ skin: b.dataset.skin, accent: s.accent, accent2: s.accent2, mode: s.mode, bg: s.bg, font: s.font, display: s.display });
    const r = b.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 16, colors: [s.accent, s.accent2, '#fff'] });
    draw();
  });
  on(ctx.el, 'click', '[data-accent]', (e, b) => { set({ accent: b.dataset.accent, skin: 'custom' }, { pulse: b }); ctx.el.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(ctx.el, 'click', '[data-accent2]', (e, b) => { set({ accent2: b.dataset.accent2, skin: 'custom' }, { pulse: b }); ctx.el.querySelectorAll('[data-accent2]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(ctx.el, 'click', '[data-bg]', (e, b) => { set({ bg: b.dataset.bg }, { pulse: b }); ctx.el.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(ctx.el, 'click', '[data-font]', (e, b) => { set({ font: b.dataset.font }, { pulse: b }); ctx.el.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(ctx.el, 'click', '[data-display]', (e, b) => { set({ display: b.dataset.display }, { pulse: b }); ctx.el.querySelectorAll('[data-display]').forEach((x) => x.classList.toggle('on', x === b)); fx.splitIn(document.querySelector('#top h1'), { each: 0.04 }); });
  on(ctx.el, 'click', '[data-transition]', (e, b) => { set({ transition: b.dataset.transition }, { pulse: b }); ctx.el.querySelectorAll('[data-transition]').forEach((x) => x.classList.toggle('on', x === b)); });
  ctx.el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.type === 'range') {
      paintRange(t);
      const v = +t.value;
      ctx.el.querySelector(`[data-out=${t.name}]`).textContent = t.name === 'bgIntensity' ? `${Math.round(v * 100)}%` : `${v}px`;
      prefs.set('appearance', { [t.name]: v });
      applyTheme();
    }
    if (t.type === 'color') { t.parentElement.style.setProperty('--c', t.value); set({ [t.name]: t.value, skin: 'custom' }); }
  });
  ctx.el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox') set({ [t.name]: t.checked }, { pulse: t.closest('.row-switch') });
  });
  on(ctx.el, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'random') {
      const h = Math.floor(Math.random() * 360);
      const h2 = (h + 40 + Math.floor(Math.random() * 120)) % 360;
      const toHex = (hh, s, l) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = `hsl(${hh} ${s}% ${l}%)`; return c.fillStyle; };
      set({ accent: toHex(h, 85, 72), accent2: toHex(h2, 85, 68), skin: 'custom' });
      draw();
      fx.confetti();
    }
    if (a === 'demo') {
      const r = b.getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top, { count: 24 });
      fx.confetti();
      fx.glitch(document.querySelector('#top h1'));
      fx.stagger(ctx.el.querySelectorAll('.set-group'), { each: 0.05, y: 40 });
    }
    if (a === 'reset' && (await confirm({ title: 'Réinitialiser l\'apparence ?', ok: 'Réinitialiser', danger: true }))) {
      prefs.reset('appearance');
      applyTheme();
      draw();
    }
  });

  async function themeIO() {
    const { menu } = await import('../ui/components.js');
    const c = await menu([{ icon: 'copy', label: 'Copier mon thème', hint: 'Code à partager (aucune donnée du coffre)', value: 'copy' }, { icon: 'download', label: 'Coller un thème', value: 'paste' }], { title: 'Partager le thème' });
    if (c === 'copy') copy(`haiku-theme:${btoa(unescape(encodeURIComponent(JSON.stringify(prefs.a))))}`, { label: 'Thème copié', sensitive: false });
    if (c === 'paste') {
      const r = await prompt({ title: 'Coller un thème', fields: [{ name: 't', label: 'Code du thème', placeholder: 'haiku-theme:…' }], ok: 'Appliquer', validate: ({ t }) => { const j = JSON.parse(decodeURIComponent(escape(atob(t.replace(/^haiku-theme:/, '').trim())))); if (!j || typeof j !== 'object') throw new Error('Code invalide.'); } });
      if (r) {
        const j = JSON.parse(decodeURIComponent(escape(atob(r.t.replace(/^haiku-theme:/, '').trim()))));
        const clean = Object.fromEntries(Object.entries(j).filter(([k, val]) => k in DEFAULTS.appearance && typeof val === typeof DEFAULTS.appearance[k]));
        prefs.set('appearance', clean);
        applyTheme();
        draw();
        fx.confetti();
        toast('Thème appliqué', { icon: 'palette' });
      }
    }
  }
}
