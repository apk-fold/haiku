// Tests du cœur de Haiku : `npm test` (node --test). Tournent dans GitHub Actions avant chaque APK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deriveKey, bwDeriveKey, bwEncrypt, bwDecrypt, hkdfExpand, gzip, gunzip } from '../src/core/crypto.js';
import { Vault } from '../src/core/vault.js';
import { parseImport, applyImport, NeedsPassword, detect } from '../src/core/importers.js';
import { buildExport } from '../src/core/exporters.js';
import { totpCode, parseTotp, parseMigration, base32Decode, base32Encode } from '../src/core/totp.js';
import { generatePassword, generatePassphrase, generateUsername } from '../src/core/generator.js';
import { estimate, loadDictionary } from '../src/core/strength.js';
import { runAudit } from '../src/core/audit.js';
import { parseCsv, toCsv } from '../src/core/csv.js';
import { generateRecoveryKey, parseRecoveryKey } from '../src/core/recovery.js';
import { matches, normalizeTags } from '../src/core/tags.js';
import { buildSend } from '../src/core/send.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const FAST = { alg: 'argon2id', t: 1, m: 1024, p: 1 };

test('Argon2id : même résultat que Python/cryptography (et donc que Keyra)', async () => {
  const k = await deriveKey('password', new TextEncoder().encode('somesaltsomesalt'), { t: 3, m: 65536, p: 4 });
  assert.equal(Buffer.from(k).toString('hex'), '81db97a7e67a891784a2599bc879f957cb3512d273984bd97d8a18fc59ff01e2');
});

test('HKDF-Expand (étirement Bitwarden) : vecteur RFC 5869 cas 1', async () => {
  // PRK du cas de test 1, info f0..f9, L=42
  const prk = Buffer.from('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5', 'hex');
  const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
  const okm = await hkdfExpand(new Uint8Array(prk), new Uint8Array(info), 42);
  assert.equal(Buffer.from(okm).toString('hex'), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});

test('gzip aller-retour', async () => {
  const s = new TextEncoder().encode('haïku '.repeat(500));
  assert.deepEqual(await gunzip(await gzip(s)), s);
});

test('coffre : création, déverrouillage, mauvais mot de passe, persistance', async () => {
  const v = await Vault.create({ name: 'Perso', password: 'correct horse battery', kdf: FAST });
  let saved = null;
  v.onPersist = async (t) => { saved = t; };
  const it = await v.saveItem({ type: 'login', name: 'GitHub', tags: ['#dev', 'Dev', 'école'], data: { username: 'u', password: 'p1', uris: [{ uri: 'https://github.com' }] } });
  assert.deepEqual(it.tags, ['dev', 'école']);
  await v.saveItem({ ...it, data: { ...it.data, password: 'p2' } });
  await v.saveItem({ ...v.item(it.id), favorite: true });
  const cur = v.item(it.id);
  assert.equal(cur.history.length, 1, 'le favori ne crée pas de version');
  assert.equal(cur.passwordHistory[0].password, 'p1');
  await assert.rejects(Vault.unlock(saved, 'mauvais mot de passe'), /incorrect/);
  const v2 = await Vault.unlock(saved, 'correct horse battery');
  assert.equal(v2.item(it.id).data.password, 'p2');
  assert.equal(v2.folders.length, 6);
  const restored = await v2.restoreVersion(it.id, 0);
  assert.equal(restored.data.password, 'p1');
});

test('clé de récupération : génération, saisie tolérante, mot de passe oublié', async () => {
  const k = await generateRecoveryKey();
  assert.match(k, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.equal(await parseRecoveryKey(k.toLowerCase().replace(/-/g, ' ')), k);
  const typo = (k[0] === 'A' ? 'B' : 'A') + k.slice(1);
  assert.equal(await parseRecoveryKey(typo), null);
  const v = await Vault.create({ name: 'R', password: 'motdepasse-1', kdf: FAST });
  let saved;
  v.onPersist = async (t) => { saved = t; };
  const rk = await v.setRecoveryKey();
  await v.saveItem({ type: 'note', name: 'secret', notes: 'x' });
  const { vault, recoveryKey } = await Vault.recover(saved, rk, 'nouveau-mdp-2');
  assert.notEqual(recoveryKey, rk);
  const text = await vault.serialize();
  const v3 = await Vault.unlock(text, 'nouveau-mdp-2');
  assert.equal(v3.active[0].name, 'secret');
  await assert.rejects(Vault.recover(text, rk, 'autre-mdp-3'), /ne correspond pas/);
});

test('corbeille et purge', async () => {
  const v = await Vault.create({ name: 'T', password: 'motdepasse-1', kdf: FAST });
  const a = await v.saveItem({ type: 'note', name: 'a' });
  await v.trashItems(a.id);
  assert.equal(v.active.length, 0);
  assert.equal(v.trash.length, 1);
  v.item(a.id).deletedAt = new Date(Date.now() - 40 * 86400000).toISOString();
  assert.equal(await v.purgeTrash(30), 1);
});

test('import Keyra : export chiffré .mcfexport produit par Keyra', async () => {
  const text = fx('keyra-export.mcfexport');
  await assert.rejects(parseImport(text), NeedsPassword);
  await assert.rejects(parseImport(text, { password: 'faux' }), NeedsPassword);
  const p = await parseImport(text, { password: 'export-pass-123' });
  assert.equal(p.format, 'keyra');
  assert.equal(p.entries.length, 6);
  const by = Object.fromEntries(p.entries.map((e) => [e.item.name, e]));
  assert.equal(by.GitHub.item.data.password, 'gh-Secret-42!');
  assert.equal(by.GitHub.folder, 'Work');
  assert.deepEqual(by.GitHub.item.tags, ['dev', 'École']);
  assert.equal(by.GitHub.item.fields.find((f) => f.name === 'E-mail').value, 'm@example.com');
  assert.equal(by['Visa perso'].item.type, 'card');
  assert.equal(by['Visa perso'].item.data.expMonth, '08');
  assert.equal(by['Visa perso'].item.data.expYear, '2027');
  assert.equal(by['Box maison'].item.data.ssid, 'Livebox-1234');
  assert.equal(by.Proxmox.item.data.hostname, '192.168.1.10');
  assert.equal(by.Moi.item.data.lastName, 'Angst');
});

test('import Keyra CSV', async () => {
  const p = await parseImport(fx('keyra.csv'));
  assert.equal(p.format, 'keyra_csv');
  assert.equal(p.entries.length, 6);
  assert.ok(p.entries.find((e) => e.item.type === 'server'));
});

test('import Bitwarden JSON + application au coffre (dossiers, doublons)', async () => {
  const p = await parseImport(fx('bitwarden.json'));
  assert.equal(p.format, 'bitwarden_json');
  assert.equal(p.entries.length, 5);
  const g = p.entries[0];
  assert.equal(g.folder, 'Perso');
  assert.equal(g.item.reprompt, true);
  assert.equal(g.item.data.uris.length, 2);
  assert.equal(g.item.data.uris[1].match, 'domain');
  assert.equal(g.item.fields[1].type, 'bool');
  assert.equal(g.item.passwordHistory[0].password, 'old-pass');
  assert.equal(p.entries[4].item.type, 'ssh');
  const v = await Vault.create({ name: 'I', password: 'motdepasse-1', kdf: FAST });
  const r1 = await applyImport(v, p);
  assert.equal(r1.imported, 5);
  assert.deepEqual(r1.foldersCreated, ['Perso']); // « Travail » existe déjà
  const r2 = await applyImport(v, await parseImport(fx('bitwarden.json')));
  assert.equal(r2.imported, 0);
  assert.equal(r2.duplicates, 5);
});

test('export Bitwarden protégé → réimport (aller-retour, types Haiku conservés)', async () => {
  const v = await Vault.create({ name: 'E', password: 'motdepasse-1', kdf: FAST });
  await v.saveItem({ type: 'wifi', name: 'Box', tags: ['maison'], data: { ssid: 'Box-1', password: 'k', security: 'WPA3', hidden: true } });
  await v.saveItem({ type: 'server', name: 'NAS', data: { hostname: '10.0.0.2', port: '2222', protocol: 'SSH', username: 'admin', password: 'x' } });
  await v.saveItem({ type: 'login', name: 'Site', data: { username: 'a', password: 'b', totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://ex.com', match: 'exact' }] } });
  const out = await buildExport('bitwarden_protected', v, { password: 'mot-de-passe-export' });
  const j = JSON.parse(out);
  assert.equal(j.encrypted, true);
  assert.match(j.data, /^2\./);
  const p = await parseImport(out, { password: 'mot-de-passe-export' });
  const by = Object.fromEntries(p.entries.map((e) => [e.item.name, e.item]));
  assert.equal(by.Box.type, 'wifi');
  assert.equal(by.Box.data.security, 'WPA3');
  assert.equal(by.Box.data.hidden, true);
  assert.deepEqual(by.Box.tags, ['maison']);
  assert.equal(by.NAS.type, 'server');
  assert.equal(by.NAS.data.port, '2222');
  assert.equal(by.Site.data.uris[0].match, 'exact');
  await assert.rejects(parseImport(out, { password: 'faux-mot-de-passe' }), NeedsPassword);
});

test('Bitwarden EncString : chiffrement / déchiffrement / MAC', async () => {
  const k = await bwDeriveKey('pw', 'sel', { kdfType: 0, kdfIterations: 5000 });
  const e = await bwEncrypt(k, 'bonjour');
  assert.equal(await bwDecrypt(k, e), 'bonjour');
  const parts = e.split('|');
  parts[2] = Buffer.alloc(32).toString('base64');
  await assert.rejects(bwDecrypt(k, parts.join('|')));
});

test('export Haiku chiffré → réimport complet', async () => {
  const v = await Vault.create({ name: 'H', password: 'motdepasse-1', kdf: FAST });
  const f = await v.addFolder('Jeux');
  await v.saveItem({ type: 'card', name: 'CB', folderId: f.id, data: { number: '4111', code: '1' }, attachments: [{ id: 'x', name: 'a.txt', size: 1, mime: 'text/plain', data: 'YQ==' }] });
  const out = await buildExport('haiku', v, { password: 'export-123456' });
  const p = await parseImport(out, { password: 'export-123456' });
  assert.equal(p.entries[0].folder, 'Jeux');
  assert.equal(p.entries[0].item.attachments[0].name, 'a.txt');
});

test('export Keyra .mcfexport → relu par l\'importeur Keyra de Haiku', async () => {
  const v = await Vault.create({ name: 'K', password: 'motdepasse-1', kdf: FAST });
  await v.saveItem({ type: 'identity', name: 'Moi', data: { firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '06' } });
  await v.saveItem({ type: 'login', name: 'X', tags: ['t1'], data: { username: 'u', password: 'p', uris: [{ uri: 'https://x.fr' }] } });
  const out = await buildExport('keyra', v, { password: 'export-123456' });
  assert.equal(JSON.parse(out).format, 'mon-coffre-fort-export');
  const p = await parseImport(out, { password: 'export-123456' });
  assert.equal(p.entries.length, 2);
  assert.equal(p.entries.find((e) => e.item.name === 'Moi').item.data.email, 'a@b.c');
});

test('CSV : guillemets, retours à la ligne, détection des formats', () => {
  const csv = toCsv(['name', 'url', 'username', 'password'], [{ name: 'a,"b"', url: 'u', username: 'x\ny', password: ' p ' }]);
  const { records } = parseCsv(csv);
  assert.equal(records[0].name, 'a,"b"');
  assert.equal(records[0].username, 'x\ny');
  assert.equal(records[0].password, ' p ');
  assert.equal(detect('name,url,username,password,note\na,b,c,d,e\n').format, 'chrome');
  assert.equal(detect('url,username,password,httpRealm,formActionOrigin,guid\n').format, 'firefox');
  assert.equal(detect('"Group","Title","Username","Password","URL","Notes","TOTP"\n').format, 'keepassxc');
  assert.equal(detect('url,username,password,totp,extra,name,grouping,fav\n').format, 'lastpass');
  assert.equal(detect('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n').format, 'bitwarden_csv');
});

test('TOTP : vecteurs RFC 6238 (SHA-1, 8 chiffres)', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  const uri = `otpauth://totp/x?secret=${secret}&digits=8`;
  assert.equal((await totpCode(uri, 59000)).code, '94287082');
  assert.equal((await totpCode(uri, 1111111109000)).code, '07081804');
  assert.equal((await totpCode(uri, 2000000000000)).code, '69279037');
  const c = parseTotp('otpauth://totp/ACME%20Co:john@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&period=60');
  assert.equal(c.issuer, 'ACME Co');
  assert.equal(c.account, 'john@example.com');
  assert.equal(c.period, 60);
  assert.equal((await totpCode('steam://JBSWY3DPEHPK3PXP', 59000)).code.length, 5);
  assert.deepEqual(base32Decode(base32Encode(new Uint8Array([1, 2, 3, 250]))), new Uint8Array([1, 2, 3, 250]));
});

test('Google Authenticator : QR de transfert', () => {
  // Paiement : 1 compte « Example:alice », secret « Hello!Þ¿ » (JBSWY3DPEHPK3PXP)
  const payload = Buffer.from([0x0a, 0x2a, 0x0a, 0x0a, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef, 0x12, 0x0d, ...Buffer.from('Example:alice'), 0x1a, 0x07, ...Buffer.from('Example'), 0x20, 0x01, 0x28, 0x01, 0x30, 0x02]);
  const list = parseMigration(`otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`);
  assert.equal(list.length, 1);
  assert.equal(list[0].issuer, 'Example');
  assert.equal(list[0].account, 'alice');
  assert.match(list[0].totp, /secret=JBSWY3DPEHPK3PXP/);
});

test('générateur et robustesse', async () => {
  const p = generatePassword({ length: 32, symbols: true, minDigits: 3, minSymbols: 2 });
  assert.equal(p.value.length, 32);
  assert.ok((p.value.match(/\d/g) || []).length >= 3);
  const pp = await generatePassphrase({ words: 6, separator: '.', lang: 'fr' });
  assert.equal(pp.value.split('.').length, 6);
  assert.ok(pp.entropy > 77);
  const u = await generateUsername({ mode: 'plus', email: 'moi@gmail.com' });
  assert.match(u.value, /^moi\+[a-z0-9]{8}@gmail\.com$/);
  await loadDictionary();
  assert.equal(estimate('azerty').score, 0);
  assert.ok(estimate('P@ssw0rd2024').score <= 2);
  assert.ok(estimate(p.value).score === 4);
  assert.ok(estimate(pp.value).score >= 3);
});

test('audit : réutilisés, faibles, sans mot de passe, http, cartes expirées', async () => {
  const v = await Vault.create({ name: 'A', password: 'motdepasse-1', kdf: FAST });
  await v.saveItem({ type: 'login', name: 'a', data: { username: 'x', password: 'azerty', uris: [{ uri: 'http://a.fr' }] } });
  await v.saveItem({ type: 'login', name: 'b', data: { username: 'x', password: 'azerty' } });
  await v.saveItem({ type: 'login', name: 'c', data: { username: 'x', password: '' } });
  await v.saveItem({ type: 'card', name: 'd', data: { expMonth: '01', expYear: '2020' } });
  const r = runAudit(v.items);
  assert.equal(r.results.reused.length, 2);
  assert.equal(r.results.weak.length, 2);
  assert.equal(r.results.missing.length, 1);
  assert.equal(r.results.insecure.length, 1);
  assert.equal(r.results.expired.length, 1);
  assert.ok(r.score < 70);
});

test('recherche : texte libre, #étiquette, filtres', () => {
  const it = { type: 'login', name: 'Banque Populaire', tags: normalizeTags(['Finances', 'écoles primaires']), data: { username: 'moi', password: 'secretXYZ', uris: [] }, favorite: true };
  assert.ok(matches(it, 'banque pop'));
  assert.ok(matches(it, '#finances'));
  assert.ok(matches(it, '#"ecoles primaires" banque'));
  assert.ok(!matches(it, 'secretxyz'), 'les secrets ne sont jamais cherchés');
  assert.ok(matches(it, 'is:fav type:identifiant'));
  assert.ok(!matches(it, 'type:carte'));
});

test('Send : page autonome', async () => {
  const { html } = await buildSend({ name: 'Code Wi-Fi', text: 'abc', password: 'secret-1' });
  assert.match(html, /HAIKU · SEND/);
  assert.ok(!html.includes('abc"'));
});
