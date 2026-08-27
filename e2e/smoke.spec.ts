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

test('/health reports ok with a version', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(body.service).toBe('www-klaushofrichter');
  // Generated at deploy time as YYYY.MM.DD.N; "dev" for an unstamped build.
  expect(body.version).toMatch(/^(dev|\d{4}\.\d{2}\.\d{2}\.\d+)$/);
});

test('the page header shows the deployed version', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-version')).toHaveText(/^(dev|\d{4}\.\d{2}\.\d{2}\.\d+)$/);
});
