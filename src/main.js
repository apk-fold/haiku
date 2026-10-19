// Démarrage de Haiku.

import './style.css';
import { gsap, fx } from './ui/fx.js';
import { initBackground } from './ui/bg.js';
import { applyTheme } from './ui/theme.js';
import { prefs } from './prefs.js';
import { session } from './session.js';
import { renderLock, hideLock, setUnlockHandler } from './ui/lock.js';
import { buildShell, resetShell, handleBack, openPalette, app, newItemMenu } from './app.js';
import { onLifecycle, setSecureScreen, isNative, autofill } from './platform.js';
import { loadDictionary } from './core/strength.js';

export async function playIntro(replay = false) {
  const el = document.getElementById('intro');
  if (!fx.on) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="intro-inner"><div class="intro-hanko">俳句</div><div class="intro-word">${'HAIKU'.split('').map((c) => `<span>${c}</span>`).join('')}</div><div class="intro-line"><i></i></div><div class="intro-sub">gestionnaire de mots de passe</div></div>`;
  return new Promise((resolve) => {
    const tl = gsap.timeline({ onComplete: () => { el.hidden = true; el.innerHTML = ''; resolve(); } });
    const letters = el.querySelectorAll('.intro-word span');
    tl.set(el, { opacity: 1 })
      .from(el.querySelector('.intro-hanko'), { scale: 3, opacity: 0, rotation: -25, duration: fx.d(0.7), ease: 'power4.out' })
      .from(letters, { yPercent: 120, opacity: 0, rotationX: -90, transformOrigin: '50% 100%', stagger: fx.d(0.07), duration: fx.d(0.8), ease: 'back.out(2)' }, '-=0.3')
      .from(el.querySelector('.intro-line i'), { scaleX: 0, transformOrigin: '0 50%', duration: fx.d(0.6), ease: 'power3.inOut' }, '-=0.5')
      .from(el.querySelector('.intro-sub'), { opacity: 0, y: 8, letterSpacing: '1em', duration: fx.d(0.6) }, '-=0.4');
    if (fx.wild) tl.to(letters, { color: 'var(--accent)', textShadow: '0 0 24px var(--accent)', stagger: 0.04, duration: 0.2, yoyo: true, repeat: 1 }, '-=0.2');
    tl.to(el.querySelector('.intro-inner'), { scale: replay ? 1.1 : 1.6, opacity: 0, filter: 'blur(10px)', duration: fx.d(0.6), ease: 'power3.in' }, '+=0.25')
      .to(el, { opacity: 0, duration: fx.d(0.35) }, '-=0.3');
  });
}

function shortcuts() {
  window.addEventListener('keydown', (e) => {
    if (!session.vault) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); session.lock('manual'); }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newItemMenu(document.getElementById('fab')); }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); app.go('#/gen'); }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); app.go('#/vault'); setTimeout(() => document.querySelector('.search-bar input')?.focus(), 400); }
    if (mod && e.key === ',') { e.preventDefault(); app.go('#/settings'); }
    if (e.key === 'Escape' && !isNative) handleBack();
  });
}

async function boot() {
  initBackground(document.getElementById('bg'));
  applyTheme();
  prefs.on((section) => { if (section === 'appearance' || section === '*') applyTheme(); });
  setSecureScreen(prefs.s.secureScreen);
  onLifecycle({ pause: () => session.onPause(), resume: () => session.onResume(), back: () => handleBack() });
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, () => session.activity(), { passive: true, capture: true });
  shortcuts();
  loadDictionary();

  // Ouvert par le système pour remplir un formulaire d'une autre appli ?
  const afReq = await autofill.request();
  if (afReq) {
    window.__haikuAutofill = afReq;
    document.body.classList.add('autofill-mode');
  }

  setUnlockHandler(() => {
    hideLock();
    if (window.__haikuAutofill) history.replaceState(null, '', '#/autofill');
    else if (!location.hash || location.hash === '#' || location.hash === '#/' || location.hash === '#/autofill') history.replaceState(null, '', '#/home');
    buildShell();
  });
  session.on((ev, data) => {
    if (ev === 'lock') {
      resetShell();
      session.refresh().then(() => renderLock(data.reason));
    }
  });

  await session.refresh();
  if (prefs.a.intro && !afReq) await playIntro();
  else document.getElementById('intro').hidden = true;
  renderLock('boot');
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px;white-space:pre-wrap">Erreur au démarrage : ${String(e?.stack || e)}</pre>`);
});
