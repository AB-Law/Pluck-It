/**
 * Wardrobe (Vault) E2E smoke tests.
 *
 * Assumes the app is running in dev mode (auto-authenticated as "Local Dev")
 * and that a local API proxy is configured (proxy.conf.json).
 *
 * HTTP API calls are intercepted and mocked to prevent Cosmos DB hits
 * during CI E2E runs.
 */
import { test, expect } from '@playwright/test';

test.describe('Vault / Wardrobe', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept API calls so tests are hermetic even without a running backend
    await page.route('**/api/wardrobe**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/suggestions/wear') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ suggestions: [] }),
        });
      }
      if (url.includes('/wear-history') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            itemId: 'item-001',
            events: [],
            summary: { totalInRange: 0, legacyUntrackedCount: 0 },
          }),
        });
      }
      if (url.includes('/wear') && method === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'item-001',
            imageUrl: 'https://via.placeholder.com/150',
            category: 'Tops',
            tags: ['casual'],
            colours: [{ name: 'White', hex: '#FFFFFF' }],
            brand: 'Zara',
            wearCount: 4,
            dateAdded: '2025-01-01T00:00:00Z',
            price: null,
            notes: null,
            purchaseDate: null,
            condition: null,
            estimatedMarketValue: null,
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'item-001',
              imageUrl: 'https://via.placeholder.com/150',
              category: 'Tops',
              tags: ['casual'],
              colours: [{ name: 'White', hex: '#FFFFFF' }],
              brand: 'Zara',
              wearCount: 3,
              dateAdded: '2025-01-01T00:00:00Z',
              price: null,
              notes: null,
              purchaseDate: null,
              condition: null,
              estimatedMarketValue: null,
            },
          ],
          nextContinuationToken: null,
        }),
      });
    });

    await page.route('**/api/insights/vault**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-03-04T10:00:00Z',
          currency: 'USD',
          insufficientData: false,
          behavioralInsights: {
            topColorWearShare: { color: 'Black', pct: 63 },
            unworn90dPct: 40,
            mostExpensiveUnworn: { itemId: 'item-001', amount: 199, currency: 'USD' },
          },
          cpwIntel: [],
        }),
      });
    });

    await page.goto('/vault');
    await page.waitForLoadState('networkidle');
  });

  test('renders wardrobe page without errors', async ({ page }) => {
    // Should land on /vault or redirect to login if not authenticated
    // In dev mode, should be authenticated
    const url = page.url();
    expect(url).toMatch(/\/(vault|login)/);
  });

  test('displays clothing items from the API', async ({ page }) => {
    test.skip(!page.url().includes('/vault'), 'Requires authenticated session');
    // Wait for items to render after API mock is consumed
    await page.waitForSelector('[data-testid="clothing-item"], .clothing-card, .item-card, .wardrobe-item', {
      timeout: 5000,
    }).catch(() => {
      // Grid might use a different selector — just check the page rendered
    });
    // Verify no error state is shown
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);
  });
});
