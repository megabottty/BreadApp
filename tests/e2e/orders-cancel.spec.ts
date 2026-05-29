import { test, expect } from '@playwright/test';

// Intercept API routes and stub responses so test runs without a running backend
const sampleOrders = [
  {
    id: 'ORD-E2E-1',
    customerName: 'Eve',
    customerPhone: '555-0001',
    status: 'PENDING',
    pickupDate: new Date().toISOString(),
    items: []
  }
];

test('Cancel order from dashboard opens modal and cancels order', async ({ page }) => {
  // Stub tenant info request so app identifies the tenant and proceeds
  await page.route("**/api/orders/info", route => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "t1", name: "E2E Bakery", slug: "thedailydough", primary_color: "#7D8F69", secondary_color: "#E9B384" })
    });
  });

  // Stub GET /api/orders to return a known order list
  await page.route('**/api/orders', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sampleOrders) });
  });

  // Stub PATCH to accept cancellation
  let patchCalled = false;
  await page.route('**/api/orders/*/status', async route => {
    patchCalled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  // Open the dashboard page (bypass guards with e2e=1)
  await page.goto("/manage-orders?e2e=1");

  // Wait for the OrdersManager to mount
  await page.locator('h1', { hasText: "Order Management" }).first().waitFor({ timeout: 10000 });

  // Wait for the order card to render and click it to open details
  const orderCard = page.locator('.aggregation-item.order-card.clickable').first();
  await expect(orderCard).toBeVisible({ timeout: 10000 });
  // Wait for any splash overlay to disappear
  await page.locator(".splash-overlay").waitFor({ state: "hidden", timeout: 10000 });

  await orderCard.click();

  // In the order details modal, click the Cancel Order button
  const cancelBtn = page.locator('.modal-content.card button.btn-danger', { hasText: 'Cancel Order' }).first();
  await expect(cancelBtn).toBeVisible({ timeout: 2000 });
  await cancelBtn.click();

  // The confirm modal should appear; click the confirm labeled button
  const confirmBtn = page.locator('.modal-content.card button.btn-primary', { hasText: 'Yes, cancel order' }).first();
  await expect(confirmBtn).toBeVisible({ timeout: 2000 });
  await confirmBtn.click();

  // After confirmation, expect the PATCH to have been called
  expect(patchCalled).toBeTruthy();

  // The order status displayed in the details modal should update to CANCELLED
  await expect(page.locator('.modal-content.card', { hasText: 'CANCELLED' })).toBeVisible({ timeout: 3000 });
});
