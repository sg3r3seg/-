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
  // Installer sidebar (164x314, 24-bit BMP) drawn in a canvas.
  await page.setViewportSize({ width: 164, height: 314 });
  await page.setContent('<canvas id="c" width="164" height="314"></canvas>');
  const px = await page.evaluate(async (svgText) => {
    const c = document.getElementById('c'); const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 164, 314); grd.addColorStop(0, '#0b1a33'); grd.addColorStop(1, '#03060c');
    g.fillStyle = grd; g.fillRect(0, 0, 164, 314);
    const glow = g.createRadialGradient(82, 110, 5, 82, 110, 120); glow.addColorStop(0, 'rgba(34,228,217,.25)'); glow.addColorStop(1, 'rgba(34,228,217,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 164, 314);
    const img = new Image(); img.src = `data:image/svg+xml;base64,${btoa(svgText)}`; await img.decode();
    g.drawImage(img, 42, 60, 80, 80);
    const tg = g.createLinearGradient(20, 0, 144, 0); tg.addColorStop(0, '#22e4d9'); tg.addColorStop(1, '#4cc9ff');
    g.fillStyle = tg; g.font = 'bold 28px Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('L I V E X', 82, 185);
    g.fillStyle = '#7aa6c9'; g.font = 'bold 8px Segoe UI, Arial, sans-serif'; g.fillText('ONE PLATFORM.', 82, 210); g.fillText('EVERY CREATOR.', 82, 222);
    return Array.from(g.getImageData(0, 0, 164, 314).data);
  }, svg);
  const W = 164; const H = 314; const rowSize = Math.ceil((W * 3) / 4) * 4;
  const bmp = Buffer.alloc(54 + rowSize * H);
  bmp.write('BM', 0); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(W, 18); bmp.writeInt32LE(H, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(rowSize * H, 34);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = ((H - 1 - y) * W + x) * 4; const di = 54 + y * rowSize + x * 3;
    bmp[di] = px[si + 2]; bmp[di + 1] = px[si + 1]; bmp[di + 2] = px[si];
  }
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'sidebar.bmp'), bmp);
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
