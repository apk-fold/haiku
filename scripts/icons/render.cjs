const sharp = require('/opt/npm-tools/node_modules/sharp');
const fs = require('fs');
const out = '/home/claude/haiku/scripts/android-extra/res';
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const fg = fs.readFileSync('fg.svg'), bg = fs.readFileSync('bg.svg'), mono = fs.readFileSync('mono.svg');
  for (const [d, k] of Object.entries(dens)) {
    const dir = `${out}/mipmap-${d}`; fs.mkdirSync(dir, { recursive: true });
    const s108 = Math.round(108 * k), s48 = Math.round(48 * k);
    await sharp(fg, { density: 300 }).resize(s108, s108).png().toFile(`${dir}/ic_launcher_foreground.png`);
    await sharp(mono, { density: 300 }).resize(s108, s108).png().toFile(`${dir}/ic_launcher_monochrome.png`);
    // icône classique : fond + premier plan, coins arrondis
    const bgBuf = await sharp(bg, { density: 300 }).resize(s108, s108).png().toBuffer();
    const fgBuf = await sharp(fg, { density: 300 }).resize(s108, s108).png().toBuffer();
    const full = await sharp(bgBuf).composite([{ input: fgBuf }]).png().toBuffer();
    const crop = Math.round(s108 * 0.18), inner = s108 - crop * 2;
    const sq = await sharp(full).extract({ left: crop, top: crop, width: inner, height: inner }).resize(s48, s48).png().toBuffer();
    const r = Math.round(s48 * 0.22);
    const mask = Buffer.from(`<svg width="${s48}" height="${s48}"><rect width="${s48}" height="${s48}" rx="${r}" fill="#fff"/></svg>`);
    await sharp(sq).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher.png`);
    const circ = Buffer.from(`<svg width="${s48}" height="${s48}"><circle cx="${s48/2}" cy="${s48/2}" r="${s48/2}" fill="#fff"/></svg>`);
    await sharp(sq).composite([{ input: circ, blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
  }
  // Grande version pour le README
  const bgBuf = await sharp(bg, { density: 300 }).resize(512, 512).png().toBuffer();
  const fgBuf = await sharp(fg, { density: 300 }).resize(512, 512).png().toBuffer();
  const mask = Buffer.from(`<svg width="512" height="512"><rect width="512" height="512" rx="112" fill="#fff"/></svg>`);
  const full = await sharp(bgBuf).composite([{ input: fgBuf }]).png().toBuffer();
  await sharp(full).composite([{ input: mask, blend: 'dest-in' }]).png().toFile('/home/claude/haiku/docs-icon.png');
  console.log('ok');
})();
