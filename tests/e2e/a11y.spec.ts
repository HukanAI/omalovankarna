import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function audit(page: Page) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`přístupnost – ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Vybrat fotku' })).toBeVisible();
    await audit(page);

    await page.locator('input[type=file]:not([capture])').setInputFiles(join(here, '..', 'fixtures', 'photos', 'cat.jpg'));
    await expect(page.getByRole('button', { name: 'Nakreslit' })).toBeVisible();
    await audit(page);

    await page.getByRole('button', { name: 'Nakreslit' }).click();
    await expect(page.getByRole('button', { name: 'Vybarvit' })).toBeVisible({ timeout: 90_000 });
    await audit(page);

    await page.getByRole('button', { name: 'Vybarvit' }).click();
    await expect(page.locator('.viewport .loading')).toHaveCount(0);
    await audit(page);
  });
}
