// Nasnímá obrazovky aplikace do docs/ (pro README). Předpoklad: běží `npm run preview`.
import { chromium, devices } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs');
mkdirSync(out, { recursive: true });
const base = process.env.URL ?? 'http://localhost:4173/omalovankarna/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'cs-CZ', colorScheme: 'light' });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });

await page.goto(base);
await page.waitForTimeout(2600);
await shot('01-uvod');

await page.locator('input[type=file]:not([capture])').setInputFiles(join(root, 'tests/fixtures/photos/horse.jpg'));
await page.getByText('Jen hlavní postava').click();
await page.getByRole('radio', { name: 'Přidat' }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(400);
await shot('02-vyber-postavy');

await page.getByRole('button', { name: 'Nakreslit' }).click();
await page.getByRole('button', { name: 'Vybarvit' }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(2800);
await shot('03-omalovanka');

await page.getByRole('button', { name: 'Vybarvit' }).click();
await page.locator('.viewport .loading').waitFor({ state: 'detached' });
const c = await page.locator('.viewport canvas').first().boundingBox();
const tap = async (fx, fy, color) => {
  await page.getByRole('radio', { name: color }).click();
  await page.getByRole('radio', { name: 'Kyblík' }).click();
  await page.mouse.click(c.x + c.width * fx, c.y + c.height * fy);
};
await tap(0.05, 0.04, 'Nebeská');
await tap(0.55, 0.35, 'Oříšková');
await page.waitForTimeout(1600);
await shot('04-vybarvovani');

await page.getByRole('button', { name: 'Hotovo, zpět' }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Zpět', exact: true }).click();
await page.waitForTimeout(1200);
await shot('05-galerie');
await browser.close();

// Náhledový pás pro README.
const files = ['01-uvod', '03-omalovanka', '04-vybarvovani', '05-galerie'];
const tiles = await Promise.all(files.map((f) => sharp(join(out, `${f}.png`)).resize(360).png().toBuffer()));
const meta = await sharp(tiles[0]).metadata();
const gap = 24;
await sharp({
  create: { width: tiles.length * 360 + (tiles.length + 1) * gap, height: meta.height + 2 * gap, channels: 3, background: '#e9dfcd' },
})
  .composite(tiles.map((input, i) => ({ input, left: gap + i * (360 + gap), top: gap })))
  .png()
  .toFile(join(out, 'nahled.png'));
console.log('Snímky uloženy do docs/');
