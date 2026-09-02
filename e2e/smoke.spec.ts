import { test, expect } from '@playwright/test';

test('home page loads with the about section and all cards', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('Klaus Hofrichter');
  // Asserted by card URL rather than by title: the titles are editorial (they
  // pick up markers like "(archive)"), the links are what the page is for.
  for (const href of [
    'https://www.linkedin.com/in/klaushofrichter',
    'https://github.com/klaushofrichter',
    'https://klaushofrichter.wordpress.com',
    'https://www.instagram.com/klaushofrichter',
    'https://three-pups.mystrikingly.com',
    'https://klaushofrichter.medium.com/',
  ]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  // The auth-gated cards must not leak to a logged-out visitor.
  await expect(page.locator('a[href="https://status.klaushofrichter.net"]')).toHaveCount(0);
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
