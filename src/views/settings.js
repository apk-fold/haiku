// Réglages : ce coffre, déverrouillage (biométrie, PIN), verrouillage auto, presse-papiers,
// confidentialité, corbeille, coffres, à propos.

import { gsap, fx } from '../ui/fx.js';
import { icon } from '../ui/icons.js';
import { on } from '../ui/dom.js';
import { esc, formatDate } from '../core/util.js';
import { prefs, vaultPrefs, MODULES } from '../prefs.js';
import { session } from '../session.js';
import { prompt, confirm, toast, toastError, menu, switchHtml, sheet } from '../ui/components.js';
import { showRecoveryKey, createVaultFlow, KDF_LEVELS } from '../ui/lock.js';
import { biometric, setSecureScreen, isNative, appInfo } from '../platform.js';
import { checkKdf } from '../core/crypto.js';

const LOCK_OPTS = [[0, 'Immédiatement'], [60, '1 minute'], [300, '5 minutes'], [900, '15 minutes'], [1800, '30 minutes'], [3600, '1 heure'], [14400, '4 heures'], [-1, 'Jamais']];
const CLIP_OPTS = [[0, 'Jamais'], [10, '10 secondes'], [20, '20 secondes'], [30, '30 secondes'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']];
const TRASH_OPTS = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '1 an'], [0, 'Jamais']];

export async function render(ctx) {
  const v = ctx.vault;
  const info = await appInfo();
  const bio = await biometric.status();

  const draw = () => {
    const vp = vaultPrefs.get(v.id);
    const pinEnv = session.pinEnvelope(v.id);
    const s = prefs.s;
    const kdfName = Object.entries(KDF_LEVELS).find(([, l]) => l.m === v.file.kdf.m && l.t === v.file.kdf.t)?.[1].label || `${Math.round(v.file.kdf.m / 1024)} Mio · ${v.file.kdf.t} passes`;
    ctx.header({ title: 'Réglages', subtitle: v.name });
    ctx.el.innerHTML = `
      <section class="set-group glass" data-in><h3>${icon('lock', 16)}Ce coffre</h3>
        ${row('rename', 'pencil', 'Nom', esc(v.name))}
        ${row('password', 'key-round', 'Changer le mot de passe maître', v.file.hint ? `Indice : ${esc(v.file.hint)}` : 'Et son indice')}
        ${row('recovery', 'shield-check', 'Clé de récupération', v.file.recovery ? 'Active' : 'Aucune (conseillée)', v.file.recovery ? '' : 'warn')}
        ${row('kdf', 'cpu', 'Résistance Argon2id', esc(kdfName))}
        ${row('stats', 'activity', 'Statistiques', `${v.active.length} éléments · créé le ${formatDate(v.file.createdAt)}`)}
      </section>
      <section class="set-group glass" data-in><h3>${icon('fingerprint', 16)}Déverrouillage</h3>
        <label class="row-switch"><span>Biométrie<small>${isNative ? (bio.available ? 'Empreinte ou visage (clé protégée par Android Keystore)' : esc(bio.reason || 'Indisponible sur ce téléphone')) : 'Dans l\'appli Android uniquement'}</small></span>${switchHtml('bio', !!vp.bio && isNative)}</label>
        <label class="row-switch"><span>Code PIN<small>${pinEnv ? `${pinEnv.length} chiffres${pinEnv.persistent ? '' : ' · redemande le mot de passe au redémarrage'}` : 'Plus rapide que le mot de passe maître'}</small></span>${switchHtml('pin', !!pinEnv)}</label>
        ${pinEnv ? `<label class="slider-row"><span>Essais avant désactivation</span><b data-out="att">${s.maxPinAttempts}</b><input type="range" name="att" min="3" max="10" value="${s.maxPinAttempts}"></label>` : ''}
      </section>
      <section class="set-group glass" data-in><h3>${icon('timer', 16)}Verrouillage automatique</h3>
        ${row('lockAfter', 'hourglass', 'Après', esc(LOCK_OPTS.find(([x]) => x === s.lockAfter)?.[1] || ''))}
        <label class="row-switch"><span>Aussi en arrière-plan<small>Quand l'appli est quittée ou l'écran éteint</small></span>${switchHtml('lockOnBackground', s.lockOnBackground)}</label>
        ${row('locknow', 'lock', 'Verrouiller maintenant', '')}
      </section>
      <section class="set-group glass" data-in><h3>${icon('eye-off', 16)}Confidentialité</h3>
        ${row('clipboard', 'copy', 'Effacer le presse-papiers', esc(CLIP_OPTS.find(([x]) => x === s.clipboardClear)?.[1] || ''))}
        <label class="row-switch"><span>Écran sécurisé<small>Bloque les captures d'écran et masque l'aperçu dans les applis récentes</small></span>${switchHtml('secureScreen', s.secureScreen)}</label>
        ${row('trashDays', 'trash-2', 'Purge de la corbeille', esc(TRASH_OPTS.find(([x]) => x === s.trashDays)?.[1] || ''))}
      </section>
      <section class="set-group glass" data-in><h3>${icon('layers', 16)}Personnalisation</h3>
        ${link('#/studio', 'palette', 'Studio', 'Thèmes, couleurs, polices, fonds, animations')}
        ${link('#/modules', 'blocks', 'Modules', 'Activer, ranger, barre d\'onglets, widgets d\'accueil')}
      </section>
      <section class="set-group glass" data-in><h3>${icon('database', 16)}Données</h3>
        ${prefs.moduleOn('transfer') ? link('#/transfer', 'arrow-down-up', 'Import / Export', 'Bitwarden, Keyra, KeePass, navigateurs…') : ''}
        ${prefs.moduleOn('backups') ? link('#/backups', 'archive', 'Sauvegardes', s.autoBackup ? 'Automatiques au verrouillage' : 'Manuelles') : ''}
        ${prefs.moduleOn('trash') ? link('#/trash', 'trash-2', 'Corbeille', `${v.trash.length} élément${v.trash.length > 1 ? 's' : ''}`) : ''}
        ${prefs.moduleOn('activity') ? link('#/activity', 'history', 'Historique', 'Toutes les modifications') : ''}
      </section>
      <section class="set-group glass" data-in><h3>${icon('archive', 16)}Coffres</h3>
        ${session.list.map((x) => `<button class="set-row tap" data-vault="${x.id}"><span class="s-ic">${icon(x.id === v.id ? 'lock-open' : 'lock', 18)}</span><span class="s-txt"><b>${esc(x.name)}</b><small>${x.id === v.id ? 'Ouvert' : 'Verrouillé'}</small></span>${icon('chevron-right', 16)}</button>`).join('')}
        ${row('newvault', 'plus', 'Créer un autre coffre', '')}
        ${row('deletevault', 'trash-2', 'Supprimer ce coffre', 'Définitif', 'danger')}
      </section>
      <section class="set-group glass about" data-in><h3>${icon('feather', 16)}À propos</h3>
        <div class="about-logo"><span class="hanko">俳句</span><div><b>Haiku</b><small>Version ${esc(info.version || '')}${info.build ? ` (${esc(info.build)})` : ''}</small></div></div>
        <p class="muted small">Gestionnaire de mots de passe hors ligne : les fonctions de Bitwarden et de Keyra, sans compte, sans serveur, sans télémétrie. Chiffrement Argon2id + AES-256-GCM.</p>
        <p class="muted small">Merci à Keyra (Tahir-1907), GSAP, Lucide, hash-wasm, jsQR, qrcode-generator, les listes de mots EFF et diceware-wordlists-fr, et aux polices Sora, Syne, Shippori Mincho, JetBrains Mono…</p>
        ${row('replay', 'sparkles', 'Rejouer l\'introduction', '')}
      </section>`;
    fx.stagger(ctx.el.querySelectorAll('[data-in]'), { each: 0.04 });
    const range = ctx.el.querySelector('[name=att]');
    if (range) { range.style.setProperty('--p', `${((range.value - 3) / 7) * 100}%`); range.oninput = () => { ctx.el.querySelector('[data-out=att]').textContent = range.value; range.style.setProperty('--p', `${((range.value - 3) / 7) * 100}%`); prefs.set('security', { maxPinAttempts: +range.value }); }; }
  };

  const row = (act, ic, label, sub, cls = '') => `<button class="set-row tap ${cls}" data-act="${act}"><span class="s-ic">${icon(ic, 18)}</span><span class="s-txt"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span>${icon('chevron-right', 16)}</button>`;
  const link = (href, ic, label, sub) => `<a class="set-row tap" href="${href}"><span class="s-ic">${icon(ic, 18)}</span><span class="s-txt"><b>${esc(label)}</b><small>${esc(sub)}</small></span>${icon('chevron-right', 16)}</a>`;
  const needMaster = (title, message = 'Confirme avec ton mot de passe maître.') => prompt({ title, message, fields: [{ name: 'pw', label: 'Mot de passe maître', type: 'password', autocomplete: 'current-password' }], ok: 'Continuer', validate: async ({ pw }) => { if (!(await v.verifyPassword(pw))) throw new Error('Mot de passe incorrect.'); } });

  draw();

  on(ctx.el, 'change', 'input[type=checkbox]', async (e, inp) => {
    const n = inp.name;
    try {
      if (n === 'bio') {
        if (inp.checked) {
          if (!bio.available) { inp.checked = false; return toast(bio.reason || 'Biométrie indisponible', { icon: 'circle-alert', kind: 'error' }); }
          await session.enableBiometric();
          toast('Biométrie activée', { icon: 'fingerprint' });
          fx.burst(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2, { count: 14 });
        } else {
          await session.disableBiometric();
          toast('Biométrie désactivée', { icon: 'fingerprint' });
        }
      }
      if (n === 'pin') {
        if (inp.checked) {
          const r = await prompt({
            title: 'Code PIN',
            message: 'De 4 à 12 chiffres. Après plusieurs erreurs, le PIN est désactivé et le mot de passe maître redemandé.',
            fields: [{ name: 'p1', label: 'Code PIN', type: 'password', inputmode: 'numeric', maxlength: 12 }, { name: 'p2', label: 'Confirmation', type: 'password', inputmode: 'numeric', maxlength: 12 }, { name: 'persist', label: 'Garder le PIN au redémarrage de l\'appli', hint: 'Sinon le mot de passe maître est redemandé après un redémarrage (comme Bitwarden).', type: 'checkbox', value: true }],
            ok: 'Activer',
            validate: async ({ p1, p2, persist }) => {
              if (!/^\d{4,12}$/.test(p1)) throw new Error('Uniquement des chiffres, de 4 à 12.');
              if (p1 !== p2) throw new Error('Les deux codes diffèrent.');
              if (/^(\d)\1+$/.test(p1) || '0123456789012'.includes(p1) || '9876543210987'.includes(p1)) throw new Error('Trop facile à deviner.');
              await session.setPin(p1, persist);
            },
          });
          if (!r) inp.checked = false;
          else toast('Code PIN activé', { icon: 'grid-2x2' });
        } else {
          session.removePin();
          toast('Code PIN retiré', { icon: 'grid-2x2' });
        }
        draw();
      }
      if (n === 'lockOnBackground') prefs.set('security', { lockOnBackground: inp.checked });
      if (n === 'secureScreen') { prefs.set('security', { secureScreen: inp.checked }); setSecureScreen(inp.checked); }
    } catch (err) {
      inp.checked = !inp.checked;
      toastError(err);
    }
  });

  on(ctx.el, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    try {
      if (a === 'rename') {
        const r = await prompt({ title: 'Renommer le coffre', fields: [{ name: 'n', label: 'Nom', value: v.name, maxlength: 60 }], ok: 'Renommer' });
        if (r?.n?.trim()) { await v.rename(r.n); await session.refresh(); draw(); }
      }
      if (a === 'password') {
        const r = await prompt({
          title: 'Mot de passe maître',
          message: 'La clé de données ne change pas : rien n\'est rechiffré, seul son « emballage » change. Le code PIN et la biométrie restent valables.',
          fields: [{ name: 'old', label: 'Mot de passe actuel', type: 'password', autocomplete: 'current-password' }, { name: 'n1', label: 'Nouveau mot de passe', type: 'password', autocomplete: 'new-password' }, { name: 'n2', label: 'Confirmation', type: 'password', autocomplete: 'new-password' }, { name: 'hint', label: 'Indice (facultatif)', value: v.file.hint || '' }],
          ok: 'Changer',
          validate: async ({ old, n1, n2, hint }) => {
            if (!(await v.verifyPassword(old))) throw new Error('Mot de passe actuel incorrect.');
            if (n1.length < 8) throw new Error('Au moins 8 caractères.');
            if (n1 !== n2) throw new Error('La confirmation ne correspond pas.');
            await v.changePassword(n1, { hint });
          },
        });
        if (r) {
          await session.backup(v, 'mdp').catch(() => {});
          await session.refresh();
          fx.confetti();
          toast('Mot de passe maître changé · sauvegarde faite', { icon: 'key-round', ms: 3500 });
          draw();
        }
      }
      if (a === 'recovery') {
        const has = !!v.file.recovery;
        const c = await menu([{ icon: 'refresh-cw', label: has ? 'Créer une nouvelle clé' : 'Créer une clé de récupération', hint: has ? "L'ancienne cessera de fonctionner" : '', value: 'new' }, has && { icon: 'trash-2', label: 'Supprimer la clé', value: 'del', danger: true }], { title: 'Clé de récupération' });
        if (!c || !(await needMaster('Clé de récupération'))) return;
        if (c === 'new') {
          const k = await v.setRecoveryKey();
          const ok = await showRecoveryKey(k);
          if (!ok) { await v.removeRecoveryKey(); toast('Clé non confirmée : retirée', { icon: 'info' }); }
        }
        if (c === 'del') { await v.removeRecoveryKey(); toast('Clé supprimée', { icon: 'trash-2' }); }
        await session.refresh();
        draw();
      }
      if (a === 'kdf') {
        const lvl = await menu(Object.entries(KDF_LEVELS).map(([k, l]) => ({ icon: l.m === v.file.kdf.m && l.t === v.file.kdf.t ? 'circle-check' : 'cpu', label: l.label, hint: l.hint, value: k })), { title: 'Résistance Argon2id' });
        if (!lvl) return;
        const l = KDF_LEVELS[lvl];
        const r = await prompt({ title: l.label, message: 'Le mot de passe maître est nécessaire pour recalculer la clé.', fields: [{ name: 'pw', label: 'Mot de passe maître', type: 'password' }], ok: 'Appliquer', validate: async ({ pw }) => { if (!(await v.verifyPassword(pw))) throw new Error('Mot de passe incorrect.'); await v.changePassword(pw, { kdf: checkKdf({ t: l.t, m: l.m, p: l.p }) }); } });
        if (r) { toast(`Résistance : ${l.label}`, { icon: 'cpu' }); draw(); }
      }
      if (a === 'stats') {
        const st = v.stats();
        sheet({ title: 'Statistiques', body: `<div class="stats-top"><div><b>${st.total}</b><small>éléments</small></div><div><b>${st.favorites}</b><small>favoris</small></div><div><b>${st.totp}</b><small>2FA</small></div><div><b>${st.folders}</b><small>dossiers</small></div><div><b>${st.tags}</b><small>étiquettes</small></div><div><b>${st.trash}</b><small>corbeille</small></div></div><p class="muted small">Taille du fichier chiffré : ${Math.round(JSON.stringify(v.file).length / 1024)} Ko · Argon2id ${Math.round(v.file.kdf.m / 1024)} Mio, ${v.file.kdf.t} passes, ${v.file.kdf.p} voies.</p>` });
      }
      if (a === 'lockAfter') {
        const x = await menu(LOCK_OPTS.map(([val, l]) => ({ icon: val === prefs.s.lockAfter ? 'circle-check' : 'hourglass', label: l, value: String(val) })), { title: 'Verrouiller après' });
        if (x != null) { prefs.set('security', { lockAfter: +x }); draw(); }
      }
      if (a === 'clipboard') {
        const x = await menu(CLIP_OPTS.map(([val, l]) => ({ icon: val === prefs.s.clipboardClear ? 'circle-check' : 'copy', label: l, value: String(val) })), { title: 'Effacer le presse-papiers' });
        if (x != null) { prefs.set('security', { clipboardClear: +x }); draw(); }
      }
      if (a === 'trashDays') {
        const x = await menu(TRASH_OPTS.map(([val, l]) => ({ icon: val === prefs.s.trashDays ? 'circle-check' : 'trash-2', label: l, value: String(val) })), { title: 'Purger la corbeille après' });
        if (x != null) { prefs.set('security', { trashDays: +x }); draw(); }
      }
      if (a === 'locknow') session.lock('manual');
      if (a === 'newvault') createVaultFlow();
      if (a === 'deletevault') {
        if (!(await confirm({ title: `Supprimer « ${esc(v.name)} » ?`, message: 'Tout son contenu sera effacé de ce téléphone. Les sauvegardes déjà faites ne sont pas supprimées.', ok: 'Continuer', danger: true }))) return;
        await prompt({ title: 'Dernière confirmation', message: `Tape le nom du coffre et son mot de passe maître.`, fields: [{ name: 'n', label: `Nom (« ${esc(v.name)} »)` }, { name: 'pw', label: 'Mot de passe maître', type: 'password' }], ok: 'Supprimer définitivement', validate: async ({ n, pw }) => { if (n.trim() !== v.name) throw new Error('Le nom ne correspond pas.'); await session.deleteVault(v.id, pw); } });
      }
      if (a === 'replay') { const { playIntro } = await import('../main.js'); playIntro(true); }
    } catch (err) { toastError(err); }
  });

  on(ctx.el, 'click', '[data-vault]', async (e, b) => {
    if (b.dataset.vault === v.id) return;
    prefs.set('security', { lastVault: b.dataset.vault });
    await session.lock('switch');
  });
  void MODULES; void gsap;
}
