import { test, expect } from '@playwright/test';

test.describe('Dashboard - App boot', () => {
  test('renders root page without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    // Any visible content is enough to confirm boot
    await expect(page.locator('body')).toBeVisible();
    // Allow a moment for hydration
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  test('has a visible app title or logo', async ({ page }) => {
    await page.goto('/');
    // Match hipp0 / Hippo / HIPP0 / Brain / Dashboard in any prominent heading
    const matches = await page
      .locator('h1, h2, [class*="title" i], [class*="logo" i], img[alt*="hipp" i]')
      .allTextContents();
    const altTexts = await page.locator('img[alt]').evaluateAll((imgs) =>
      imgs.map((img) => (img as HTMLImageElement).alt).filter(Boolean),
    );
    const combined = [...matches, ...altTexts].join(' ').toLowerCase();
    expect(combined).toMatch(/hipp|brain|dashboard|memory/);
  });
});
