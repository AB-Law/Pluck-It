/**
 * Auth flow — login page smoke tests.
 *
 * In local dev, the Angular app auto-signs in as "Local Dev" (environment.production = false),
 * so we just verify the app boots without a login redirect.
 *
 * In production E2E runs (BASE_URL pointing at staging), the test would need a
 * real Google token — which is out of scope for an automated suite. Those runs
 * are marked `.skip` and documented here so the intent is clear.
 */
import { test, expect } from '@playwright/test';

test.describe('Auth', () => {
  test('app loads without redirect in dev mode', async ({ page }) => {
    await page.goto('/');
    // In dev mode the app bypasses auth and renders the dashboard immediately.
    // Wait for the Angular router to finish initial navigation.
    await page.waitForLoadState('networkidle');
    // The URL should NOT contain /login (dev mode auto-authenticates)
    expect(page.url()).not.toContain('/login');
  });

  test('login page renders the Google sign-in button in production mode', async ({ page }) => {
    // This test is only meaningful against a production build.
    // Skip automatically when running against the dev server.
    test.skip(process.env['BASE_URL'] === undefined, 'Requires production BASE_URL');

    await page.goto('/login');
    await expect(page.locator('[data-testid="google-signin"]')).toBeVisible();
  });
});
