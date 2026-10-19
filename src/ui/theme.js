// Applique les réglages d'apparence (Studio) : couleurs, mode, polices, rayons, flou, effets.

import { prefs, FONTS } from '../prefs.js';
import { fx } from './fx.js';
import { setBackground } from './bg.js';
import { setHaptics, setSystemBars } from '../platform.js';

function hexToRgb(hex) {
  const h = String(hex || '#a78bfa').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const fontStack = (k) => (k === 'system' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : `"${FONTS[k] || 'Sora'}", system-ui, sans-serif`);

export function applyTheme(a = prefs.a) {
  const root = document.documentElement;
  const acc = hexToRgb(a.accent);
  const acc2 = hexToRgb(a.accent2);
  root.dataset.mode = a.mode;
  root.dataset.density = a.density;
  root.dataset.list = a.listStyle;
  root.dataset.glow = a.glow ? '1' : '0';
  root.dataset.grain = a.grain ? '1' : '0';
  root.dataset.labels = a.tabLabels ? '1' : '0';
  const s = root.style;
  s.setProperty('--accent', a.accent);
  s.setProperty('--accent-2', a.accent2);
  s.setProperty('--accent-rgb', acc.join(','));
  s.setProperty('--accent2-rgb', acc2.join(','));
  // Texte lisible sur la couleur d'accent (noir ou blanc selon sa luminance).
  s.setProperty('--on-accent', luminance(acc) > 0.45 ? '#0b0712' : '#ffffff');
  s.setProperty('--radius', `${a.radius}px`);
  s.setProperty('--radius-sm', `${Math.max(6, Math.round(a.radius * 0.6))}px`);
  s.setProperty('--blur', `${a.blur}px`);
  s.setProperty('--font', fontStack(a.font));
  s.setProperty('--font-display', fontStack(a.display));
  fx.setLevel(a.motion);
  setHaptics(a.haptics);
  setBackground(a.bg, a.bgIntensity);
  const bgColor = { dark: '#07050d', amoled: '#000000', light: '#f6f4fb', glass: '#0a0c14' }[a.mode] || '#07050d';
  setSystemBars(a.mode !== 'light', bgColor);
}
