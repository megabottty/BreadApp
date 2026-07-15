import { expect, test, type Page } from '@playwright/test';

async function stubAppConfig(page: Page, siteMode: 'public' | 'admin-preview' = 'admin-preview') {
  await page.route('**/api/config', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        siteMode,
        apiUrl: '/api',
        frontendUrl: 'http://localhost:4300',
        supabaseUrl: 'https://vciwftypjimwpsgcwyan.supabase.co',
        supabaseKey: 'sb_publishable_RtQtGr_kMakhlU68ItMyzg_rB9eKbhp',
        stripePublicKey: 'pk_test_e2e'
      })
    });
  });
}

async function stubTenantAndRecipes(page: Page) {
  await page.route('**/api/orders/info', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'tenant-e2e',
        name: 'E2E Bakery',
        slug: 'thedailydough',
        primary_color: '#7D8F69',
        secondary_color: '#D88569'
      })
    });
  });

  await page.route('**/api/orders/recipes', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
}

test('non-admin users are redirected to construction page in admin-preview mode', async ({ page }) => {
  await stubAppConfig(page, 'admin-preview');
  await stubTenantAndRecipes(page);

  await page.goto('/front');

  await expect(page).toHaveURL(/\/under-construction/);
  await expect(page.getByRole('heading', { name: 'Page Under Construction' })).toBeVisible();
});

test('admin preview flow can access storefront and cart via e2e override', async ({ page }) => {
  await stubAppConfig(page, 'admin-preview');
  await stubTenantAndRecipes(page);

  await page.goto('/front?e2e=1');
  await expect(page.getByRole('heading', { name: 'Our Daily Bakes' })).toBeVisible();

  await page.goto('/cart?e2e=1');
  await expect(page.getByRole('heading', { name: 'Your Shopping Bag' })).toBeVisible();
});

test('app shell loads without blank-page runtime script failures', async ({ page }) => {
  await stubAppConfig(page, 'admin-preview');
  await stubTenantAndRecipes(page);

  const browserErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') browserErrors.push(msg.text());
  });
  page.on('pageerror', err => browserErrors.push(err.message));

  await page.goto('/under-construction');
  await expect(page.getByRole('heading', { name: 'Page Under Construction' })).toBeVisible();

  expect(browserErrors.filter(msg =>
    msg.includes('Failed to load module script')
    || msg.includes('NG0203')
    || msg.includes('Bootstrap FAILED')
  )).toHaveLength(0);
});
