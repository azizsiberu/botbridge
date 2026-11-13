import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixture, mockBridge } from './fixtures';

const surfaces = [
  ['/', '/api/workspace/conversations'],
  ['/messages', '/api/workspace/bots/ada/messages'],
  ['/messages/thread-1?peer=lin', '/api/workspace/bots/ada/threads/thread-1'],
  ['/rooms', '/api/workspace/bots/ada/rooms'],
  ['/rooms/room-1', '/api/workspace/bots/ada/rooms/room-1'],
  ['/work', '/api/workspace/bots/ada/tasks'],
  ['/work/task-1', '/api/workspace/bots/ada/tasks/task-1'],
  ['/search', '/api/workspace/bots/ada/directory'],
  ['/profile', '/api/admin/bots'],
  ['/activity', '/api/workspace/bots/ada/summary'],
  ['/overview', '/api/admin/overview'],
  ['/bots', '/api/admin/bots'],
  ['/bots/ada', '/api/admin/bots/ada'],
  ['/mail', '/api/admin/messages'],
  ['/mail/thread-1', '/api/admin/threads/thread-1'],
  ['/tasks', '/api/admin/tasks'],
  ['/connections', '/api/admin/connections'],
  ['/keys', '/api/admin/api-keys'],
  ['/audit', '/api/admin/audit'],
  ['/doorbell', '/api/admin/doorbell'],
  ['/settings', '/api/admin/settings'],
  ['/admin', '/api/admin/admin/users'],
  ['/oauth/choose?client_id=chatgpt', '/api/admin/bots'],
] as const;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test.beforeEach(async ({ page }) => {
  await mockBridge(page);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: every screen exposes loading and recovers from request failure`, async ({ page }) => {
    test.setTimeout(180_000);
    for (const [path, endpoint] of surfaces) {
      const pending = gate();
      let fail = true;
      let calls = 0;
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname !== endpoint || route.request().method() !== 'GET') return route.fallback();
        calls++;
        await pending.promise;
        if (fail) await route.fulfill({ status: 503, json: { message: 'Temporary failure. Try again.' } });
        else await route.fallback();
      });
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
      await expect.poll(() => calls, { message: path }).toBeGreaterThan(0);
      await expect(page.locator('.loading').first(), path).toBeVisible();
      await expect(page.locator('.loading').first()).toHaveAttribute('aria-busy', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), path).toBe(false);
      pending.release();
      const error = page.getByRole('alert').filter({ hasText: 'Temporary failure' }).first();
      await expect(error, path).toBeVisible();
      fail = false;
      await error.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(calls, path).toBeGreaterThan(1);
      await page.unroute('**/api/**');
      await mockBridge(page);
    }
  });
}

test('startup screen has branded loading, retry, and reduced-motion support', async ({ page }) => {
  const pending = gate();
  let failed = true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/public-config', async (route) => {
    await pending.promise;
    if (failed) await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    else await route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('.app-loading .brand')).toHaveText('botbridge');
  await expect(page.locator('.loading-skeleton')).toBeVisible();
  expect(await page.locator('.spinner').evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none',
  );
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  pending.release();
  await expect(page.getByRole('heading', { name: 'botbridge is not answering' })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'All conversations' })).toBeVisible();
});

test('a slower previous filter response cannot replace newer results', async ({ page }) => {
  const pending = gate(),
    completed = gate();
  await page.goto('/bots');
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.route('**/api/admin/bots?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'lin') return route.fallback();
    await pending.promise;
    try {
      await route.fulfill({ json: fixture('/api/admin/bots') });
    } finally {
      completed.release();
    }
  });
  await page.getByRole('textbox', { name: 'Search bots' }).fill('lin');
  await expect(page.locator('.loading')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search bots' }).fill('newsroom');
  await expect(page.locator('.inbox-list').getByRole('link')).toHaveCount(1);
  await expect(page.locator('.inbox-list')).toContainText('newsroom');
  pending.release();
  await completed.promise;
  await expect(page.locator('.inbox-list').getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

const submissions = [
  ['/bots', 'New bot', 'Name', 'new-bot', 'Create bot', '/api/admin/bots'],
  ['/keys', 'New key', 'Label', 'Review key', 'Create key', '/api/admin/api-keys'],
  ['/settings', '', '', '', 'Save', '/api/admin/settings'],
  ['/bots/ada', '', 'Name', 'ada', 'Save profile', '/api/admin/bots/ada'],
  ['/bots/ada', '', 'URL', 'https://example.com/webhook', 'Save webhook', '/api/admin/bots/ada/webhook'],
  ['/admin', '', 'Email', 'test@example.com', 'Send invite', '/api/admin/admin/invites'],
  ['/oauth/choose?client_id=chatgpt', '', '', '', 'Use this bot', '/api/admin/grants'],
  ['/oauth/choose?client_id=chatgpt', '', 'Name', 'new-bot', 'Create and bind', '/api/admin/bots'],
] as const;
for (const [path, opener, field, value, submit, endpoint] of submissions) {
  test(`${path}: ${submit} locks the form and reports pending work`, async ({ page }) => {
    const pending = gate();
    let requests = 0;
    await page.goto(path);
    await expect(page.locator('.loading')).toHaveCount(0);
    if (opener) await page.getByRole('button', { name: opener, exact: true }).first().click();
    if (field) await page.getByLabel(field, { exact: true }).fill(value);
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname !== endpoint || route.request().method() === 'GET')
        return route.fallback();
      requests++;
      await pending.promise;
      await route.fulfill({ status: 503, json: { message: 'Save failed. Your input is preserved.' } });
    });
    await page.getByRole('button', { name: submit, exact: true }).click();
    const working = page.locator('button[aria-busy="true"]');
    await expect(working).toBeVisible();
    await expect(working).toBeDisabled();
    const form = page.locator('form[aria-busy="true"]');
    await expect(form).toBeVisible();
    const enabled = form.locator('input:enabled, select:enabled, textarea:enabled, button:enabled');
    await expect(enabled).toHaveCount(0);
    await form.evaluate((element) => {
      (element as HTMLFormElement).requestSubmit();
      (element as HTMLFormElement).requestSubmit();
    });
    expect(requests).toBe(1);
    pending.release();
    await expect(page.getByRole('alert').filter({ hasText: 'Save failed' })).toBeVisible();
    await expect(page.getByRole('button', { name: submit, exact: true })).toBeEnabled();
    if (field) await expect(page.getByLabel(field, { exact: true })).toHaveValue(value);
    expect(requests).toBe(1);
  });
}

test('failed secondary panels stop loading and offer a retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/admin/bots/ada/connect', (route) =>
    fail ? route.fulfill({ status: 503, json: { message: 'Snippets unavailable' } }) : route.fallback(),
  );
  await page.goto('/bots/ada');
  const error = page.getByRole('alert').filter({ hasText: 'Snippets unavailable' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading connection snippets' })).toHaveCount(0);
  fail = false;
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('tablist', { name: 'Client snippets' })).toBeVisible();
});

test('mobile desk keeps bottom navigation visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bots');
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All conversations' })).toBeVisible();
});

test('Compose tracks form submission and blocks duplicates while sending', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-prompt').getByRole('button', { name: 'Compose', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Send as' })
    .getByRole('button', { name: 'ada', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Message Start a private conversation with a bot.' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
  await dialog.getByLabel('To', { exact: true }).selectOption('lin');
  await dialog.getByLabel('Message', { exact: true }).fill('The draft is ready.');
  const pending = gate();
  let requests = 0;
  await page.route('**/api/workspace/bots/ada/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests++;
    await pending.promise;
    await route.fulfill({ json: { doorbell: true, to: { name: 'lin' } } });
  });
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  await dialog.locator('form').evaluate((element) => {
    (element as HTMLFormElement).requestSubmit();
    (element as HTMLFormElement).requestSubmit();
  });
  expect(requests).toBe(1);
  pending.release();
  await expect(dialog).not.toBeVisible();
  expect(requests).toBe(1);
});
