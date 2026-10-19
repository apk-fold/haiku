// Test de fumée de l'interface (GitHub Actions) : parcourt les écrans principaux de la version compilée
// et enregistre des captures. Usage : node tests/ui-smoke.mjs <url> <dossier>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '/tmp/shots';
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
mkdirSync(OUT, { recursive: true });

async function run(name, viewport) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  const closeSheets = async () => {
    for (let i = 0; i < 5; i++) {
      if (!(await p.$('.scrim'))) break;
      await p.evaluate(() => [...document.querySelectorAll('.scrim')].pop()?.click());
      await p.waitForTimeout(450);
    }
  };
  const go = async (h) => { await closeSheets(); await p.goto(BASE + h); };
  const shot = async (n) => { await p.waitForTimeout(1400); await p.screenshot({ path: `${OUT}/${name}-${n}.png` }); };
  try {
    await p.goto(BASE);
    await p.waitForSelector('.welcome-card [data-act=create]', { timeout: 20000 });
    await shot('01-bienvenue');
    await p.click('[data-act=create]');
    await p.click('[data-next]');
    await p.waitForTimeout(500);
    await p.fill('[name=pw]', 'Correct-Cheval-Batterie-Agrafe-42');
    await p.fill('[name=pw2]', 'Correct-Cheval-Batterie-Agrafe-42');
    await p.click('[data-next]');
    await p.waitForTimeout(500);
    await p.click('[data-next]');
    await p.waitForTimeout(500);
    await p.click('[data-next]');
    await p.waitForSelector('.rk-key', { timeout: 30000 });
    await shot('02-cle-recuperation');
    await p.click('.rk .switch');
    await p.click('[data-done]');
    await p.waitForSelector('#shell:not([hidden])', { timeout: 30000 });
    for (const f of ['bitwarden.json', 'keyra.csv']) {
      await go('#/transfer');
      await p.waitForTimeout(800);
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=import]')]);
      await fc.setFiles(FIX + f);
      await p.waitForSelector('[data-go]', { timeout: 15000 });
      await p.click('[data-go]');
      await p.waitForTimeout(1600);
    }
    for (const [h, n] of [['#/home', '03-accueil'], ['#/vault', '04-coffre'], ['#/totp', '05-2fa'], ['#/gen', '06-generateur'], ['#/health', '07-sante'], ['#/studio', '08-studio'], ['#/modules', '09-modules'], ['#/settings', '10-reglages'], ['#/new/login', '11-nouveau'], ['#/folders', '12-dossiers'], ['#/send', '13-send'], ['#/activity', '14-historique']]) {
      await go(h);
      await shot(n);
    }
    await go('#/vault');
    await p.waitForTimeout(800);
    await p.fill('.search-bar input', 'visa');
    await p.waitForTimeout(700);
    await p.click('.row >> nth=0');
    await p.waitForTimeout(2200);
    await shot('15-carte');
    await closeSheets();
    await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true })));
    await p.waitForSelector('.lock-card', { timeout: 15000 });
    await shot('16-verrouille');
    await p.fill('.pw-form [name=pw]', 'Correct-Cheval-Batterie-Agrafe-42');
    await p.click('.unlock-btn');
    await p.waitForSelector('#shell:not([hidden])', { timeout: 30000 });
    await shot('17-deverrouille');
  } catch (e) {
    errs.push(`ÉCHEC : ${e.message}`);
    await p.screenshot({ path: `${OUT}/${name}-zz-echec.png` }).catch(() => {});
  }
  await b.close();
  return errs;
}

const all = [];
all.push(...(await run('telephone', { width: 412, height: 915 })).map((e) => `[téléphone] ${e}`));
all.push(...(await run('fold', { width: 884, height: 1000 })).map((e) => `[Fold déplié] ${e}`));
writeFileSync(`${OUT}/erreurs.txt`, all.join('\n') || 'aucune erreur');
console.log(all.join('\n') || 'aucune erreur');
