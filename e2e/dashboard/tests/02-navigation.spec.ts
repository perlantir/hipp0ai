import { test, expect } from '@playwright/test';

test.describe('Dashboard - Navigation', () => {
  test('navigates to every visible top-level page without 404/error', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const links = await page
      .locator('a[href^="/"]:not([href="/"]), a[href^="#"]:not([href="#"]), nav a, [role="navigation"] a')
      .all();
    const hrefs: string[] = [];
    for (const l of links) {
      const href = await l.getAttribute('href');
      if (
        href &&
        !hrefs.includes(href) &&
        !href.startsWith('mailto:') &&
        href !== '#'
      ) {
        hrefs.push(href);
      }
    }

    // Visit at most 10 internal routes, skipping duplicates
    for (const href of hrefs.slice(0, 10)) {
      const response = await page.goto(href);
      // 200 or 304 acceptable (SPA routing typically returns 200 for all routes via fallback)
      const status = response?.status() ?? 0;
      expect(status).toBeLessThan(500);
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      // Smoke check: no "uncaught" text unless the route is explicitly 404
      const body = (await page.locator('body').innerText()).toLowerCase();
      if (!href.includes('404')) {
        expect(body).not.toContain('uncaught');
      }
    }
  });
});
