// Fonds animés : aurore (taches GSAP), constellation, encre sumi-e, pétales de sakura,
// grille rétro, ondes, pluie de code. Un seul canvas, mis en pause quand l'appli est cachée.

import { gsap } from './fx.js';

let canvas;
let ctx;
let raf = 0;
let kind = 'none';
let intensity = 0.7;
let W = 0;
let H = 0;
let DPR = 1;
let state = null;
let blobTweens = [];
const pointer = { x: -9999, y: -9999, active: false };

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => {
  try { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; } catch { return `rgba(167,139,250,${a})`; }
};

export function initBackground(root) {
  canvas = root.querySelector('#bg-canvas');
  ctx = canvas.getContext('2d');
  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 1.6);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (kind !== 'none') setup();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    if (kind === 'ink' && state) state.drops.push(newDrop(e.clientX, e.clientY, true));
  }, { passive: true });
  window.addEventListener('pointerup', () => { pointer.active = false; }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
}

export function setBackground(k, inten = 0.7) {
  kind = k || 'none';
  intensity = inten;
  document.documentElement.dataset.bg = kind;
  animateBlobs(kind === 'aurora' || kind === 'particles' || kind === 'waves');
  setup();
  start();
}

function animateBlobs(on) {
  blobTweens.forEach((t) => t.kill());
  blobTweens = [];
  const blobs = document.querySelectorAll('#bg .blob');
  if (!on) return;
  blobs.forEach((b, i) => {
    blobTweens.push(gsap.to(b, {
      x: () => gsap.utils.random(-W * 0.3, W * 0.3),
      y: () => gsap.utils.random(-H * 0.25, H * 0.25),
      scale: () => gsap.utils.random(0.8, 1.4),
      duration: gsap.utils.random(9, 16),
      ease: 'sine.inOut',
      repeat: -1,
      repeatRefresh: true,
      yoyo: true,
      delay: i * 0.7,
    }));
  });
}

function start() {
  if (raf || kind === 'none' || kind === 'aurora' || !canvas) return;
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    draw(dt, t / 1000);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function newDrop(x, y, big = false) {
  return { x, y, r: 0, max: (big ? 90 : 30) + Math.random() * (big ? 140 : 90), a: big ? 0.22 : 0.12, speed: 18 + Math.random() * 30 };
}

function setup() {
  stop();
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  const n = (base) => Math.round(base * (0.35 + intensity));
  switch (kind) {
    case 'particles':
      state = { pts: Array.from({ length: n(55) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.5) * 18, r: 0.6 + Math.random() * 1.8 })) };
      break;
    case 'sakura':
      state = { petals: Array.from({ length: n(28) }, () => petal(true)) };
      break;
    case 'ink':
      state = { drops: Array.from({ length: 4 }, () => newDrop(Math.random() * W, Math.random() * H)), t: 0 };
      break;
    case 'grid':
      state = { off: 0 };
      break;
    case 'waves':
      state = { t: 0 };
      break;
    case 'rain': {
      const size = 16;
      state = { size, cols: Array.from({ length: Math.ceil(W / size) }, () => Math.random() * -H / size), acc: 0 };
      break;
    }
    default:
      state = null;
  }
  start();
}

function petal(initial = false) {
  return { x: Math.random() * W, y: initial ? Math.random() * H : -20, s: 6 + Math.random() * 9, vy: 20 + Math.random() * 40, sway: Math.random() * Math.PI * 2, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 2 };
}

function draw(dt, t) {
  if (!state) return;
  const accent = css('--accent') || '#a78bfa';
  const accent2 = css('--accent-2') || '#f472b6';
  const light = document.documentElement.dataset.mode === 'light';
  switch (kind) {
    case 'particles': {
      ctx.clearRect(0, 0, W, H);
      const pts = state.pts;
      for (const p of pts) {
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 140 && d > 0.1) { p.vx += (dx / d) * 120 * dt; p.vy += (dy / d) * 120 * dt; }
        }
        p.vx *= 0.995; p.vy *= 0.995;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120) {
            ctx.strokeStyle = rgba(i % 2 ? accent : accent2, (1 - d / 120) * 0.35 * intensity);
            ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = rgba(accent, 0.8 * intensity);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'sakura': {
      ctx.clearRect(0, 0, W, H);
      for (const p of state.petals) {
        p.sway += dt * 1.4;
        p.y += p.vy * dt;
        p.x += Math.sin(p.sway) * 30 * dt + 12 * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 20 || p.x > W + 20) Object.assign(p, petal());
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.sin(p.sway)) * 0.5 + 0.5);
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, p.s);
        g.addColorStop(0, rgba(accent, 0.85 * intensity));
        g.addColorStop(1, rgba(accent2, 0.15 * intensity));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -p.s);
        ctx.bezierCurveTo(p.s * 0.9, -p.s * 0.6, p.s * 0.7, p.s * 0.6, 0, p.s);
        ctx.bezierCurveTo(-p.s * 0.7, p.s * 0.6, -p.s * 0.9, -p.s * 0.6, 0, -p.s);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'ink': {
      // Encre qui se diffuse lentement (les touchers déposent une goutte).
      ctx.fillStyle = light ? 'rgba(250,248,244,0.02)' : 'rgba(5,4,8,0.02)';
      ctx.fillRect(0, 0, W, H);
      state.t += dt;
      if (state.t > 2.4 / (0.4 + intensity)) { state.t = 0; state.drops.push(newDrop(Math.random() * W, Math.random() * H)); }
      state.drops = state.drops.filter((d) => d.r < d.max);
      for (const d of state.drops) {
        d.r += d.speed * dt * (1 - d.r / d.max) + 1 * dt;
        const g = ctx.createRadialGradient(d.x, d.y, d.r * 0.2, d.x, d.y, d.r);
        const base = light ? '#1a1a1a' : accent;
        g.addColorStop(0, rgba(base, d.a * intensity * (1 - d.r / d.max)));
        g.addColorStop(1, rgba(base, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'grid': {
      ctx.clearRect(0, 0, W, H);
      state.off = (state.off + dt * 40) % 40;
      const horizon = H * 0.55;
      const sun = ctx.createRadialGradient(W / 2, horizon, 10, W / 2, horizon, W * 0.6);
      sun.addColorStop(0, rgba(accent2, 0.35 * intensity));
      sun.addColorStop(1, rgba(accent2, 0));
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = rgba(accent, 0.45 * intensity);
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const z = (i * 40 + state.off) / 40;
        const y = horizon + (z * z * 3.2);
        if (y > H) break;
        ctx.globalAlpha = Math.min(1, z / 6);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = -14; i <= 14; i++) {
        ctx.beginPath(); ctx.moveTo(W / 2 + i * 14, horizon); ctx.lineTo(W / 2 + i * 120, H); ctx.stroke();
      }
      break;
    }
    case 'waves': {
      ctx.clearRect(0, 0, W, H);
      state.t += dt;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const amp = 18 + k * 8;
        const yb = H * (0.55 + k * 0.08);
        for (let x = 0; x <= W; x += 8) {
          const y = yb + Math.sin(x * 0.012 + state.t * (0.6 + k * 0.15) + k) * amp + Math.sin(x * 0.03 - state.t) * 6;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(k % 2 ? accent2 : accent, (0.35 - k * 0.05) * intensity);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      break;
    }
    case 'rain': {
      state.acc += dt;
      if (state.acc < 0.05) return;
      state.acc = 0;
      ctx.fillStyle = light ? 'rgba(250,250,250,0.12)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${state.size - 2}px "JetBrains Mono", monospace`;
      const glyphs = 'ハイクアカサタナ0123456789ABCDEF{}<>*#';
      state.cols.forEach((y, i) => {
        ctx.fillStyle = rgba(accent, (0.35 + Math.random() * 0.5) * intensity);
        ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * state.size, y * state.size);
        state.cols[i] = y * state.size > H && Math.random() > 0.975 ? 0 : y + 1;
      });
      break;
    }
    default:
  }
}
