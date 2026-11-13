import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockBridge } from './fixtures';

const routes = [
  '/',
  '/messages',
  '/messages/thread-1?peer=lin',
  '/rooms',
  '/rooms/room-1',
  '/work',
  '/work/task-1',
  '/search',
  '/profile',
  '/activity',
  '/overview',
  '/bots',
  '/bots/ada',
  '/mail',
  '/mail/thread-1',
  '/tasks',
  '/connections',
  '/keys',
  '/audit',
  '/doorbell',
  '/settings',
  '/admin',
];
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1440]) {
    test(`${theme}, ${width}px: routes fit the viewport and load without errors`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const path of routes) {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('.loading')).toHaveCount(0);
        await expect(page.locator('[role="alert"]')).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow, `horizontal overflow on ${path}`).toBe(false);
        expect(errors, path).toEqual([]);
      }
    });
  }
}

test.beforeEach(async ({ page }) => {
  await mockBridge(page);
});

test('bot creation dialog traps focus, closes with Escape, and returns focus', async ({ page }) => {
  await page.goto('/bots');
  const trigger = page.getByRole('button', { name: 'New bot', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'New bot' });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('mobile menu navigates to desk and theme persists', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?theme=dark');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.locator('#workspace-mobile-menu');
  await menu.getByText('Workspace settings', { exact: true }).click();
  await menu.getByRole('button', { name: 'Light theme' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await menu.getByRole('link', { name: 'Manage bots', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage bots' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('#desk-mobile-menu').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All conversations' })).toBeVisible();
});

test('compose offers modes and sends to the selected destination', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-prompt').getByRole('button', { name: 'Compose', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Send as' })
    .getByRole('button', { name: 'ada', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Message Start a private conversation with a bot.' }).click();
  dialog = page.getByRole('dialog', { name: 'Message', exact: true });
  await dialog.getByLabel('To', { exact: true }).selectOption('lin');
  await dialog.getByLabel('Message', { exact: true }).fill('The revised brief is ready.');
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/messages'),
  );
  await page.route('**/api/workspace/bots/ada/messages', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ json: { doorbell: true, to: { name: 'lin' } } });
    else await route.fallback();
  });
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    to: 'lin',
    text: 'The revised brief is ready.',
    attachments: [],
  });
  await expect(dialog).not.toBeVisible();
});

test('message filtering and empty state stay usable', async ({ page }) => {
  await page.goto('/messages');
  await expect(page.getByRole('link', { name: /lin 2 unread/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Filter conversations' }).fill('nonexistent');
  await expect(page.getByText('No matching conversations.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Filter conversations' }).fill('');
  await page.getByRole('checkbox', { name: 'Unread', exact: true }).check();
  await expect(page.getByRole('link', { name: /newsroom Read/ })).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: shared surfaces and dialogs meet WCAG AA checks`, async ({ page }) => {
    test.setTimeout(90_000);
    for (const route of ['/', '/bots', '/bots/ada', '/settings', '/rooms', '/messages']) {
      await page.goto(`${route}?theme=${theme}`);
      await expect(page.locator('.loading')).toHaveCount(0);
      await expect(page.locator('main')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations, route).toEqual([]);
    }
    await page.goto(`/bots?theme=${theme}`);
    await page.getByRole('button', { name: 'New bot', exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('bot search distinguishes an empty result from an empty account', async ({ page }) => {
  await page.goto('/bots');
  await page.getByRole('textbox', { name: 'Search bots' }).fill('no-such-bot');
  await expect(page.getByRole('heading', { name: 'No matching bots' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.inbox-list').getByRole('link').first()).toBeVisible();
});

test('connection snippets support arrow, Home and End keys', async ({ page }) => {
  await page.goto('/bots/ada');
  const tabs = page.getByRole('tablist', { name: 'Client snippets' });
  await tabs.getByRole('tab', { name: 'Claude Code' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Cursor' })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'Cursor' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Generic' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.getByRole('tab', { name: 'Claude Code' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toBeVisible();
});

test('home shows every bot conversation without selecting an active bot', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.removeItem('botbridge-active-bot'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All conversations' })).toBeVisible();
  await expect(page.getByLabel('Active bot')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /ada → lin/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /newsroom → ada/ })).toBeVisible();
  await page.getByRole('link', { name: /ada → lin/ }).click();
  await expect(page).toHaveURL(/bot=lin/);
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
});
