# Klaus Hofrichter Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current placeholder page in `www-klaushofrichter` with a real personal homepage: an about section, a responsive grid of link cards (each with a daily-refreshed hero image fetched from the target site's `og:image`), and a footer — served by the existing Express app, same repo/pipeline.

**Architecture:** Extend the existing Express/TypeScript app with a static link config, an `og:image` fetch/download module, a refresh orchestrator (run at startup + daily via `node-cron`), a server-rendered HTML page (dark glassmorphism style), and routes to serve the downloaded images and trigger an on-demand refresh. No new services, no headless browser, no persistent storage — ephemeral local disk, re-populated on every container start.

**Tech Stack:** Node 20, TypeScript, Express 4 (existing), `cheerio` (HTML parsing for `og:image`), `node-cron` (daily scheduling), Vitest + Supertest (unit/route tests, existing pattern), Playwright (e2e smoke test, existing pattern).

**Spec:** `docs/superpowers/specs/2026-08-20-homepage-design.md` — this plan implements it section by section; exact values below (URLs, abstracts, gradients, timeouts, cooldown) are copied verbatim from it.

## Global Constraints

- Link list is exactly these 6 entries (id, title, url, abstract, gradient) — see Task 2's table, copied from the spec's "Link list" and "Per-card accent gradient" tables.
- About text and footer text are exact strings from the spec's "Content" section — see Task 5.
- `og:image` fetch timeout: 8000ms. Refresh cooldown for `POST /refresh`: 60000ms (60s). Daily cron schedule: `0 6 * * *`.
- No auth on any route. No persistent storage (PVC/S3) — images live only in `data/images/` on local ephemeral disk, repopulated at every startup.
- `app.ts`'s `createApp()` stays a pure factory with no side effects (no network calls, no cron scheduling) — required so existing tests can call it directly without triggering real fetches. All startup side effects (initial refresh, cron scheduling) belong in `server.ts` only.
- One fixed dark color scheme (no light/dark toggle). Card grid: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` so it reflows to one column on mobile without a separate stylesheet.
- Scrollbar only appears when content overflows (default browser behavior — no extra CSS needed to achieve this) but must be styled to match the dark theme (`::-webkit-scrollbar` + Firefox `scrollbar-color`/`scrollbar-width`).
- Refresh button: small circular icon (⟳), fixed top-right, low default opacity, full opacity on hover.
- The page's own social-preview `og:image` (added mid-plan, not in the original spec doc) is a static, controller-generated 1200x630 PNG at `assets/og-image.png`, referenced via the absolute URL `https://www.klaushofrichter.net/assets/og-image.png` (constant `SITE_URL` in `page.ts`) — distinct from the per-card downloaded images in `data/images/`.
- Favicon (added mid-plan): three static PNGs in `assets/` — `favicon-32x32.png`, `favicon-16x16.png`, `apple-touch-icon.png` — generated from a real photo the user supplied via Google Drive, served through the same `/assets` static mount as `og-image.png`.

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `cheerio` and `node-cron` available as production dependencies for Tasks 3-4; `@types/node-cron` available for TypeScript compilation.

- [ ] **Step 1: Add dependencies to `package.json`**

Add to `"dependencies"` (alphabetical, matching existing style):
```json
    "cheerio": "^1.0.0",
    "express": "^4.19.2",
    "node-cron": "^3.0.3"
```

Add to `"devDependencies"` (alphabetical):
```json
    "@playwright/test": "^1.47.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/node-cron": "^3.0.11",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
```

- [ ] **Step 2: Install and verify**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
npm install
npm test
```
Expected: install succeeds, existing 3 tests still pass (nothing in `src/` has changed yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add cheerio and node-cron dependencies for homepage feature"
```

---

## Task 2: Link config (`src/links.ts`)

**Files:**
- Create: `src/links.ts`

**Interfaces:**
- Produces: `interface Link { id: string; title: string; url: string; abstract: string; gradient: string }` and `export const links: Link[]` — consumed by `views/page.ts` (Task 5), `refreshImages.ts` (Task 4), and route/e2e tests.

- [ ] **Step 1: Write `src/links.ts`**

```typescript
export interface Link {
  id: string;
  title: string;
  url: string;
  abstract: string;
  gradient: string;
}

export const links: Link[] = [
  {
    id: 'linkedin',
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/in/klaushofrichter',
    abstract: 'Professional profile, career history, and updates.',
    gradient: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  },
  {
    id: 'github',
    title: 'GitHub',
    url: 'https://github.com/klaushofrichter',
    abstract: 'Open-source projects, code, and experiments.',
    gradient: 'linear-gradient(135deg, #1f2937, #374151)',
  },
  {
    id: 'portfolio2017',
    title: 'Portfolio 2017',
    url: 'https://klaushofrichter.wordpress.com',
    abstract: 'An earlier portfolio and blog archive.',
    gradient: 'linear-gradient(135deg, #6b7280, #9ca3af)',
  },
  {
    id: 'instagram',
    title: 'Instagram',
    url: 'https://www.instagram.com/klaushofrichter',
    abstract: 'Photos and moments, shared casually.',
    gradient: 'linear-gradient(135deg, #f97316, #ec4899)',
  },
  {
    id: 'threepuppies',
    title: 'Three Puppies',
    url: 'https://three-pups.mystrikingly.com',
    abstract: 'A small site about three very good dogs.',
    gradient: 'linear-gradient(135deg, #059669, #10b981)',
  },
  {
    id: 'medium',
    title: 'Medium',
    url: 'https://medium.com/@klaushofrichter',
    abstract: 'Articles and longer-form writing.',
    gradient: 'linear-gradient(135deg, #000000, #3a3a3a)',
  },
];
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors (this file has no test of its own — it's pure data, exercised indirectly by later tasks' tests).

- [ ] **Step 3: Commit**

```bash
git add src/links.ts
git commit -m "Add homepage link config"
```

---

## Task 3: `og:image` fetch/download (`src/ogImage.ts`)

**Files:**
- Create: `src/ogImage.ts`
- Test: `test/ogImage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses global `fetch`, `cheerio`, `fs`).
- Produces: `fetchOgImage(url: string): Promise<string | null>` and `downloadImage(imageUrl: string, destPath: string): Promise<string | null>` (returns the response's `content-type` on success) — both consumed by `refreshImages.ts` (Task 4). Neither function ever throws — both catch internally and resolve `null` on any failure (network error, timeout, non-2xx, missing tag).

- [ ] **Step 1: Write the failing tests**

`test/ogImage.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchOgImage, downloadImage } from '../src/ogImage';

describe('fetchOgImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the og:image URL when the tag is present', async () => {
    const html = '<html><head><meta property="og:image" content="https://example.com/hero.jpg" /></head></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) })
    );

    const result = await fetchOgImage('https://example.com');

    expect(result).toBe('https://example.com/hero.jpg');
  });

  it('returns null when there is no og:image tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><head></head></html>') })
    );

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }));

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });
});

describe('downloadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the image to destPath and returns the content-type on success', async () => {
    const bytes = new TextEncoder().encode('fake-image-bytes').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/png' : null) },
        arrayBuffer: () => Promise.resolve(bytes),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBe('image/png');
    expect(fs.readFileSync(destPath, 'utf8')).toBe('fake-image-bytes');
    fs.unlinkSync(destPath);
  });

  it('returns null on a non-2xx response and does not write a file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const destPath = path.join(os.tmpdir(), `ogimage-test-missing-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- ogImage
```
Expected: FAIL — `src/ogImage.ts` does not exist yet.

- [ ] **Step 3: Implement `src/ogImage.ts`**

```typescript
import fs from 'fs';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (compatible; www-klaushofrichter-bot/1.0; +https://www.klaushofrichter.net)';
const FETCH_TIMEOUT_MS = 8000;

export async function fetchOgImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = cheerio.load(html);
    const content = $('meta[property="og:image"]').attr('content');
    return content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadImage(imageUrl: string, destPath: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);
    return contentType;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- ogImage
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ogImage.ts test/ogImage.test.ts
git commit -m "Add og:image fetch and download"
```

---

## Task 4: Refresh orchestration (`src/refreshImages.ts`)

**Files:**
- Create: `src/refreshImages.ts`
- Test: `test/refreshImages.test.ts`

**Interfaces:**
- Consumes: `links` from `src/links.ts` (Task 2); `fetchOgImage`, `downloadImage` from `src/ogImage.ts` (Task 3).
- Produces: `refreshAllImages(): Promise<void>`, `scheduleDailyRefresh(): void`, `hasImage(id: string): boolean`, `imagePath(id: string): string`, `getImageContentType(id: string): string | undefined` — all consumed by `views/page.ts` (Task 5), `routes/images.ts` (Task 6), `routes/index.ts` (Task 7), and `server.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

`test/refreshImages.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ogImage', () => ({
  fetchOgImage: vi.fn(),
  downloadImage: vi.fn(),
}));

import { fetchOgImage, downloadImage } from '../src/ogImage';
import { refreshAllImages, hasImage, getImageContentType, imagePath } from '../src/refreshImages';

const mockedFetchOgImage = vi.mocked(fetchOgImage);
const mockedDownloadImage = vi.mocked(downloadImage);

describe('refreshAllImages', () => {
  beforeEach(() => {
    mockedFetchOgImage.mockReset();
    mockedDownloadImage.mockReset();
  });

  it('downloads an image for every link that has an og:image', async () => {
    mockedFetchOgImage.mockResolvedValue('https://example.com/hero.jpg');
    mockedDownloadImage.mockResolvedValue('image/jpeg');

    await refreshAllImages();

    expect(mockedFetchOgImage).toHaveBeenCalledTimes(6);
    expect(mockedDownloadImage).toHaveBeenCalledTimes(6);
    expect(hasImage('linkedin')).toBe(true);
    expect(getImageContentType('linkedin')).toBe('image/jpeg');
  });

  it('leaves a link without an image if its fetch fails, without affecting others', async () => {
    mockedFetchOgImage.mockImplementation((url: string) =>
      url.includes('linkedin') ? Promise.resolve(null) : Promise.resolve('https://example.com/hero.jpg')
    );
    mockedDownloadImage.mockResolvedValue('image/jpeg');

    await refreshAllImages();

    expect(hasImage('linkedin')).toBe(false);
    expect(getImageContentType('linkedin')).toBeUndefined();
    expect(hasImage('github')).toBe(true);
  });

  it('imagePath returns a path inside the images directory', () => {
    expect(imagePath('linkedin')).toContain('data');
    expect(imagePath('linkedin')).toContain('images');
    expect(imagePath('linkedin')).toContain('linkedin');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- refreshImages
```
Expected: FAIL — `src/refreshImages.ts` does not exist yet.

- [ ] **Step 3: Implement `src/refreshImages.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { links } from './links';
import { fetchOgImage, downloadImage } from './ogImage';

export const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const DAILY_CRON_SCHEDULE = '0 6 * * *';

const imageContentTypes = new Map<string, string>();

export function imagePath(id: string): string {
  return path.join(IMAGES_DIR, id);
}

export function hasImage(id: string): boolean {
  return imageContentTypes.has(id);
}

export function getImageContentType(id: string): string | undefined {
  return imageContentTypes.get(id);
}

async function refreshOne(id: string, url: string): Promise<void> {
  const ogImageUrl = await fetchOgImage(url);
  if (!ogImageUrl) {
    imageContentTypes.delete(id);
    return;
  }
  const contentType = await downloadImage(ogImageUrl, imagePath(id));
  if (contentType) {
    imageContentTypes.set(id, contentType);
  } else {
    imageContentTypes.delete(id);
  }
}

export async function refreshAllImages(): Promise<void> {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  await Promise.all(links.map((link) => refreshOne(link.id, link.url)));
}

export function scheduleDailyRefresh(): void {
  cron.schedule(DAILY_CRON_SCHEDULE, () => {
    refreshAllImages().catch((err) => {
      console.error('Daily image refresh failed', err);
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- refreshImages
```
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/refreshImages.ts test/refreshImages.test.ts
git commit -m "Add image refresh orchestration and daily cron scheduling"
```

---

## Task 5: Page rendering (`src/views/page.ts`)

**Files:**
- Create: `src/views/page.ts`

**Interfaces:**
- Consumes: `links` from `src/links.ts` (Task 2); `hasImage` from `src/refreshImages.ts` (Task 4).
- Produces: `renderPage(): string` — consumed by `routes/index.ts` (Task 7) and exercised indirectly by its route tests.

- [ ] **Step 1: Write `src/views/page.ts`**

```typescript
import { links, Link } from '../links';
import { hasImage } from '../refreshImages';

const ABOUT_TITLE = 'Klaus Hofrichter';
const ABOUT_BODY =
  'Engineer, tinkerer, and occasional puppy photographer. This page collects the places you can find me online — from professional profiles to side projects and creative work.';
const FOOTER_TEXT = 'Contact: klaus@klaushofrichter.net';
const SITE_URL = 'https://www.klaushofrichter.net';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function renderCard(link: Link): string {
  const imageMarkup = hasImage(link.id)
    ? `<img src="/images/${link.id}" alt="${escapeHtml(link.title)}" class="card-image-img" />`
    : '';
  return `
        <div class="card">
          <div class="card-image" style="background: ${link.gradient};">${imageMarkup}</div>
          <div class="card-body">
            <h3>${escapeHtml(link.title)}</h3>
            <p>${escapeHtml(link.abstract)}</p>
            <a class="card-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl(link.url))} →</a>
          </div>
        </div>`;
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  html { scrollbar-width: thin; scrollbar-color: #4b4a78 #16142b; }
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-track { background: #16142b; }
  ::-webkit-scrollbar-thumb { background: #4b4a78; border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: #5f5d99; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(160deg, #0f0c29, #1b1740, #24243e);
    color: #eef0fb;
    min-height: 100vh;
  }
  .page { padding: 40px 24px; }
  .about { max-width: 640px; margin: 0 auto 40px; text-align: center; }
  .about-avatar {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    margin: 0 auto 16px;
  }
  .about h1 { font-size: 26px; margin: 0 0 10px; }
  .about p { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px;
    max-width: 960px;
    margin: 0 auto;
  }
  .card {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    overflow: hidden;
  }
  .card-image { height: 110px; display: flex; align-items: center; justify-content: center; }
  .card-image-img { width: 100%; height: 100%; object-fit: cover; }
  .card-body { padding: 14px; }
  .card-body h3 { margin: 0; font-size: 14px; }
  .card-body p { font-size: 12px; opacity: 0.7; margin: 5px 0 0; }
  .card-link { display: inline-block; margin-top: 10px; font-size: 11px; color: #93a5fd; text-decoration: none; }
  .card-link:hover { text-decoration: underline; }
  .site-footer {
    max-width: 960px; margin: 48px auto 0; padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.1);
    text-align: center; font-size: 12px; opacity: 0.6;
  }
  #refresh-button {
    position: fixed; top: 16px; right: 16px;
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 16px; cursor: pointer;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #refresh-button:hover { opacity: 1; }
  #refresh-button.loading { animation: spin 1s linear infinite; opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #refresh-message {
    position: fixed; top: 58px; right: 16px;
    font-size: 11px; background: rgba(0,0,0,0.6); padding: 6px 10px; border-radius: 6px;
    opacity: 0; transition: opacity 0.2s; pointer-events: none;
  }
  #refresh-message.visible { opacity: 1; }
`;

const REFRESH_SCRIPT = `
  (function () {
    var button = document.getElementById('refresh-button');
    var message = document.getElementById('refresh-message');
    function showMessage(text) {
      message.textContent = text;
      message.classList.add('visible');
      setTimeout(function () { message.classList.remove('visible'); }, 4000);
    }
    button.addEventListener('click', function () {
      if (button.classList.contains('loading')) return;
      button.classList.add('loading');
      fetch('/refresh', { method: 'POST' })
        .then(function (response) {
          if (response.ok) {
            window.location.reload();
            return;
          }
          showMessage(response.status === 429 ? 'Please wait a bit before refreshing again.' : 'Refresh failed.');
          button.classList.remove('loading');
        })
        .catch(function () {
          showMessage('Refresh failed.');
          button.classList.remove('loading');
        });
    });
  })();
`;

export function renderPage(): string {
  const cards = links.map(renderCard).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Klaus Hofrichter</title>
    <meta property="og:title" content="Klaus Hofrichter" />
    <meta property="og:description" content="${escapeHtml(ABOUT_BODY)}" />
    <meta property="og:image" content="${SITE_URL}/assets/og-image.png" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:type" content="website" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>
    <div id="refresh-message"></div>
    <div class="page">
      <header class="about">
        <div class="about-avatar"></div>
        <h1>${escapeHtml(ABOUT_TITLE)}</h1>
        <p>${escapeHtml(ABOUT_BODY)}</p>
      </header>
      <main class="cards">${cards}
      </main>
      <footer class="site-footer">${escapeHtml(FOOTER_TEXT)}</footer>
    </div>
    <script>${REFRESH_SCRIPT}</script>
  </body>
</html>`;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors. (Rendering itself is exercised by Task 7's route tests, since `renderPage` has no side effects of its own to unit-test beyond what those tests already cover.)

- [ ] **Step 3: Commit**

```bash
git add src/views/page.ts
git commit -m "Add homepage page rendering"
```

---

## Task 6: Image-serving route (`src/routes/images.ts`)

**Files:**
- Create: `src/routes/images.ts`
- Test: `test/images.test.ts`

**Interfaces:**
- Consumes: `imagePath`, `getImageContentType` from `src/refreshImages.ts` (Task 4).
- Produces: `imagesRouter` (Express `Router`) — consumed by `app.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

`test/images.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /images/:id', () => {
  it('returns 404 for an id with no downloaded image', async () => {
    const app = createApp();
    const response = await request(app).get('/images/linkedin');

    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const app = createApp();
    const response = await request(app).get('/images/not-a-real-link');

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- images
```
Expected: FAIL — `src/routes/images.ts` (and `src/app.ts` wiring it in) don't exist yet. (`src/app.ts` is modified in Task 7; this test will keep failing until then — that's expected and fine, move on to Step 3.)

- [ ] **Step 3: Implement `src/routes/images.ts`**

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs';
import { imagePath, getImageContentType } from '../refreshImages';

export const imagesRouter = Router();

// getImageContentType(id) only ever returns a value for ids that
// refreshAllImages() itself set, using the controlled ids from links.ts -
// so an unknown/malicious :id param always misses here and 404s before
// any filesystem path is touched. No separate path-traversal check needed.
imagesRouter.get('/images/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const contentType = getImageContentType(id);
  const filePath = imagePath(id);
  if (!contentType || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.status(200).type(contentType).sendFile(filePath);
});
```

- [ ] **Step 4: Leave the test failing for now** — it needs `app.ts` from Task 7 to wire `imagesRouter` in before it can pass. Proceed to Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/routes/images.ts test/images.test.ts
git commit -m "Add image-serving route"
```

---

## Task 7: Index route, refresh endpoint, and app wiring

**Files:**
- Modify: `src/routes/index.ts`
- Modify: `src/app.ts`
- Test: `test/index.test.ts` (replace existing content entirely)
- Delete: `public/index.html`

**Interfaces:**
- Consumes: `renderPage` from `src/views/page.ts` (Task 5); `refreshAllImages` from `src/refreshImages.ts` (Task 4); `imagesRouter` from `src/routes/images.ts` (Task 6); `healthRouter` (existing, unchanged).
- Produces: `createApp(): Express` (unchanged signature) — now wires `healthRouter`, `imagesRouter`, and `indexRouter` (`GET /`, `POST /refresh`) instead of `express.static`.

- [ ] **Step 1: Write the failing tests**

Replace `test/index.test.ts` entirely with:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/refreshImages', () => ({
  refreshAllImages: vi.fn().mockResolvedValue(undefined),
  scheduleDailyRefresh: vi.fn(),
  hasImage: vi.fn().mockReturnValue(false),
  imagePath: vi.fn((id: string) => `/tmp/${id}`),
  getImageContentType: vi.fn().mockReturnValue(undefined),
}));

import { refreshAllImages } from '../src/refreshImages';
import { createApp } from '../src/app';

const mockedRefreshAllImages = vi.mocked(refreshAllImages);

describe('GET /', () => {
  it('renders the about section, all 6 card titles, and the footer', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Klaus Hofrichter');
    expect(response.text).toContain('LinkedIn');
    expect(response.text).toContain('GitHub');
    expect(response.text).toContain('Portfolio 2017');
    expect(response.text).toContain('Instagram');
    expect(response.text).toContain('Three Puppies');
    expect(response.text).toContain('Medium');
    expect(response.text).toContain('Contact: klaus@klaushofrichter.net');
  });
});

describe('POST /refresh', () => {
  beforeEach(() => {
    mockedRefreshAllImages.mockClear();
  });

  it('triggers a refresh and returns 200 on the first call', async () => {
    const app = createApp();
    const response = await request(app).post('/refresh');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(mockedRefreshAllImages).toHaveBeenCalledTimes(1);
  });

  it('returns 429 and does not refresh again within the cooldown', async () => {
    const app = createApp();
    await request(app).post('/refresh');
    mockedRefreshAllImages.mockClear();

    const response = await request(app).post('/refresh');

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'cooldown' });
    expect(mockedRefreshAllImages).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- index
```
Expected: FAIL — `routes/index.ts` still serves the old placeholder-era content.

- [ ] **Step 3: Rewrite `src/routes/index.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { renderPage } from '../views/page';
import { refreshAllImages } from '../refreshImages';

export const indexRouter = Router();

const REFRESH_COOLDOWN_MS = 60_000;
let lastRefresh = 0;

indexRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).type('html').send(renderPage());
});

indexRouter.post('/refresh', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
    res.status(429).json({ error: 'cooldown' });
    return;
  }
  lastRefresh = now;
  await refreshAllImages();
  res.status(200).json({ status: 'ok' });
});
```

- [ ] **Step 4: Rewrite `src/app.ts`**

```typescript
import express, { Express } from 'express';
import path from 'path';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';

export function createApp(): Express {
  const app = express();
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(indexRouter);
  return app;
}
```

`assets/` holds only the build-time-baked `og-image.png` (generated once,
committed to the repo — see Task 9) — unlike `data/images/`, it's static
content shipped in the image, not runtime-downloaded, so plain
`express.static` is the right tool here (contrast with the deleted
`public/` directory, which used to hold the whole page and is now fully
server-rendered instead).

- [ ] **Step 5: Delete the old static placeholder**

```bash
git rm public/index.html
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
npm test
```
Expected: PASS — all tests across `health.test.ts`, `ogImage.test.ts`, `refreshImages.test.ts`, `images.test.ts`, `index.test.ts` (this is also when Task 6's `images.test.ts` starts passing, now that `app.ts` wires `imagesRouter` in).

- [ ] **Step 7: Commit**

```bash
git add src/routes/index.ts src/app.ts test/index.test.ts
git commit -m "Serve the homepage from GET / with a POST /refresh endpoint"
```

---

## Task 8: Server startup wiring

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `refreshAllImages`, `scheduleDailyRefresh` from `src/refreshImages.ts` (Task 4); `createApp` from `src/app.ts` (Task 7, unchanged signature).
- Produces: the running server — no exports consumed elsewhere (entrypoint only, matches the existing pattern where `server.ts` has no dedicated test).

- [ ] **Step 1: Rewrite `src/server.ts`**

```typescript
import { createApp } from './app';
import { refreshAllImages, scheduleDailyRefresh } from './refreshImages';

const port = Number(process.env.PORT) || 8080;

async function start(): Promise<void> {
  await refreshAllImages();
  scheduleDailyRefresh();
  const app = createApp();
  app.listen(port, () => {
    console.log(`www-klaushofrichter listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors.

- [ ] **Step 3: Manual smoke check against a real startup** (this is the first point in the plan where the app actually runs end-to-end with real network calls)

```bash
npm run build
PORT=8080 node dist/server.js &
SERVER_PID=$!
sleep 5
curl -s http://localhost:8080/health
echo
curl -s http://localhost:8080/ | grep -o 'Klaus Hofrichter' | head -1
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/images/linkedin
curl -s -X POST http://localhost:8080/refresh
echo
kill $SERVER_PID
```
Expected: `/health` returns the JSON body; `/` contains "Klaus Hofrichter"; `/images/linkedin` returns `200` if LinkedIn's `og:image` was fetchable or `404` if blocked (either is an acceptable real-world outcome per the spec's fallback design — do not treat a 404 here as a failure); `/refresh` returns `{"status":"ok"}` (a second immediate `POST /refresh` would 429, not tested here since the process is about to be killed anyway).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "Wire startup image refresh and daily cron scheduling into server.ts"
```

---

## Task 9: Dockerfile, dockerignore, gitignore updates

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing new — packages the app built in Tasks 1-8.
- Produces: a container image with a writable `/app/data/images` directory for the `node` user, no longer bundling the deleted `public/` directory.

- [ ] **Step 1: Update `Dockerfile`**

Replace:
```dockerfile
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY CHANGELOG.md ./
USER node
```
with:
```dockerfile
COPY --from=builder /app/dist ./dist
COPY CHANGELOG.md ./
COPY assets ./assets
RUN mkdir -p /app/data/images && chown -R node:node /app/data
USER node
```

`assets/og-image.png` was generated once during design work and is already
committed to the repo at this point in the plan (controller-generated,
matches the site's dark glassmorphism style, referenced by `og:image` in
Task 5) — this step just needs to ship the existing `assets/` directory
into the image, not create it.

- [ ] **Step 2: Add `data/` to `.gitignore`**

Add a line to `.gitignore`:
```
data/
```

- [ ] **Step 3: Add `data` to `.dockerignore`**

Add a line to `.dockerignore` (it's runtime-only and never present at build time, but this documents intent and guards against an accidental local `data/` directory bloating the build context):
```
data
```

- [ ] **Step 4: Build and smoke-test the image locally**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
docker build -t www-klaushofrichter:local .
docker run --rm -p 8080:8080 -d --name www-klaushofrichter-smoke www-klaushofrichter:local
sleep 5
curl -sf http://localhost:8080/health
echo
curl -s http://localhost:8080/ | grep -o 'Klaus Hofrichter' | head -1
docker exec www-klaushofrichter-smoke ls -ld /app/data/images
docker stop www-klaushofrichter-smoke
```
Expected: `/health` returns the JSON body, `/` contains "Klaus Hofrichter", and `ls -ld` shows `/app/data/images` owned by `node`, confirming the container can write downloaded images without a permissions error.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .gitignore .dockerignore
git commit -m "Update Dockerfile for the homepage feature (drop public/, add writable data dir)"
```

---

## Task 10: Update the Playwright e2e smoke test

**Files:**
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the live running app (via `BASE_URL`, unchanged mechanism from the existing `playwright.config.ts`).
- Produces: nothing consumed elsewhere — this is the deploy-gating smoke test itself.

- [ ] **Step 1: Rewrite `e2e/smoke.spec.ts`**

```typescript
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
```

- [ ] **Step 2: Run it locally against the Docker container from Task 9** (start a fresh one if the previous was stopped)

```bash
docker run --rm -p 8080:8080 -d --name www-klaushofrichter-e2e www-klaushofrichter:local
sleep 5
npx playwright install --with-deps chromium
BASE_URL=http://localhost:8080 npm run test:e2e
docker stop www-klaushofrichter-e2e
```
Expected: both tests pass (2 passed).

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "Update e2e smoke test for the homepage content"
```

---

## Task 11: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `README.md`**

Replace the `## API` section:
```markdown
## API

- `GET /` — the homepage: an about section, a responsive grid of link
  cards (each with a title, short abstract, and hero image fetched from
  the target site's `og:image` where available), and a footer.
- `GET /images/:id` — serves a downloaded hero image; `404` if none was
  successfully fetched for that id.
- `POST /refresh` — re-fetches all hero images on demand (also the small
  ⟳ button in the page's top-right corner). Subject to a 60-second
  cooldown; returns `429` if called again too soon.
- `GET /health` — returns `{"status": "ok", "service": "www-klaushofrichter"}`
```

Replace the top summary paragraph:
```markdown
# www-klaushofrichter

Personal homepage for Klaus Hofrichter, served at
[www.klaushofrichter.net](https://www.klaushofrichter.net) — an about
section plus a grid of links to LinkedIn, GitHub, past portfolio/blog work,
Instagram, and Medium, each with a hero image kept fresh via a daily
background refresh (see "Image refresh" below).
```

Add a new section after `## Development`:
```markdown
## Image refresh

Each card's hero image comes from the target URL's `og:image` meta tag,
downloaded to local disk on container startup and re-fetched once a day
(06:00 UTC) via an in-process `node-cron` job — no persistent storage, no
separate CronJob resource; images just repopulate on every restart. A
link whose `og:image` can't be fetched (LinkedIn and Instagram commonly
block non-browser requests) falls back to a plain gradient card instead
of a broken image. See `docs/superpowers/specs/2026-08-20-homepage-design.md`
for the full design.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the "What this is" paragraph:
```markdown
## What this is

Klaus Hofrichter's personal homepage — an Express/TypeScript app that
server-renders an about section, a grid of link cards (each with a
daily-refreshed hero image from the target site's `og:image`), and a
footer. Deployed as a Knative Service on the `kube-setup`-managed k3s
cluster (see `../kube-setup/CLAUDE.md` for cluster-wide context). Design
rationale lives in `docs/superpowers/specs/2026-08-20-homepage-design.md`.
```

- [ ] **Step 3: Add a `CHANGELOG.md` entry**

Add a new dated section above the existing `## 2026-08-20` entry (use today's actual date when implementing):
```markdown
## Unreleased

### Added

- Replaced the placeholder static page with the real homepage: about
  section, responsive card grid (LinkedIn, GitHub, Portfolio 2017,
  Instagram, Three Puppies, Medium), each card showing a hero image
  fetched from the target site's `og:image` and refreshed daily via an
  in-process cron job (also triggerable on demand via the page's ⟳
  button / `POST /refresh`).
- `GET /images/:id` route to serve downloaded hero images.

```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md CHANGELOG.md
git commit -m "Update documentation for the homepage feature"
```

---

## Task 12: Deploy and verify

**Files:** none — this task ships the branch through the existing pipeline.

- [ ] **Step 1: Push, open a PR from `main` to `production`, confirm checks pass**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
git push
gh pr create --repo klaushofrichter/www-klaushofrichter --base production --head main \
  --title "Replace placeholder with the real homepage" \
  --body "Implements docs/superpowers/specs/2026-08-20-homepage-design.md: about section, card grid with daily-refreshed og:image hero images, manual refresh button."
gh pr checks --repo klaushofrichter/www-klaushofrichter --watch
```
Expected: `test` and `codeql` checks both pass.

- [ ] **Step 2: Merge and watch the deploy**

```bash
gh pr merge --repo klaushofrichter/www-klaushofrichter --merge
```
Then watch the triggered `deploy-production.yml` run to completion (`gh run list --workflow=deploy-production.yml --limit 1`, then `gh run view <id> --json status,conclusion` until `completed`/`success`) — this run's own Playwright smoke test against `https://www.klaushofrichter.net` is the real end-to-end gate.

- [ ] **Step 3: Manually verify the live site**

```bash
curl -s https://www.klaushofrichter.net/health
echo
curl -s https://www.klaushofrichter.net/ | grep -o 'Klaus Hofrichter' | head -1
```
Also open `https://www.klaushofrichter.net` in a browser (or note for the user to) to visually confirm the card grid, image fallbacks for any blocked sites (LinkedIn/Instagram expected), the refresh button, and mobile responsiveness (resize the window).
