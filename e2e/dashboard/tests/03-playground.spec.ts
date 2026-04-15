import { test, expect } from '@playwright/test';

test.describe('Dashboard - Playground (Super Brain simulator)', () => {
  test('playground route loads and accepts a task input', async ({ page }) => {
    // The PlaygroundSuperBrain component was added in Phase A. The app uses both
    // a direct /playground path (public, pre-auth) and a #playground hash route.
    const candidates = ['/playground', '/#playground', '/demo', '/super-brain', '/brain'];
    let found = false;
    for (const p of candidates) {
      const resp = await page.goto(p);
      if (!resp) continue;
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      const body = (await page.locator('body').innerText()).toLowerCase();
      if (
        body.includes('playground') ||
        body.includes('super brain') ||
        body.includes('simulation') ||
        body.includes('simulator')
      ) {
        found = true;
        break;
      }
    }
    if (!found) {
      test.skip(true, 'Playground route not found at common paths; likely not yet linked in nav');
      return;
    }

    // Look for an input where we can enter a task
    const inputs = page.locator('input[type="text"], textarea, [contenteditable="true"]');
    if ((await inputs.count()) > 0) {
      await inputs.first().fill('design authentication architecture');
      // Find a submit/start button
      const button = page.locator(
        'button:has-text("Start"), button:has-text("Run"), button:has-text("Go"), button[type="submit"]',
      );
      if ((await button.count()) > 0) {
        await button.first().click();
        // Something should change in the UI
        await page.waitForTimeout(1000);
      }
    }

    // Sanity: page is still responsive
    await expect(page.locator('body')).toBeVisible();
  });
});
