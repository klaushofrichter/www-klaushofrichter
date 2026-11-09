/**
 * Qualities that are easy to lose without noticing: the page does not jump
 * while loading, every card holds its place before its picture arrives, a
 * phone fetches little, nothing errors along the way, and the page is
 * complete without JavaScript. Signed out throughout.
 */
import { test, expect } from '@playwright/test';
import { watchProblems, reportCspViolations, scrollThrough, expectAllPicturesLoaded } from './helpers';
import { links } from '../src/links';

const publicLinks = links.filter((l) => !l.requiresAuth);

test('@live nothing jumps while the page loads (layout shift)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await scrollThrough(page);
  await expectAllPicturesLoaded(page);
  // Only Chromium reports layout shifts; elsewhere this reads 0, which is why
  // the next test exists.
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.02);
});

test('every card holds its place before its picture arrives', async ({ page }) => {
  // Hold back every card picture, as a slow network would. Each must already
  // take the box it will fill: an unsized lazy picture takes no space in
  // Firefox and Safari until it loads, and the page grows under the reader.
  await page.route('**/assets/cards/**', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const boxes = await page.locator('main .card .card-image').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  expect(boxes).toHaveLength(publicLinks.length);
  for (const h of boxes) expect(h).toBeGreaterThanOrEqual(100);
  const imgs = await page.locator('main .card img').evaluateAll((els) =>
    els.map((img) => ({ h: img.getBoundingClientRect().height, w: img.getAttribute('width'), hh: img.getAttribute('height') })),
  );
  for (const i of imgs) {
    expect(i.h).toBeGreaterThanOrEqual(100);
    expect(Number(i.w)).toBeGreaterThan(0);
    expect(Number(i.hh)).toBeGreaterThan(0);
  }
});

test('a phone fetches little text and pictures no larger than it needs', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone projects only');
  await page.goto('/', { waitUntil: 'load' });
  await scrollThrough(page);
  await expectAllPicturesLoaded(page);
  const entries = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .concat(performance.getEntriesByType('navigation'))
      .map((e) => ({ url: e.name.replace(location.origin, ''), bytes: (e as PerformanceResourceTiming).encodedBodySize })),
  );
  // The page with its inline style and script, compressed: about 5 KB.
  const text = entries.filter((e) => !/\.(webp|png|svg|ico|jpe?g)$/.test(e.url));
  expect(text.reduce((n, e) => n + e.bytes, 0)).toBeLessThan(20_000);

  // Each card picture at the width the screen needs, never more than about
  // twice that: drawn width times the pixel ratio, against the file chosen.
  const drawn = await page.locator('main .card img').evaluateAll((imgs) =>
    imgs.map((img) => ({
      url: (img as HTMLImageElement).currentSrc,
      file: (img as HTMLImageElement).naturalWidth,
      need: img.getBoundingClientRect().width * devicePixelRatio,
    })),
  );
  for (const d of drawn) {
    expect(d.file, `${d.url} for ${Math.round(d.need)}px`).toBeLessThanOrEqual(Math.max(d.need * 2, 480));
  }
  // All pictures together: about 300 KB today for the public cards.
  const pictures = entries.filter((e) => /\.(webp|png|jpe?g)$/.test(e.url));
  expect(pictures.reduce((n, e) => n + e.bytes, 0)).toBeLessThan(600_000);
});

test('@live no console errors or CSP violations through a full visit', async ({ page }) => {
  const problems = watchProblems(page);
  await reportCspViolations(page);
  for (const path of ['/', '/?auth_error=1', '/public']) {
    await page.goto(path);
    await scrollThrough(page);
  }
  expect(problems).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every card and its picture is still there', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const cards = page.locator('main .card');
    await expect(cards).toHaveCount(publicLinks.length);
    for (const img of await page.locator('main .card img').all()) {
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      const src = (await img.getAttribute('src'))!;
      expect((await request.get(src)).status(), src).toBe(200);
    }
  });
});
