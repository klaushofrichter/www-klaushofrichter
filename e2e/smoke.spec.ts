import { test, expect } from '@playwright/test';
import { links } from '../src/links';

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
    'https://status.klaushofrichter.net',
  ]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  // The auth-gated cards must not leak to a logged-out visitor. Driven off
  // links.ts rather than one hand-picked URL: this used to name the status
  // card, and when that card became public the assertion would have gone on
  // passing while covering nothing.
  const gated = links.filter((l) => l.requiresAuth);
  expect(gated.length).toBeGreaterThan(0);
  for (const link of gated) {
    await expect(page.locator(`a[href="${link.url}"]`)).toHaveCount(0);
  }
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

test('the public folder is listed and its files download', async ({ page, request }) => {
  const response = await page.goto('/public');
  expect(response?.status()).toBe(200);
  // The listing is generated from whatever is committed under public/, so
  // assert on the shape - at least one entry, and its link actually serves
  // bytes - rather than on a filename that is expected to come and go.
  const first = page.locator('li a').first();
  await expect(first).toBeVisible();
  const href = await first.getAttribute('href');
  expect(href).toBeTruthy();
  const download = await request.get(href!);
  expect(download.status()).toBe(200);
  expect((await download.body()).length).toBeGreaterThan(0);
});
