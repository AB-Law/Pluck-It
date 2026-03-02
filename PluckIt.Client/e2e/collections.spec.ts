/**
 * Collections E2E smoke tests.
 */
import { test, expect } from '@playwright/test';

test.describe('Collections', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/collections**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'col-001',
            ownerId: 'local-dev-user',
            name: 'Summer Looks',
            description: 'My summer outfits',
            isPublic: true,
            clothingItemIds: ['item-001'],
            memberUserIds: [],
            createdAt: '2025-01-01T00:00:00Z',
          },
        ]),
      });
    });

    await page.goto('/collections');
    await page.waitForLoadState('networkidle');
  });

  test('navigates to collections page', async ({ page }) => {
    const url = page.url();
    expect(url).toMatch(/\/(collections|login)/);
  });

  test('collections page renders without errors', async ({ page }) => {
    test.skip(!page.url().includes('/collections'), 'Requires authenticated session');
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);
  });
});
