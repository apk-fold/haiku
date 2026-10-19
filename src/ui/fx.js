// Effets GSAP. Tout passe par ici pour que le réglage « intensité des animations »
// (0 aucune · 1 douce · 2 normale · 3 de fou) s'applique partout.

import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { Draggable } from 'gsap/Draggable';
import { InertiaPlugin } from 'gsap/InertiaPlugin';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { Physics2DPlugin } from 'gsap/Physics2DPlugin';
import { CustomEase } from 'gsap/CustomEase';
import { Observer } from 'gsap/Observer';

gsap.registerPlugin(Flip, Draggable, InertiaPlugin, ScrambleTextPlugin, SplitText, DrawSVGPlugin, MorphSVGPlugin, Physics2DPlugin, CustomEase, Observer);

CustomEase.create('haiku', 'M0,0 C0.16,1 0.3,1 1,1');
CustomEase.create('brush', 'M0,0 C0.5,0 0.1,1 1,1');
CustomEase.create('snap', 'M0,0 C0.2,0 0,1.25 0.55,1.04 0.75,0.95 1,1 1,1');

export { gsap, Flip, Draggable, InertiaPlugin, SplitText, Observer };

const SPEED = [0, 0.55, 1, 1.25];

export const fx = {
  level: 2,
  get on() { return this.level > 0; },
  get wild() { return this.level >= 3; },
  d(s) { return this.level ? s * SPEED[this.level] : 0; },

  setLevel(l) {
    this.level = Math.max(0, Math.min(3, l | 0));
    gsap.globalTimeline.timeScale(1);
    document.documentElement.dataset.motion = String(this.level);
  },

  // ---- pages ------------------------------------------------------------------------

  pageOut(el, style, dir = 1) {
    if (!this.on || style === 'none' || !el) return Promise.resolve();
    const d = this.d(0.22);
    const v = {
      slide: { x: -40 * dir, opacity: 0 },
      zoom: { scale: 0.94, opacity: 0, filter: 'blur(6px)' },
      flip: { rotationY: -25 * dir, opacity: 0, transformOrigin: dir > 0 ? '0% 50%' : '100% 50%', transformPerspective: 900 },
      curtain: { clipPath: 'inset(0% 0% 100% 0%)', opacity: 0.6 },
      blur: { opacity: 0, filter: 'blur(14px)', scale: 1.02 },
    }[style] || { opacity: 0 };
    return gsap.to(el, { ...v, duration: d, ease: 'power2.in' }).then();
  },

  pageIn(el, style, dir = 1) {
    if (!el) return;
    gsap.set(el, { clearProps: 'all' });
    if (!this.on || style === 'none') return;
    const d = this.d(0.55);
    const from = {
      slide: { x: 48 * dir, opacity: 0 },
      zoom: { scale: 1.06, opacity: 0, filter: 'blur(8px)' },
      flip: { rotationY: 28 * dir, opacity: 0, transformOrigin: dir > 0 ? '100% 50%' : '0% 50%', transformPerspective: 900 },
      curtain: { clipPath: 'inset(100% 0% 0% 0%)' },
      blur: { opacity: 0, filter: 'blur(16px)', scale: 0.98 },
    }[style] || { opacity: 0 };
    gsap.from(el, { ...from, duration: d, ease: 'haiku', clearProps: 'transform,filter,clipPath,opacity' });
    this.stagger(el.querySelectorAll('[data-in]'), { delay: this.d(0.06) });
  },

  /** Entrée en cascade des éléments marqués. */
  stagger(els, { delay = 0, y = 22, each = 0.045, from = 'start' } = {}) {
    const list = Array.from(els || []);
    if (!list.length) return;
    if (!this.on) return gsap.set(list, { clearProps: 'all' });
    gsap.fromTo(list, { y: this.wild ? y * 1.6 : y, opacity: 0, scale: this.wild ? 0.92 : 0.98, rotationX: this.wild ? -12 : 0, transformPerspective: 800 }, {
      y: 0, opacity: 1, scale: 1, rotationX: 0, duration: this.d(0.6), delay, ease: 'haiku',
      stagger: { each: this.d(each), from }, clearProps: 'transform,opacity',
    });
  },

  // ---- micro-interactions ------------------------------------------------------------

  press(el) {
    if (!this.on || !el) return;
    gsap.fromTo(el, { scale: 0.94 }, { scale: 1, duration: this.d(0.5), ease: 'elastic.out(1.1,0.45)', overwrite: 'auto', clearProps: 'scale' });
  },

  pop(el, s = 1.18) {
    if (!this.on || !el) return;
    gsap.fromTo(el, { scale: s }, { scale: 1, duration: this.d(0.6), ease: 'elastic.out(1,0.4)', clearProps: 'scale' });
  },

  shake(el) {
    if (!el) return;
    gsap.fromTo(el, { x: 0 }, { keyframes: { x: [0, -12, 10, -8, 6, -3, 0] }, duration: this.on ? 0.5 : 0.01, ease: 'power1.inOut' });
  },

  /** Onde à l'endroit du toucher. */
  ripple(e, el) {
    if (!this.on || !el) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX ?? r.left + r.width / 2) - r.left - size / 2}px;top:${(e.clientY ?? r.top + r.height / 2) - r.top - size / 2}px`;
    el.appendChild(dot);
    gsap.fromTo(dot, { scale: 0, opacity: 0.35 }, { scale: 1, opacity: 0, duration: this.d(0.7), ease: 'power2.out', onComplete: () => dot.remove() });
  },

  /** Révélation d'un secret façon « décryptage ». */
  scramble(el, text, { chars = 'upperAndLowerCase', duration = 0.7 } = {}) {
    if (!el) return;
    if (!this.on) { el.textContent = text; return; }
    gsap.to(el, { duration: this.d(duration), scrambleText: { text, chars: this.wild ? '█▓▒░<>/\\|{}[]#%&*@$01' : chars, revealDelay: 0.15, speed: 0.8 }, ease: 'none' });
  },

  countUp(el, to, { duration = 1.2, suffix = '' } = {}) {
    if (!el) return;
    const o = { v: 0 };
    if (!this.on) { el.textContent = `${Math.round(to)}${suffix}`; return; }
    gsap.to(o, { v: to, duration: this.d(duration), ease: 'power3.out', onUpdate: () => { el.textContent = `${Math.round(o.v)}${suffix}`; } });
  },

  /** Jauge circulaire (cercle SVG de rayon r) : progress 0..1. */
  ring(circle, progress, { duration = 1.2, delay = 0 } = {}) {
    if (!circle) return;
    const r = Number(circle.getAttribute('r'));
    const c = 2 * Math.PI * r;
    circle.style.strokeDasharray = `${c}`;
    const target = c * (1 - progress);
    if (!this.on) { circle.style.strokeDashoffset = `${target}`; return; }
    gsap.fromTo(circle, { strokeDashoffset: c }, { strokeDashoffset: target, duration: this.d(duration), delay, ease: 'power3.out' });
  },

  /** Gerbe de particules (copie, succès…). Utilise Physics2D. */
  burst(x, y, { count = 14, colors, spread = 360, velocity = [220, 520], gravity = 900, size = [4, 9], shapes = ['dot', 'petal'] } = {}) {
    if (!this.on) return;
    const n = Math.round(count * (this.wild ? 2.2 : this.level === 1 ? 0.5 : 1));
    const layer = document.getElementById('fx-layer');
    if (!layer) return;
    const cs = colors || [getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa', getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#f472b6', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      const s = gsap.utils.random(size[0], size[1]);
      const shape = shapes[i % shapes.length];
      p.className = `particle ${shape}`;
      p.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${shape === 'petal' ? s * 1.6 : s}px;background:${cs[i % cs.length]}`;
      layer.appendChild(p);
      const angle = spread >= 360 ? gsap.utils.random(0, 360) : gsap.utils.random(-90 - spread / 2, -90 + spread / 2);
      gsap.to(p, {
        duration: this.d(gsap.utils.random(0.9, 1.6)),
        physics2D: { velocity: gsap.utils.random(velocity[0], velocity[1]), angle, gravity },
        rotation: gsap.utils.random(-540, 540),
        opacity: 0,
        ease: 'none',
        onComplete: () => p.remove(),
      });
    }
  },

  confetti() {
    if (!this.on) return;
    const w = window.innerWidth;
    this.burst(w * 0.25, window.innerHeight * 0.95, { count: 26, spread: 70, velocity: [700, 1100], gravity: 1100, shapes: ['petal', 'dot', 'bar'] });
    this.burst(w * 0.75, window.innerHeight * 0.95, { count: 26, spread: 70, velocity: [700, 1100], gravity: 1100, shapes: ['petal', 'dot', 'bar'] });
  },

  /** Inclinaison 3D qui suit le doigt. */
  tilt(el, max = 10) {
    if (!el || !this.on) return;
    const qx = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
    const qy = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
    gsap.set(el, { transformPerspective: 700 });
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      qx(px * max * (this.wild ? 1.8 : 1));
      qy(-py * max * (this.wild ? 1.8 : 1));
      el.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
      el.style.setProperty('--my', `${(py + 0.5) * 100}%`);
    };
    const leave = () => { qx(0); qy(0); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerup', leave);
  },

  /** Texte qui apparaît lettre par lettre (SplitText). */
  splitIn(el, { type = 'chars', delay = 0, each = 0.03, y = '0.6em' } = {}) {
    if (!el) return null;
    if (!this.on) return null;
    const split = new SplitText(el, { type: type === 'chars' ? 'chars,words' : type, mask: type === 'lines' ? 'lines' : undefined });
    const targets = type === 'chars' ? split.chars : type === 'words' ? split.words : split.lines;
    return gsap.from(targets, {
      y, opacity: 0, rotationX: this.wild ? -90 : 0, filter: 'blur(6px)', transformOrigin: '50% 100%',
      duration: this.d(0.8), delay, ease: 'haiku', stagger: this.d(each),
      onComplete: () => split.revert(),
    });
  },

  /** Tracé d'un SVG (DrawSVG). */
  draw(paths, { duration = 1.2, delay = 0, each = 0.15 } = {}) {
    if (!paths) return;
    if (!this.on) return gsap.set(paths, { drawSVG: '100%' });
    return gsap.fromTo(paths, { drawSVG: '0%' }, { drawSVG: '100%', duration: this.d(duration), delay, ease: 'brush', stagger: this.d(each) });
  },

  /** Indicateur de la barre d'onglets qui glisse de façon élastique. */
  slideIndicator(ind, target, vertical = false) {
    if (!ind || !target) return;
    const r = target.getBoundingClientRect();
    const p = ind.parentElement.getBoundingClientRect();
    const props = vertical
      ? { y: r.top - p.top, height: r.height, x: 0, width: ind.offsetWidth || 4 }
      : { x: r.left - p.left + r.width / 2 - 22, width: 44, y: 0 };
    if (!this.on || !ind.dataset.ready) {
      gsap.set(ind, props);
      ind.dataset.ready = '1';
      return;
    }
    gsap.to(ind, { ...props, duration: this.d(0.7), ease: this.wild ? 'elastic.out(1,0.5)' : 'elastic.out(1,0.75)' });
    if (this.level >= 2) gsap.fromTo(ind, { scaleX: 1.6 }, { scaleX: 1, duration: this.d(0.6), ease: 'power3.out' });
  },

  /** Animation Flip entre deux états de mise en page. */
  flip(state, targets, opts = {}) {
    if (!this.on || !state) return;
    Flip.from(state, { targets, duration: this.d(0.55), ease: 'haiku', absolute: false, nested: true, prune: true, onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: this.d(0.4) }), onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.9, duration: this.d(0.25) }), ...opts });
  },

  glitch(el) {
    if (!this.on || !el) return;
    const tl = gsap.timeline();
    tl.to(el, { x: -3, skewX: 8, filter: 'hue-rotate(90deg)', duration: 0.05 })
      .to(el, { x: 4, skewX: -6, duration: 0.05 })
      .to(el, { x: -2, skewX: 3, filter: 'hue-rotate(-60deg)', duration: 0.05 })
      .to(el, { x: 0, skewX: 0, filter: 'none', duration: 0.08, clearProps: 'filter,transform' });
    return tl;
  },
};

// Respecte « réduire les animations » du système par défaut.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) fx.level = 1;
