import { expect, test, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const photo = (name: string) => join(here, '..', 'fixtures', 'photos', `${name}.jpg`);

async function pickPhoto(page: Page, name: string) {
  // Skrytý input pro výběr z galerie (ten bez atributu capture).
  await page.locator('input[type=file]:not([capture])').setInputFiles(photo(name));
  await expect(page.getByRole('heading', { name: 'Nová omalovánka' })).toBeVisible();
}

async function waitForDrawing(page: Page) {
  const lines = page.locator('svg.drawing .ink g path').first();
  await expect(lines).toHaveAttribute('d', /M/, { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Vybarvit' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('úvodní obrazovka', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Omalovánkárna');
  await expect(page.getByRole('heading', { name: 'Z fotky omalovánka.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vyfotit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vybrat fotku' })).toBeVisible();
  const manifest = await page.request.get('manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).name).toBe('Omalovánkárna');
});

test('fotka → omalovánka → galerie', async ({ page }) => {
  await page.goto('./');
  await pickPhoto(page, 'cat');
  await page.getByRole('radio', { name: /Malí umělci/ }).click();
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);

  // Posuvník detailů překreslí bez nového běhu sítě.
  const inkHtml = () => page.locator('svg.drawing .ink').first().innerHTML();
  const before = await inkHtml();
  await page.getByRole('slider', { name: 'Množství detailů' }).fill('0.95');
  await expect
    .poll(inkHtml)
    .not.toBe(before);

  await page.getByRole('button', { name: 'Zpět' }).click();
  await expect(page.getByRole('heading', { name: /Vaše omalovánky/ })).toBeVisible();
  await expect(page.locator('.grid .card')).toHaveCount(1);
});

test('jen hlavní postava: kůň bez krajiny', async ({ page }) => {
  await page.goto('./');
  await pickPhoto(page, 'horse');
  // Výběr hlavní postavy je zapnutý výchozím nastavením a proběhne sám.
  await expect(page.getByRole('switch')).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Přidat' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);
  // Po ořezu na koně je kresba na výšku, i když fotka je na šířku.
  const box = await page.locator('svg.drawing').getAttribute('viewBox');
  const [, , w, h] = box!.split(' ').map(Number);
  expect(h).toBeGreaterThan(w);
});

test('vybarvení kyblíkem a export PDF', async ({ page }) => {
  await page.goto('./');
  await pickPhoto(page, 'teddy');
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);
  await page.getByRole('button', { name: 'Vybarvit' }).click();
  await expect(page.getByRole('heading', { name: 'Vybarvování' })).toBeVisible();
  await expect(page.locator('.viewport .loading')).toHaveCount(0);
  await page.waitForTimeout(500); // během přechodu obrazovek prohlížeč dotyky nedoručí

  const canvas = page.locator('.viewport canvas').first();
  await expect(canvas).toBeVisible();
  const b = (await canvas.boundingBox())!;
  // Několik klepnutí – některé místo může být malá uzavřená plocha u okraje.
  for (const [fx, fy] of [
    [0.05, 0.05],
    [0.95, 0.5],
    [0.5, 0.45],
  ]) {
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  }
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (c.width * c.height);
  });
  expect(painted).toBeGreaterThan(0.02);
  await expect(page.getByRole('button', { name: 'Zpět o krok' })).toBeEnabled();

  await page.getByRole('button', { name: 'Uložit a tisknout' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF k tisku/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await file.path();
  const { statSync } = await import('node:fs');
  expect(statSync(path).size).toBeGreaterThan(20_000);
});

test('funguje bez internetu', async ({ page, context }) => {
  await page.goto('./');
  // Počkáme, až service worker převezme stránku a nacachuje aplikaci.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await pickPhoto(page, 'dog');
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);
  await page.getByRole('button', { name: 'Zpět' }).click();
  await expect(page.locator('.grid .card')).toHaveCount(1);

  await context.setOffline(true);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Co nakreslíme dnes?' })).toBeVisible();
  await pickPhoto(page, 'cat');
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);
  await context.setOffline(false);
});

test('u fotky bez jasné postavy se kreslí celá', async ({ page }) => {
  await page.goto('./');
  await pickPhoto(page, 'house');
  await expect(page.getByText('nakreslím ji celou')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('switch')).not.toBeChecked();
});

test('portrét: obličej dostane oči, nos a pusu', async ({ page }) => {
  await page.goto('./');
  await pickPhoto(page, 'face-hat');
  await expect(page.getByRole('button', { name: 'Nakreslit' })).toBeEnabled({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Nakreslit' }).click();
  await waitForDrawing(page);
  // Vyplněné zorničky jsou v cestě plných tvarů (podcesty začínají „M“).
  const fills = await page.locator('svg.drawing .ink > path').first().getAttribute('d');
  expect((fills ?? '').split('M').length - 1).toBeGreaterThanOrEqual(2);
});
