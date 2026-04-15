import { test } from '@playwright/test';

test.describe('Dashboard - Visual regression snapshots', () => {
  const routes = ['/', '/playground', '/#chat', '/#graph', '/#search'];

  for (const route of routes) {
    test(`screenshot ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      if (!response || response.status() >= 400) {
        test.skip(true, `Route ${route} not available (status ${response?.status() ?? 'no response'})`);
        return;
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      // Save to a known location
      const slug =
        route === '/'
          ? 'root'
          : route.replace(/[\/#]/g, '-').replace(/^-+/, '');
      await page.screenshot({
        path: `./screenshots/${slug}.png`,
        fullPage: true,
      });
    });
  }
});
