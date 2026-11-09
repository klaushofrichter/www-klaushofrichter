/**
 * Accessibility: WCAG 2.2 level A and AA, checked by axe-core in a real
 * browser. Zero violations is the bar.
 *
 * The site has one (dark) design and no prefers-color-scheme rules; both
 * schemes are still audited so that adding a light theme later cannot ship
 * unchecked. The signed-in pages are audited too, with a session signed
 * locally (e2e/session.ts), but never @live: the live check does not sign in.
 */
import { test, expect } from '@playwright/test';
import { audit, scrollThrough } from './helpers';
import { sessionCookie } from './session';

for (const scheme of ['light', 'dark'] as const) {
  test(`@live the home page meets WCAG 2.2 AA (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await scrollThrough(page);
    await audit(page);
  });
}

test('@live the home page with the refused-sign-in message meets WCAG 2.2 AA', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?auth_error=1');
  await expect(page.locator('#refresh-message')).toContainText('not allowed');
  await audit(page);
});

test('@live the public files page meets WCAG 2.2 AA', async ({ page }) => {
  await page.goto('/public');
  await audit(page);
});

test('@live the 404 page meets WCAG 2.2 AA', async ({ page }) => {
  await page.goto('/does-not-exist');
  await audit(page);
});

test('@live every picture has a text alternative and every control a name', async ({ page }) => {
  await page.goto('/');
  const missing = await page.evaluate(() => [
    ...Array.from(document.images)
      .filter((i) => i.getAttribute('alt') === null)
      .map((i) => `img ${i.currentSrc || i.src}`),
    ...Array.from(document.querySelectorAll('a, button'))
      .filter(
        (el) =>
          !(
            el.getAttribute('aria-label') ||
            (el as HTMLElement).innerText ||
            Array.from(el.querySelectorAll('img')).map((i) => i.alt).join('') ||
            ''
          ).trim(),
      )
      .map((el) => `${el.tagName.toLowerCase()} ${el.outerHTML.slice(0, 80)}`),
  ]);
  expect(missing).toEqual([]);
});

test.describe('signed in', () => {
  test.skip(!process.env.COOKIE_SECRET, 'needs the server\'s COOKIE_SECRET (set in production-checks.yml)');
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(baseURL!)]);
  });

  for (const path of ['/', '/dashboard', '/dashboard/ip-survey']) {
    test(`${path} meets WCAG 2.2 AA when signed in`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await audit(page);
    });
  }
});
