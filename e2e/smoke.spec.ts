import { test, expect } from '@playwright/test';

test('home page loads with the about section and all cards', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('Klaus Hofrichter');
  await expect(page.getByText('LinkedIn', { exact: true })).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible();
  await expect(page.getByText('Portfolio 2017', { exact: true })).toBeVisible();
  await expect(page.getByText('Instagram', { exact: true })).toBeVisible();
  await expect(page.getByText('Three Puppies', { exact: true })).toBeVisible();
  await expect(page.getByText('Medium', { exact: true })).toBeVisible();
  await expect(page.getByText('Contact: klaus@klaushofrichter.net')).toBeVisible();
});

test('/health reports ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', service: 'www-klaushofrichter' });
});
