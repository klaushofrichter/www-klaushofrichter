import { test, expect } from '@playwright/test';

test('home page loads and shows the expected content', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('www.klaushofrichter.net');
  await expect(page.getByText('Hello from www-klaushofrichter')).toBeVisible();
});

test('/health reports ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', service: 'www-klaushofrichter' });
});
