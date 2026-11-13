import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { chromium } from 'playwright';

const mark = JSON.parse(await readFile(new URL('../src/brand/mark.json', import.meta.url), 'utf8'));
const out = new URL('../public/', import.meta.url);
await mkdir(out, { recursive: true });
const paths = mark.paths.map((d) => `<path d="${d}" fill-rule="evenodd"/>`).join('');
const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" fill="#142028">${paths}</svg>\n`;
await writeFile(new URL('brand-mark.svg', out), source);
function icon({ rounded = false, maskable = false } = {}) {
  const size = maskable ? 56 : 40;
  const translate = maskable ? '10 12' : '2 4';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${rounded ? 9 : 0}" fill="#101010"/><g fill="#f5f5f5" transform="translate(${translate})">${paths}</g></svg>`;
}
await writeFile(new URL('favicon.svg', out), icon({ rounded: true }) + '\n');
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage();
  for (const [name, size, maskable] of [
    ['favicon-32.png', 32, false],
    ['apple-touch-icon.png', 180, false],
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
  ]) {
    const data = await page.evaluate(
      async ({ svg, size }) => {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const image = new globalThis.Image();
        image.src = 'data:image/svg+xml;base64,' + globalThis.btoa(svg);
        await image.decode();
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg: icon({ maskable }), size },
    );
    await writeFile(new URL(name, out), Buffer.from(data, 'base64'));
  }
  const png = await readFile(new URL('favicon-32.png', out));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile(new URL('favicon.ico', out), Buffer.concat([header, png]));
  console.log('Generated brand assets in ' + fileURLToPath(out));
} finally {
  await browser.close();
}
