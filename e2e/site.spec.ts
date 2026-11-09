/**
 * The public site, walked signed out, as a visitor walks it. Tests tagged
 * @live are read-only (GET only, never a sign-in) and run twice: before a
 * release against the image the release will ship (production-checks.yml),
 * and after it against https://www.klaushofrichter.net (live-check.yml).
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { watchProblems, reportCspViolations, scrollThrough, expectAllPicturesLoaded } from './helpers';
import { links } from '../src/links';

/** Set by live-check.yml to the release just deployed. */
const EXPECT_VERSION = process.env.EXPECT_VERSION;

const publicLinks = links.filter((l) => !l.requiresAuth);

async function press(page: Page, isMobile: boolean, locator: Locator) {
  if (isMobile) await locator.tap();
  else await locator.click();
}

test('@live /health is ok and names the release the header shows', async ({ page, request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.service).toBe('www-klaushofrichter');
  if (EXPECT_VERSION) expect(body.version).toBe(EXPECT_VERSION);
  await page.goto('/');
  await expect(page.locator('#app-version')).toHaveText(body.version);
});

test('@live the home page loads completely, every card picture included', async ({ page }) => {
  const problems = watchProblems(page);
  await reportCspViolations(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Klaus Hofrichter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Klaus Hofrichter');
  // One card per public link, each with a title, an abstract and a picture.
  const cards = page.locator('main .card');
  await expect(cards).toHaveCount(publicLinks.length);
  for (const card of await cards.all()) {
    await expect(card.locator('h2')).not.toBeEmpty();
    await expect(card.locator('p')).not.toBeEmpty();
    await expect(card.locator('img')).toHaveCount(1);
  }
  await scrollThrough(page);
  await expectAllPicturesLoaded(page);
  expect(problems).toEqual([]);
});

test('@live every link on the page goes somewhere that works', async ({ page, request, baseURL }) => {
  // Walks whatever the page links to, so a card or sub-page added later is
  // covered without touching this test. Third-party targets are not ours to
  // test (and some refuse robots), so they are only checked for shape.
  await page.goto('/');
  const anchors = await page.locator('a[href]').evaluateAll((as) =>
    as.map((a) => ({ href: a.getAttribute('href')!, target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })),
  );
  expect(anchors.length).toBeGreaterThan(publicLinks.length);
  const origin = new URL(baseURL!).origin;
  const seen = new Set<string>();

  for (const { href, target, rel } of anchors) {
    if (seen.has(href)) continue;
    seen.add(href);
    if (href.startsWith('#')) {
      await expect(page.locator(href), `anchor ${href}`).toHaveCount(1);
      continue;
    }
    const url = new URL(href, origin);
    if (url.origin !== origin) {
      expect(url.protocol, href).toBe('https:');
      // Opened in a new tab without handing the target a window.opener.
      expect(target, href).toBe('_blank');
      expect(rel, href).toContain('noopener');
      continue;
    }
    if (url.pathname === '/auth/google/login') {
      // The way in, not a page: it must hand over to Google, and this test
      // goes no further (nothing @live may sign in).
      const res = await request.get(url.href, { maxRedirects: 0 });
      expect(res.status(), href).toBe(302);
      expect(new URL(res.headers()['location']).host, href).toBe('accounts.google.com');
      continue;
    }
    if (/\.(png|webp|jpe?g|svg|ico)$/.test(url.pathname)) {
      const res = await request.get(url.href);
      expect(res.status(), url.pathname).toBe(200);
      expect(res.headers()['content-type'], url.pathname).toMatch(/^image\//);
      continue;
    }
    // A same-site page: visit it like a person would.
    const sub = await page.context().newPage();
    const problems = watchProblems(sub);
    const res = await sub.goto(url.href);
    expect(res?.status(), url.pathname).toBe(200);
    await expect(sub.getByRole('heading', { level: 1 }), url.pathname).toBeVisible();
    await scrollThrough(sub);
    await expectAllPicturesLoaded(sub);
    expect(problems, url.pathname).toEqual([]);
    await sub.close();
  }
});

test('@live the public files page lists downloads that work and leads home', async ({ page, request, isMobile }) => {
  // Not linked from the home page (it is handed out directly), so the link
  // walk above does not reach it.
  const problems = watchProblems(page);
  const response = await page.goto('/public');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Public files');
  const files = await page.locator('main li a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  expect(files.length).toBeGreaterThan(0);
  for (const href of files) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    expect((await res.body()).length, href).toBeGreaterThan(0);
  }
  await press(page, isMobile, page.getByRole('link', { name: /Back to/ }));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Klaus Hofrichter');
  expect(problems).toEqual([]);
});

test('@live an unknown page is a 404 with a way home', async ({ page, isMobile }) => {
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await press(page, isMobile, page.getByRole('link', { name: /home/i }));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main .card').first()).toBeVisible();
});

test('@live a refused sign-in is announced, then the address is cleaned up', async ({ page }) => {
  // What the OAuth callback sends a visitor to when their account is not
  // allowed. Reached here by GET alone: no sign-in happens.
  const problems = watchProblems(page);
  await page.goto('/?auth_error=1');
  const message = page.locator('#refresh-message');
  await expect(message).toHaveRole('status');
  await expect(message).toContainText('not allowed');
  await expect(page).toHaveURL(/\/$/);
  expect(problems).toEqual([]);
});

test('@live a card opens its site in a new tab', async ({ page, context, isMobile }) => {
  // Answered locally: the click is what is under test, not the third party.
  await context.route(/^https:\/\/(?!www\.klaushofrichter\.net)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  await page.goto('/');
  const first = publicLinks[0];
  for (const which of ['.card-image', '.card-link']) {
    const link = page.locator(`main .card ${which}[href="${first.url}"]`);
    const [popup] = await Promise.all([page.waitForEvent('popup'), press(page, isMobile, link)]);
    await expect(popup).toHaveURL(first.url);
    await popup.close();
  }
});

test.describe('keyboard', () => {
  test('Tab reaches Login, then every card in order, with a visible focus ring', async ({ page, isMobile }) => {
    test.skip(isMobile, 'no keyboard on a phone');
    await page.goto('/');
    const order: string[] = [];
    // Two links per card (picture and text link) plus Login.
    for (let i = 0; i < publicLinks.length * 2 + 1; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        return { href: el.getAttribute('href') ?? '', ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 };
      });
      expect(focused.ring, `focus ring on ${focused.href}`).toBe(true);
      order.push(focused.href);
    }
    expect(order[0]).toBe('/auth/google/login');
    const cardOrder = [...new Set(order.slice(1))];
    expect(cardOrder).toEqual(publicLinks.map((l) => l.url));
  });
});

test.describe('on a phone', () => {
  test('fits without sideways scrolling, and every card fits the screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone projects only');
    await page.goto('/');
    await scrollThrough(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const vp = page.viewportSize()!;
    for (const card of await page.locator('main .card').all()) {
      const b = (await card.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
    }
  });
});
