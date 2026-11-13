import { expect, test } from '@playwright/test';
import mark from '../src/brand/mark.json' with { type: 'json' };
import { mockBridge } from './fixtures';

test('app logo, favicons and installation icons use the shared brand assets', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/?theme=dark');
  const logo = page.locator('.ws-nav .nav-brand svg');
  await expect(logo).toHaveAttribute('viewBox', mark.viewBox);
  expect(
    await logo.locator('path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
  ).toEqual(mark.paths);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/favicon.svg',
  );
  const vector = await page.request.get('/favicon.svg');
  expect(vector.status()).toBe(200);
  expect(vector.headers()['content-type']).toContain('image/svg+xml');
  for (const path of mark.paths) expect(await vector.text()).toContain(path);
  for (const [asset, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
  ] as const) {
    const response = await page.request.get('/' + asset);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    const bytes = await response.body();
    expect(bytes.readUInt32BE(16), asset).toBe(size);
    expect(bytes.readUInt32BE(20), asset).toBe(size);
  }
  const ico = await (await page.request.get('/favicon.ico')).body();
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(1);
  const manifest = await (await page.request.get('/site.webmanifest')).json();
  expect(manifest.icons).toContainEqual({
    src: '/icon-maskable-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  });
  await page.getByText('Workspace settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Light theme' }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e4ebf0');
  await expect.poll(() => logo.evaluate((element) => getComputedStyle(element).fill)).toBe('rgb(20, 32, 40)');
});

test('mobile desk Compose asks for a sender without a stored active bot', async ({ page }) => {
  await mockBridge(page);
  await page.addInitScript(() => sessionStorage.removeItem('botbridge-active-bot'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bots');
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Compose' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Send as' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Send as' })
    .getByRole('button', { name: 'ada', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Compose', exact: true })).toBeVisible();
});
