'use strict';
// Renders build/icon.svg to PNGs with Chromium and packs a multi-size .ico
// (PNG-compressed entries, supported since Windows Vista).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = {};
  for (const s of [...sizes, 512]) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    pngs[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
  }
  await browser.close();
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length); let offset = 6 + dir.length;
  sizes.forEach((s, i) => {
    const b = pngs[s]; const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1); dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(b.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += b.length;
  });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, dir, ...sizes.map((s) => pngs[s])]));
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), pngs[512]);
  fs.mkdirSync(path.join(__dirname, '..', 'src', 'renderer', 'img'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'img', 'icon.png'), pngs[256]);
  console.log('icons written');
})().catch((e) => { console.error(e); process.exit(1); });
