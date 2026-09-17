# Dashboard and IP Survey (website half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a signed-in Dashboard with an IP Survey page — sortable device table, per-device Details modal, Save to a PVC, and new/gone comparison — working end to end against a fake scanner.

**Architecture:** Server-rendered Express pages guarded by a `requireAuth` middleware. A `scannerClient` talks to the scanner over HTTP with a bearer token; the website stores the saved survey as JSON on disk and compares scans server-side. The browser receives one status object (embedded on first load, polled while a scan runs) and only renders and sorts. The real privileged scanner is a separate, later plan; this plan fixes its API as shared TypeScript types and tests against a fake that implements them.

**Tech Stack:** Express 5.2, TypeScript 7 (`module: nodenext`, CommonJS output), Node 26, vitest 5 + supertest, Playwright 1.63, vanilla browser JS (no framework), `tsx` for the fake scanner.

**Spec:** `docs/superpowers/specs/2026-09-17-ip-survey-design.md`

## Global Constraints

- Every `/dashboard*` page uses `requireAuthPage`; every `/api/survey*` route uses `requireAuthApi`. No exceptions.
- A session is valid only if its JWT verifies **and** its email is in `ALLOWED_EMAILS` (comma-separated, exact match).
- Signed-out responses must not contain the Dashboard button markup at all (server-side omission, not CSS).
- Scan range is never taken from a request. The website has no parameter that influences what is scanned.
- Save writes the scanner's finished result; it never reads the request body.
- Saved survey file: `latest.json` in `SURVEY_DIR` (default `<app>/data/surveys`, i.e. `/app/data/surveys` in the image), written atomically (temp file in the same directory, then rename).
- Device data from the LAN is untrusted: the browser inserts it with `textContent`/`createElement` only, never `innerHTML`; links only for `http://`/`https://` URLs, with `rel="noopener noreferrer"`.
- JSON embedded in HTML replaces `<` with `<`.
- Comparison key is MAC address, case-insensitive. With no saved survey, no device is marked *new*.
- Browser script style matches `src/views/page.ts`: an IIFE using `var` and `function`, in a TS string constant. **No backslashes and no backticks inside those script strings** (a template literal would silently rewrite escapes such as `\/`).
- Scanner env: `SCANNER_URL`, `SCANNER_TOKEN`. Unset means "scanner unavailable", which the page must handle.
- Existing element ids stay unchanged: `app-version`, `auth-button`, `refresh-button` (the deploy smoke test greps `id="app-version"`).
- Run `npm run build`, `npm test`, and the Playwright suite before every commit that touches `src/`, `test/` or `e2e/`.

## File map

| File | Responsibility |
|---|---|
| `src/allowedEmails.ts` (new) | Parse `ALLOWED_EMAILS` |
| `src/session.ts` (modify) | Export `SESSION_COOKIE` |
| `src/requireAuth.ts` (new) | `currentUser`, `requireAuthPage`, `requireAuthApi` |
| `src/routes/auth.ts` (modify) | Use shared allow list and cookie name |
| `src/routes/index.ts` (modify) | Use `currentUser` |
| `src/views/layout.ts` (new) | Shared base CSS, header CSS, favicons, `renderHeaderActions` |
| `src/views/page.ts` (modify) | Use `layout.ts`; homepage gets the Dashboard button |
| `src/survey/types.ts` (new) | Website ↔ scanner contract and view types |
| `src/survey/scannerClient.ts` (new) | HTTP client for the scanner |
| `src/survey/store.ts` (new) | Read/write `latest.json` |
| `src/survey/view.ts` (new) | `ipToNumber`, `compareToSaved`, `buildSurveyView` |
| `src/routes/survey.ts` (new) | `loadSurveyStatus`, `createSurveyRouter` |
| `src/views/dashboardShell.ts` (new) | Page chrome for dashboard pages |
| `src/views/dashboard.ts` (new) | `/dashboard` tiles page |
| `src/views/ipSurvey.ts` (new) | IP Survey page, CSS, browser script |
| `src/routes/dashboard.ts` (new) | `createDashboardRouter` |
| `src/app.ts` (modify) | Mount routers; accept injected survey deps |
| `e2e/fakeScanner.ts`, `e2e/fixtures/scan-a.json`, `e2e/fixtures/scan-b.json` (new) | Fake scanner for dev and e2e |
| `e2e/session.ts`, `e2e/dashboard.spec.ts` (new) | Signed-in e2e |
| `.github/workflows/production-checks.yml` (modify) | Start fake scanner in the e2e job |
| `Dockerfile`, `.env.example`, `package.json`, `README.md`, `CHANGELOG.md`, `CLAUDE.md` (modify) | Container, config, docs |
| `kube-setup/manifests/www-klaushofrichter/www-data-pvc.yaml` (new), `www-ksvc.yaml` (modify) | PVC and mount (hand-applied) |

---

### Task 1: Session check that honours the allow list

**Files:**
- Create: `src/allowedEmails.ts`, `src/requireAuth.ts`, `test/requireAuth.test.ts`
- Modify: `src/session.ts`, `src/routes/auth.ts`, `src/routes/index.ts`

**Interfaces:**
- Produces:
  - `getAllowedEmails(): string[]` from `src/allowedEmails.ts`
  - `SESSION_COOKIE = 'session'` from `src/session.ts`
  - `currentUser(req: Request): SessionPayload | null` from `src/requireAuth.ts`
  - `requireAuthPage(req, res, next): void` — redirects `302` to `/`
  - `requireAuthApi(req, res, next): void` — `401` JSON `{ "error": "unauthorized" }`

- [ ] **Step 1: Write the failing test**

Create `test/requireAuth.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSession } from '../src/session';
import { currentUser, requireAuthApi, requireAuthPage } from '../src/requireAuth';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/page', requireAuthPage, (_req, res) => {
    res.send('secret page');
  });
  app.get('/api', requireAuthApi, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/who', (req, res) => {
    res.json({ user: currentUser(req) });
  });
  return app;
}

function allowedCookie(): string {
  return `session=${signSession('allowed@example.com')}`;
}

describe('requireAuthPage', () => {
  it('redirects to / without a session cookie', async () => {
    const response = await request(makeApp()).get('/page');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.text).not.toContain('secret page');
  });

  it('redirects to / with a garbage session cookie', async () => {
    const response = await request(makeApp()).get('/page').set('Cookie', 'session=not-a-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('serves the page for a valid, allow-listed session', async () => {
    const response = await request(makeApp()).get('/page').set('Cookie', allowedCookie());

    expect(response.status).toBe(200);
    expect(response.text).toBe('secret page');
  });
});

describe('requireAuthApi', () => {
  it('answers 401 JSON without a session cookie', async () => {
    const response = await request(makeApp()).get('/api');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('passes a valid, allow-listed session through', async () => {
    const response = await request(makeApp()).get('/api').set('Cookie', allowedCookie());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

describe('currentUser', () => {
  const originalAllowList = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    process.env.ALLOWED_EMAILS = originalAllowList;
  });

  it('returns the session for an allow-listed email', async () => {
    const response = await request(makeApp()).get('/who').set('Cookie', allowedCookie());

    expect(response.body.user).toEqual({ email: 'allowed@example.com' });
  });

  it('rejects a correctly signed session whose email was removed from the allow list', async () => {
    const cookie = allowedCookie();
    process.env.ALLOWED_EMAILS = 'someone-else@example.com';

    const response = await request(makeApp()).get('/who').set('Cookie', cookie);

    expect(response.body.user).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/requireAuth.test.ts`
Expected: FAIL — `Cannot find module '../src/requireAuth'`.

- [ ] **Step 3: Implement**

Create `src/allowedEmails.ts`:

```ts
// Read on every call rather than once at startup, and shared by the OAuth
// callback (who may sign in) and currentUser (who may keep using a session):
// removing an address from ALLOWED_EMAILS then locks that account out on its
// next request instead of when its 7-day cookie expires.
export function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}
```

In `src/session.ts`, add below the imports:

```ts
export const SESSION_COOKIE = 'session';
```

Create `src/requireAuth.ts`:

```ts
import { NextFunction, Request, Response } from 'express';
import { getAllowedEmails } from './allowedEmails';
import { SESSION_COOKIE, SessionPayload, verifySession } from './session';

// The single definition of "signed in". The homepage, the Dashboard button and
// every guarded route all ask this, so what a page shows and what its routes
// accept cannot drift apart.
export function currentUser(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') {
    return null;
  }
  const session = verifySession(token);
  if (!session) {
    return null;
  }
  return getAllowedEmails().includes(session.email) ? session : null;
}

export function requireAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (!currentUser(req)) {
    res.redirect(302, '/');
    return;
  }
  next();
}

// JSON, not a redirect: a fetch() following a redirect to the homepage would
// get HTML back and fail somewhere far from the actual cause.
export function requireAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (!currentUser(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
```

In `src/routes/auth.ts`:
- Replace `import { signSession } from '../session';` with `import { SESSION_COOKIE, signSession } from '../session';` and add `import { getAllowedEmails } from '../allowedEmails';`.
- Delete the line `const SESSION_COOKIE = 'session';`.
- Delete the local `function getAllowedEmails(): string[] { ... }` (6 lines).

In `src/routes/index.ts`:
- Replace `import { verifySession } from '../session';` with `import { currentUser } from '../requireAuth';`.
- Replace the body of the `GET /` handler:

```ts
indexRouter.get('/', indexRateLimit, (req: Request, res: Response) => {
  res.status(200).type('html').send(renderPage(currentUser(req) !== null));
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/requireAuth.test.ts && npm run build && npm test`
Expected: the new file passes (7 tests); full suite passes (existing `test/index.test.ts` signed-in tests use `allowed@example.com`, which `test/setup.ts` allow-lists).

- [ ] **Step 5: Commit**

```bash
git add src/allowedEmails.ts src/requireAuth.ts src/session.ts src/routes/auth.ts src/routes/index.ts test/requireAuth.test.ts
git commit -m "Add requireAuth and re-check the allow list on every request"
```

---

### Task 2: Shared header with a Dashboard button

**Files:**
- Create: `src/views/layout.ts`
- Modify: `src/views/page.ts`, `test/page.test.ts`

**Interfaces:**
- Produces (`src/views/layout.ts`):
  - `REPO_URL: string`
  - `BASE_CSS: string`, `HEADER_CSS: string`, `FAVICON_LINKS: string`
  - `renderHeaderActions(options: { isAuthenticated: boolean; showRefresh: boolean }): string`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('renderPage auth-gated cards and login button', ...)` block in `test/page.test.ts`:

```ts
  it('omits the Dashboard button entirely when logged out', () => {
    const html = renderPage(false);

    expect(html).not.toContain('dashboard-button');
    expect(html).not.toContain('href="/dashboard"');
  });

  it('shows a Dashboard button left of Logout when logged in', () => {
    const html = renderPage(true);

    expect(html).toContain('<a id="dashboard-button" href="/dashboard">Dashboard</a>');
    expect(html.indexOf('id="dashboard-button"')).toBeLessThan(html.indexOf('id="auth-button"'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/page.test.ts`
Expected: FAIL on "shows a Dashboard button left of Logout when logged in".

- [ ] **Step 3: Implement**

Create `src/views/layout.ts`:

```ts
import { appVersion } from '../version';
import { escapeHtml } from './escapeHtml';

export const REPO_URL = 'https://github.com/klaushofrichter/www-klaushofrichter';

// Shared by the homepage and the dashboard pages so the two look like one site.
export const BASE_CSS = `
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
`;

export const HEADER_CSS = `
  .header-actions {
    position: fixed; top: 16px; right: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  #app-version {
    font-size: 11px; color: #eef0fb; letter-spacing: 0.02em;
    opacity: 0.25; transition: opacity 0.2s;
  }
  .header-actions:hover #app-version { opacity: 0.6; }
  a#app-version { text-decoration: none; }
  a#app-version:hover { opacity: 1; text-decoration: underline; }
  #auth-button, #dashboard-button {
    display: inline-flex; align-items: center; justify-content: center;
    height: 36px; padding: 0 14px; border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 12px; text-decoration: none;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #auth-button:hover, #dashboard-button:hover { opacity: 1; }
  #refresh-button {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 16px; cursor: pointer;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #refresh-button:hover { opacity: 1; }
  #refresh-button.loading { animation: spin 1s linear infinite; opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export const FAVICON_LINKS = `<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />`;

export interface HeaderOptions {
  isAuthenticated: boolean;
  showRefresh: boolean;
}

export function renderHeaderActions({ isAuthenticated, showRefresh }: HeaderOptions): string {
  // Signed in, the version doubles as a way into the source that built it;
  // signed out it stays inert text. The id is on both so the deploy's smoke
  // test - which greps the logged-out page for it - keeps working either way.
  const version = escapeHtml(appVersion());
  const versionMarkup = isAuthenticated
    ? `<a id="app-version" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="Deployed build - open the repository">${version}</a>`
    : `<span id="app-version" title="Deployed build">${version}</span>`;
  // Omitted, not hidden with CSS: a signed-out response must not reveal the
  // dashboard exists. The routes behind it are guarded separately.
  const dashboardMarkup = isAuthenticated ? '<a id="dashboard-button" href="/dashboard">Dashboard</a>' : '';
  const authButtonMarkup = isAuthenticated
    ? '<a id="auth-button" href="/auth/logout">Logout</a>'
    : '<a id="auth-button" href="/auth/google/login">Login</a>';
  const refreshMarkup = showRefresh
    ? '<button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>'
    : '';
  return `<div class="header-actions">
      ${versionMarkup}
      ${dashboardMarkup}
      ${authButtonMarkup}
      ${refreshMarkup}
    </div>`;
}
```

Edit `src/views/page.ts`:

1. Replace the imports block's first two lines:

```ts
import { appVersion } from '../version';
import { escapeHtml } from './escapeHtml';
```

with:

```ts
import { escapeHtml } from './escapeHtml';
import { BASE_CSS, FAVICON_LINKS, HEADER_CSS, renderHeaderActions } from './layout';
```

2. Delete the line `const REPO_URL = 'https://github.com/klaushofrichter/www-klaushofrichter';`.

3. In `PAGE_CSS`, replace everything from `  * { box-sizing: border-box; }` through the closing `  }` of the `body { ... }` rule (12 lines) with:

```ts
  ${BASE_CSS}
```

4. In `PAGE_CSS`, delete the rules from `  .header-actions {` through `  @keyframes spin { to { transform: rotate(360deg); } }` (these now live in `HEADER_CSS`). Keep `#refresh-message` and `#refresh-message.visible`. Then change the opening of `PAGE_CSS` so header CSS is included:

```ts
const PAGE_CSS = `
  ${BASE_CSS}
  ${HEADER_CSS}
```

5. In `renderPage`, delete the `version`, `versionMarkup` and `authButtonMarkup` constants and their comment. Replace the three `<link rel=...icon...>` lines with `${FAVICON_LINKS}`. Replace the whole `<div class="header-actions"> ... </div>` block with:

```ts
    ${renderHeaderActions({ isAuthenticated, showRefresh: true })}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npm test`
Expected: all pass, including the two new tests and the existing version/login/refresh markup tests.

- [ ] **Step 5: Check the homepage visually**

Run: `PORT=8090 npm run dev`, open `http://localhost:8090/`. Signed out: header identical to before. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/views/layout.ts src/views/page.ts test/page.test.ts
git commit -m "Share the header between pages and add a signed-in Dashboard button"
```

---

### Task 3: Survey types and the scanner client

**Files:**
- Create: `src/survey/types.ts`, `src/survey/scannerClient.ts`, `test/scannerClient.test.ts`

**Interfaces:**
- Produces (`src/survey/types.ts`): `ScanStage`, `NameSource`, `WebInfo`, `DevicePort`, `Device`, `ScanResult`, `ScanState`, `SavedSurvey`, `SurveyRowStatus`, `SurveyRow`, `SurveyView`, `ScanProgress`, `SurveyStatus` — exactly as in Step 3.
- Produces (`src/survey/scannerClient.ts`):
  - `interface ScannerClient { getScan(): Promise<ScanState>; startScan(): Promise<ScanState> }`
  - `class ScannerUnavailableError extends Error`
  - `class ScannerBusyError extends Error`
  - `createScannerClient(options?: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ScannerClient`
- Scanner HTTP contract (implemented later by the real scanner, now by the fake): `GET /health` (no auth), `GET /scan` → `ScanState`, `POST /scan` → `202 ScanState` or `409 {"error":"busy"}`; both `/scan` routes require `Authorization: Bearer <token>`.

- [ ] **Step 1: Write the failing test**

Create `test/scannerClient.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  createScannerClient,
  ScannerBusyError,
  ScannerUnavailableError,
} from '../src/survey/scannerClient';
import { ScanState } from '../src/survey/types';

const idle: ScanState = { state: 'idle' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createScannerClient', () => {
  it('reports unavailable without calling out when the scanner is not configured', async () => {
    const fetchImpl = vi.fn();
    const client = createScannerClient({ baseUrl: '', token: '', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GETs /scan with the bearer token and returns the state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, idle));
    const client = createScannerClient({ baseUrl: 'http://scanner.test:9450', token: 't0ken', fetchImpl });

    await expect(client.getScan()).resolves.toEqual(idle);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://scanner.test:9450/scan');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ authorization: 'Bearer t0ken' });
  });

  it('POSTs /scan to start a scan', async () => {
    const running: ScanState = {
      state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: '2026-09-17T12:00:00.000Z',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(202, running));
    const client = createScannerClient({ baseUrl: 'http://scanner.test:9450', token: 't0ken', fetchImpl });

    await expect(client.startScan()).resolves.toEqual(running);
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });

  it('maps 409 to ScannerBusyError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'busy' }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.startScan()).rejects.toBeInstanceOf(ScannerBusyError);
  });

  it('maps other HTTP errors to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('maps a network failure to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('maps an unparseable body to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scannerClient.test.ts`
Expected: FAIL — cannot find `../src/survey/scannerClient`.

- [ ] **Step 3: Implement**

Create `src/survey/types.ts`:

```ts
// The website <-> scanner contract, and the shapes the website sends to the
// browser. The real scanner (a later plan) and e2e/fakeScanner.ts both
// implement GET/POST /scan returning ScanState. Spec:
// docs/superpowers/specs/2026-09-17-ip-survey-design.md

export type ScanStage = 'discovery' | 'names' | 'ports' | 'web';
export type NameSource = 'mdns' | 'ssdp' | 'dns';

export interface WebInfo {
  url: string;
  title: string | null;
}

export interface DevicePort {
  port: number;
  service: string;
  web: WebInfo | null;
}

export interface Device {
  ip: string;
  mac: string;
  vendor: string | null;
  privateMac: boolean;
  name: string | null;
  nameSource: NameSource | null;
  web: WebInfo | null;
  services: string[];
  ports: DevicePort[];
  rttMs: number | null;
}

export interface ScanResult {
  scannedAt: string;
  cidr: string;
  devices: Device[];
}

export type ScanState =
  | { state: 'idle' }
  | { state: 'running'; stage: ScanStage; stageIndex: number; stageCount: number; startedAt: string }
  | { state: 'finished'; result: ScanResult }
  | { state: 'failed'; error: string; finishedAt: string };

export interface SavedSurvey extends ScanResult {
  savedAt: string;
  version: string;
}

export type SurveyRowStatus = 'new' | 'unchanged' | 'gone';

export interface SurveyRow extends Device {
  status: SurveyRowStatus;
  // Precomputed so the browser sorts numbers instead of re-parsing addresses.
  ipNum: number;
  statusRank: number;
}

export interface SurveyView {
  source: 'none' | 'saved' | 'scan';
  scannedAt: string | null;
  savedAt: string | null;
  unsaved: boolean;
  rows: SurveyRow[];
  counts: { devices: number; new: number; gone: number };
}

export type ScanProgress =
  | { state: 'idle' }
  | { state: 'running'; stage: ScanStage; stageIndex: number; stageCount: number }
  | { state: 'finished'; scannedAt: string }
  | { state: 'failed'; error: string }
  | { state: 'unavailable' };

export interface SurveyStatus {
  scan: ScanProgress;
  view: SurveyView;
}
```

Create `src/survey/scannerClient.ts`:

```ts
import { ScanState } from './types';

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

export class ScannerBusyError extends Error {
  constructor() {
    super('A scan is already running');
    this.name = 'ScannerBusyError';
  }
}

export interface ScannerClient {
  getScan(): Promise<ScanState>;
  startScan(): Promise<ScanState>;
}

export interface ScannerClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createScannerClient(options: ScannerClientOptions = {}): ScannerClient {
  const baseUrl = options.baseUrl ?? process.env.SCANNER_URL ?? '';
  const token = options.token ?? process.env.SCANNER_TOKEN ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  // Every failure except "busy" collapses to ScannerUnavailableError: the page
  // treats an unconfigured, unreachable or misbehaving scanner the same way,
  // and keeps showing the saved survey.
  async function call(method: 'GET' | 'POST'): Promise<ScanState> {
    if (!baseUrl || !token) {
      throw new ScannerUnavailableError('Scanner is not configured');
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL('/scan', baseUrl), {
        method,
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ScannerUnavailableError(`Scanner request failed: ${(err as Error).message}`);
    }
    if (response.status === 409) {
      throw new ScannerBusyError();
    }
    if (!response.ok) {
      throw new ScannerUnavailableError(`Scanner answered HTTP ${response.status}`);
    }
    try {
      return (await response.json()) as ScanState;
    } catch {
      throw new ScannerUnavailableError('Scanner returned an unreadable response');
    }
  }

  return {
    getScan: () => call('GET'),
    startScan: () => call('POST'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/scannerClient.test.ts && npm run build`
Expected: 7 tests pass; build clean.

- [ ] **Step 5: Commit**

```bash
git add src/survey/types.ts src/survey/scannerClient.ts test/scannerClient.test.ts
git commit -m "Define the scanner contract and an HTTP client for it"
```

---

### Task 4: Saved survey store

**Files:**
- Create: `src/survey/store.ts`, `test/surveyStore.test.ts`

**Interfaces:**
- Consumes: `SavedSurvey` (Task 3)
- Produces:
  - `surveyDir(): string`
  - `readSavedSurvey(dir?: string): Promise<SavedSurvey | null>` — `null` when the file does not exist; throws on unreadable or corrupt files
  - `writeSavedSurvey(survey: SavedSurvey, dir?: string): Promise<void>` — atomic

- [ ] **Step 1: Write the failing test**

Create `test/surveyStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readSavedSurvey, writeSavedSurvey } from '../src/survey/store';
import { SavedSurvey } from '../src/survey/types';

function survey(scannedAt: string): SavedSurvey {
  return {
    scannedAt,
    savedAt: '2026-09-17T12:05:00.000Z',
    cidr: '192.168.1.0/24',
    version: 'dev',
    devices: [],
  };
}

describe('survey store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-store-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null when nothing has been saved', async () => {
    await expect(readSavedSurvey(dir)).resolves.toBeNull();
  });

  it('round-trips a saved survey', async () => {
    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir);

    await expect(readSavedSurvey(dir)).resolves.toEqual(survey('2026-09-17T12:00:00.000Z'));
  });

  it('creates the directory if it does not exist', async () => {
    const nested = path.join(dir, 'a', 'b');

    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), nested);

    await expect(readSavedSurvey(nested)).resolves.not.toBeNull();
  });

  it('replaces the previous survey and leaves no temporary files', async () => {
    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir);
    await writeSavedSurvey(survey('2026-09-17T13:00:00.000Z'), dir);

    expect((await readSavedSurvey(dir))?.scannedAt).toBe('2026-09-17T13:00:00.000Z');
    expect(await fs.readdir(dir)).toEqual(['latest.json']);
  });

  it('cleans up its temporary file when the final rename fails', async () => {
    // A non-empty directory where latest.json should be makes rename() fail.
    await fs.mkdir(path.join(dir, 'latest.json'));
    await fs.writeFile(path.join(dir, 'latest.json', 'blocker'), 'x');

    await expect(writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['latest.json']);
  });

  it('throws on a corrupt file rather than pretending nothing was saved', async () => {
    await fs.writeFile(path.join(dir, 'latest.json'), '{ not json');

    await expect(readSavedSurvey(dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/surveyStore.test.ts`
Expected: FAIL — cannot find `../src/survey/store`.

- [ ] **Step 3: Implement**

Create `src/survey/store.ts`:

```ts
import { promises as fs } from 'fs';
import path from 'path';
import { SavedSurvey } from './types';

const LATEST = 'latest.json';

// dist/survey/store.js -> /app/data/surveys in the image, where the www-data
// PVC is mounted. SURVEY_DIR overrides it for tests, CI and local runs.
export function surveyDir(): string {
  return process.env.SURVEY_DIR ?? path.join(__dirname, '..', '..', 'data', 'surveys');
}

export async function readSavedSurvey(dir: string = surveyDir()): Promise<SavedSurvey | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, LATEST), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  // A corrupt file throws instead of reading as "nothing saved": treating it
  // as empty would let the next Save silently overwrite whatever is left.
  return JSON.parse(raw) as SavedSurvey;
}

// Written to a temporary file in the same directory and renamed into place.
// rename() within one filesystem is atomic, so a crash mid-save leaves either
// the old survey or the new one, never half of each.
export async function writeSavedSurvey(survey: SavedSurvey, dir: string = surveyDir()): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, LATEST);
  const temp = path.join(dir, `.${LATEST}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(survey, null, 2), 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/surveyStore.test.ts && npm run build`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/survey/store.ts test/surveyStore.test.ts
git commit -m "Store the saved survey atomically on disk"
```

---

### Task 5: Comparison and the survey view

**Files:**
- Create: `src/survey/view.ts`, `test/surveyView.test.ts`

**Interfaces:**
- Consumes: `Device`, `ScanResult`, `SavedSurvey`, `SurveyRow`, `SurveyView` (Task 3)
- Produces:
  - `ipToNumber(ip: string): number` — invalid → `Number.MAX_SAFE_INTEGER`
  - `compareToSaved(current: Device[], saved: Device[] | null): SurveyRow[]`
  - `buildSurveyView(finishedScan: ScanResult | null, saved: SavedSurvey | null): SurveyView`
- Status ranks: `new` 0, `unchanged` 1, `gone` 2.

- [ ] **Step 1: Write the failing test**

Create `test/surveyView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSurveyView, compareToSaved, ipToNumber } from '../src/survey/view';
import { Device, SavedSurvey, ScanResult } from '../src/survey/types';

function device(ip: string, mac: string, name: string | null = null): Device {
  return {
    ip, mac, name, vendor: null, privateMac: false, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

function saved(devices: Device[], scannedAt = '2026-09-17T10:00:00.000Z'): SavedSurvey {
  return { scannedAt, savedAt: '2026-09-17T10:01:00.000Z', cidr: '192.168.1.0/24', version: 'dev', devices };
}

function scan(devices: Device[], scannedAt = '2026-09-17T11:00:00.000Z'): ScanResult {
  return { scannedAt, cidr: '192.168.1.0/24', devices };
}

describe('ipToNumber', () => {
  it('orders addresses numerically, not as text', () => {
    expect(ipToNumber('192.168.1.9')).toBeLessThan(ipToNumber('192.168.1.10'));
    expect(ipToNumber('192.168.1.10')).toBeLessThan(ipToNumber('192.168.1.100'));
  });

  it('sends malformed addresses to the end', () => {
    expect(ipToNumber('not-an-ip')).toBe(Number.MAX_SAFE_INTEGER);
    expect(ipToNumber('192.168.1.256')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('compareToSaved', () => {
  it('marks nothing as new when there is no saved survey to compare against', () => {
    const rows = compareToSaved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')], null);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('marks new, unchanged and gone devices by MAC address', () => {
    const rows = compareToSaved(
      [device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.3', 'aa:aa:aa:aa:aa:02')],
      [device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.4', 'aa:aa:aa:aa:aa:03')],
    );

    expect(rows.map((r) => [r.mac, r.status])).toEqual([
      ['aa:aa:aa:aa:aa:01', 'unchanged'],
      ['aa:aa:aa:aa:aa:02', 'new'],
      ['aa:aa:aa:aa:aa:03', 'gone'],
    ]);
  });

  it('treats a device that moved to a new IP as unchanged', () => {
    const rows = compareToSaved(
      [device('192.168.1.50', 'aa:aa:aa:aa:aa:01')],
      [device('192.168.1.20', 'aa:aa:aa:aa:aa:01')],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('unchanged');
    expect(rows[0].ip).toBe('192.168.1.50');
  });

  it('matches MAC addresses case-insensitively', () => {
    const rows = compareToSaved([device('192.168.1.2', 'AA:BB:CC:DD:EE:FF')], [device('192.168.1.2', 'aa:bb:cc:dd:ee:ff')]);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('precomputes the sort keys', () => {
    const [row] = compareToSaved([device('192.168.1.10', 'aa:aa:aa:aa:aa:01')], []);

    expect(row.ipNum).toBe(ipToNumber('192.168.1.10'));
    expect(row.statusRank).toBe(0);
  });
});

describe('buildSurveyView', () => {
  it('is empty with neither a scan nor a saved survey', () => {
    expect(buildSurveyView(null, null)).toEqual({
      source: 'none', scannedAt: null, savedAt: null, unsaved: false, rows: [], counts: { devices: 0, new: 0, gone: 0 },
    });
  });

  it('shows the saved survey when there is no newer scan', () => {
    const view = buildSurveyView(null, saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

    expect(view.source).toBe('saved');
    expect(view.unsaved).toBe(false);
    expect(view.savedAt).toBe('2026-09-17T10:01:00.000Z');
    expect(view.counts).toEqual({ devices: 1, new: 0, gone: 0 });
  });

  it('shows an unsaved scan compared against the saved survey', () => {
    const view = buildSurveyView(
      scan([device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.3', 'aa:aa:aa:aa:aa:02')]),
      saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.4', 'aa:aa:aa:aa:aa:03')]),
    );

    expect(view.source).toBe('scan');
    expect(view.unsaved).toBe(true);
    expect(view.scannedAt).toBe('2026-09-17T11:00:00.000Z');
    expect(view.counts).toEqual({ devices: 2, new: 1, gone: 1 });
  });

  it('shows the saved survey once the finished scan has been saved', () => {
    const devices = [device('192.168.1.2', 'aa:aa:aa:aa:aa:01')];
    const view = buildSurveyView(scan(devices, '2026-09-17T11:00:00.000Z'), saved(devices, '2026-09-17T11:00:00.000Z'));

    expect(view.source).toBe('saved');
    expect(view.unsaved).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/surveyView.test.ts`
Expected: FAIL — cannot find `../src/survey/view`.

- [ ] **Step 3: Implement**

Create `src/survey/view.ts`:

```ts
import { Device, SavedSurvey, ScanResult, SurveyRow, SurveyRowStatus, SurveyView } from './types';

const STATUS_RANK: Record<SurveyRowStatus, number> = { new: 0, unchanged: 1, gone: 2 };

export function ipToNumber(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function toRow(device: Device, status: SurveyRowStatus): SurveyRow {
  return { ...device, status, ipNum: ipToNumber(device.ip), statusRank: STATUS_RANK[status] };
}

// Keyed on MAC, not IP: DHCP can hand the same device a different address
// between scans, and an IP match would then report one device as both new and
// gone.
function macKey(mac: string): string {
  return mac.toLowerCase();
}

export function compareToSaved(current: Device[], saved: Device[] | null): SurveyRow[] {
  if (!saved) {
    return current.map((device) => toRow(device, 'unchanged'));
  }
  const savedMacs = new Set(saved.map((device) => macKey(device.mac)));
  const currentMacs = new Set(current.map((device) => macKey(device.mac)));
  const rows = current.map((device) => toRow(device, savedMacs.has(macKey(device.mac)) ? 'unchanged' : 'new'));
  for (const device of saved) {
    if (!currentMacs.has(macKey(device.mac))) {
      rows.push(toRow(device, 'gone'));
    }
  }
  return rows;
}

function countRows(rows: SurveyRow[]): SurveyView['counts'] {
  return {
    devices: rows.filter((row) => row.status !== 'gone').length,
    new: rows.filter((row) => row.status === 'new').length,
    gone: rows.filter((row) => row.status === 'gone').length,
  };
}

export function buildSurveyView(finishedScan: ScanResult | null, saved: SavedSurvey | null): SurveyView {
  // A finished scan is "unsaved" until a saved survey carries its timestamp.
  if (finishedScan && (!saved || saved.scannedAt !== finishedScan.scannedAt)) {
    const rows = compareToSaved(finishedScan.devices, saved ? saved.devices : null);
    return {
      source: 'scan',
      scannedAt: finishedScan.scannedAt,
      savedAt: null,
      unsaved: true,
      rows,
      counts: countRows(rows),
    };
  }
  if (saved) {
    const rows = saved.devices.map((device) => toRow(device, 'unchanged'));
    return {
      source: 'saved',
      scannedAt: saved.scannedAt,
      savedAt: saved.savedAt,
      unsaved: false,
      rows,
      counts: countRows(rows),
    };
  }
  return { source: 'none', scannedAt: null, savedAt: null, unsaved: false, rows: [], counts: { devices: 0, new: 0, gone: 0 } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/surveyView.test.ts && npm run build`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/survey/view.ts test/surveyView.test.ts
git commit -m "Compare scans to the saved survey by MAC address"
```

---

### Task 6: Survey API

**Files:**
- Create: `src/routes/survey.ts`, `test/surveyApi.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `ScannerClient`, `ScannerBusyError`, `ScannerUnavailableError`, `createScannerClient` (Task 3); `readSavedSurvey`, `writeSavedSurvey` (Task 4); `buildSurveyView` (Task 5); `requireAuthApi` (Task 1); `appVersion()` from `src/version.ts`
- Produces:
  - `interface SurveyDeps { scanner: ScannerClient; surveyDir?: string; now?: () => Date }`
  - `loadSurveyStatus(deps: SurveyDeps): Promise<SurveyStatus>`
  - `createSurveyRouter(deps: SurveyDeps): Router`
  - `createApp(options?: { surveyDeps?: SurveyDeps }): Express`
- Routes: `GET /api/survey` → `200 SurveyStatus`; `POST /api/survey/scan` → `202 SurveyStatus` | `409 {error:'busy', status}` | `503 {error:'scanner-unavailable', status}`; `POST /api/survey/save` → `200 SurveyStatus` | `409 {error:'nothing-to-save'}` | `503 {error:'scanner-unavailable'}`; unexpected errors → `500 {error:'internal'}`.

- [ ] **Step 1: Write the failing test**

Create `test/surveyApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { signSession } from '../src/session';
import { createSurveyRouter } from '../src/routes/survey';
import { createApp } from '../src/app';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../src/survey/scannerClient';
import { readSavedSurvey, writeSavedSurvey } from '../src/survey/store';
import { Device, ScanState } from '../src/survey/types';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const router: Device = {
  ip: '192.168.1.1', mac: '04:42:1a:14:e8:00', vendor: 'ASUSTek COMPUTER INC.', privateMac: false,
  name: 'RT-AX86U-14E8', nameSource: 'dns', web: null, services: [], ports: [], rttMs: 2,
};

const finished: ScanState = {
  state: 'finished',
  result: { scannedAt: '2026-09-17T11:59:00.000Z', cidr: '192.168.1.0/24', devices: [router] },
};

function fakeScanner(state: ScanState) {
  return {
    getScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
    startScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
  } satisfies ScannerClient;
}

function cookie(): string {
  return `session=${signSession('allowed@example.com')}`;
}

describe('survey API', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-api-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function makeApp(scanner: ScannerClient, surveyDir = dir) {
    const app = express();
    app.use(cookieParser());
    app.use(createSurveyRouter({ scanner, surveyDir, now: () => NOW }));
    return app;
  }

  it('rejects every route without a session and never reaches the scanner', async () => {
    const scanner = fakeScanner(finished);
    const app = makeApp(scanner);

    expect((await request(app).get('/api/survey')).status).toBe(401);
    expect((await request(app).post('/api/survey/scan')).status).toBe(401);
    expect((await request(app).post('/api/survey/save')).status).toBe(401);
    expect(scanner.getScan).not.toHaveBeenCalled();
    expect(scanner.startScan).not.toHaveBeenCalled();
  });

  it('is mounted and guarded in the real app', async () => {
    const response = await request(createApp()).get('/api/survey');

    expect(response.status).toBe(401);
  });

  it('reports an idle scanner and no saved survey', async () => {
    const response = await request(makeApp(fakeScanner({ state: 'idle' }))).get('/api/survey').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'idle' });
    expect(response.body.view.source).toBe('none');
  });

  it('still shows the saved survey when the scanner is unavailable', async () => {
    await writeSavedSurvey({ ...finished.result, savedAt: '2026-09-17T12:00:00.000Z', version: 'dev' }, dir);
    const scanner = fakeScanner({ state: 'idle' });
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).get('/api/survey').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'unavailable' });
    expect(response.body.view.source).toBe('saved');
    expect(response.body.view.rows).toHaveLength(1);
  });

  it('starts a scan and returns the status', async () => {
    const running: ScanState = {
      state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: '2026-09-17T12:00:00.000Z',
    };
    const scanner = fakeScanner(running);

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(202);
    expect(scanner.startScan).toHaveBeenCalledTimes(1);
    expect(response.body.scan).toEqual({ state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4 });
  });

  it('answers 409 with the current status when a scan is already running', async () => {
    const scanner = fakeScanner({ state: 'running', stage: 'names', stageIndex: 2, stageCount: 4, startedAt: 'x' });
    scanner.startScan.mockRejectedValue(new ScannerBusyError());

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('busy');
    expect(response.body.status.scan.stage).toBe('names');
  });

  it('answers 503 when the scanner cannot be reached to start a scan', async () => {
    const scanner = fakeScanner({ state: 'idle' });
    scanner.startScan.mockRejectedValue(new ScannerUnavailableError('down'));
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('scanner-unavailable');
    expect(response.body.status.scan).toEqual({ state: 'unavailable' });
  });

  it('saves the scanner result with a timestamp and version', async () => {
    const response = await request(makeApp(fakeScanner(finished))).post('/api/survey/save').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.view.source).toBe('saved');
    expect(response.body.view.unsaved).toBe(false);
    expect(await readSavedSurvey(dir)).toEqual({
      ...finished.result,
      savedAt: NOW.toISOString(),
      version: 'dev',
    });
  });

  it('saves what the scanner holds and ignores the request body', async () => {
    await request(makeApp(fakeScanner(finished)))
      .post('/api/survey/save')
      .set('Cookie', cookie())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ devices: [{ ip: '6.6.6.6', mac: 'de:ad:be:ef:00:00' }] }));

    expect((await readSavedSurvey(dir))?.devices).toEqual([router]);
  });

  it('refuses to save when the scanner has no finished scan', async () => {
    const scanner = fakeScanner({ state: 'running', stage: 'ports', stageIndex: 3, stageCount: 4, startedAt: 'x' });

    const response = await request(makeApp(scanner)).post('/api/survey/save').set('Cookie', cookie());

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'nothing-to-save' });
    expect(await readSavedSurvey(dir)).toBeNull();
  });

  it('answers 500 JSON when the survey cannot be written', async () => {
    const blocker = path.join(dir, 'a-file');
    await fs.writeFile(blocker, 'x');

    const response = await request(makeApp(fakeScanner(finished), path.join(blocker, 'surveys')))
      .post('/api/survey/save')
      .set('Cookie', cookie());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/surveyApi.test.ts`
Expected: FAIL — cannot find `../src/routes/survey`.

- [ ] **Step 3: Implement**

Create `src/routes/survey.ts`:

```ts
import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuthApi } from '../requireAuth';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../survey/scannerClient';
import { readSavedSurvey, writeSavedSurvey } from '../survey/store';
import { ScanProgress, ScanState, SurveyStatus } from '../survey/types';
import { buildSurveyView } from '../survey/view';
import { appVersion } from '../version';

export interface SurveyDeps {
  scanner: ScannerClient;
  surveyDir?: string;
  now?: () => Date;
}

function toProgress(scan: ScanState): ScanProgress {
  switch (scan.state) {
    case 'idle':
      return { state: 'idle' };
    case 'running':
      return { state: 'running', stage: scan.stage, stageIndex: scan.stageIndex, stageCount: scan.stageCount };
    case 'finished':
      return { state: 'finished', scannedAt: scan.result.scannedAt };
    case 'failed':
      return { state: 'failed', error: scan.error };
  }
}

export async function loadSurveyStatus(deps: SurveyDeps): Promise<SurveyStatus> {
  const saved = await readSavedSurvey(deps.surveyDir);
  let scan: ScanState | null = null;
  let progress: ScanProgress;
  try {
    scan = await deps.scanner.getScan();
    progress = toProgress(scan);
  } catch (err) {
    if (!(err instanceof ScannerUnavailableError)) {
      throw err;
    }
    progress = { state: 'unavailable' };
  }
  const finished = scan && scan.state === 'finished' ? scan.result : null;
  return { scan: progress, view: buildSurveyView(finished, saved) };
}

export function createSurveyRouter(deps: SurveyDeps): Router {
  const router = Router();
  const surveyRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Auth first, so unauthenticated requests are rejected before they count
  // against anyone's budget. POSTs need no CSRF token here: the session cookie
  // is SameSite=Lax, so a cross-site POST arrives without it and gets a 401.
  router.use('/api/survey', requireAuthApi, surveyRateLimit);

  router.get('/api/survey', async (_req: Request, res: Response) => {
    res.status(200).json(await loadSurveyStatus(deps));
  });

  router.post('/api/survey/scan', async (_req: Request, res: Response) => {
    try {
      await deps.scanner.startScan();
    } catch (err) {
      if (err instanceof ScannerBusyError) {
        res.status(409).json({ error: 'busy', status: await loadSurveyStatus(deps) });
        return;
      }
      if (err instanceof ScannerUnavailableError) {
        res.status(503).json({ error: 'scanner-unavailable', status: await loadSurveyStatus(deps) });
        return;
      }
      throw err;
    }
    res.status(202).json(await loadSurveyStatus(deps));
  });

  router.post('/api/survey/save', async (_req: Request, res: Response) => {
    let scan: ScanState;
    try {
      scan = await deps.scanner.getScan();
    } catch (err) {
      if (err instanceof ScannerUnavailableError) {
        res.status(503).json({ error: 'scanner-unavailable' });
        return;
      }
      throw err;
    }
    // Saved from what the scanner holds, never from the request body: a
    // crafted POST cannot plant devices in the saved survey.
    if (scan.state !== 'finished') {
      res.status(409).json({ error: 'nothing-to-save' });
      return;
    }
    const now = deps.now ? deps.now() : new Date();
    await writeSavedSurvey({ ...scan.result, savedAt: now.toISOString(), version: appVersion() }, deps.surveyDir);
    res.status(200).json(await loadSurveyStatus(deps));
  });

  // JSON rather than Express's default HTML error page, which the browser
  // script could not read.
  router.use('/api/survey', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Survey API error', err);
    res.status(500).json({ error: 'internal' });
  });

  return router;
}
```

Replace `src/app.ts` with:

```ts
import express, { Express } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { createSurveyRouter, SurveyDeps } from './routes/survey';
import { createScannerClient } from './survey/scannerClient';

export interface AppOptions {
  // Injected by tests; production builds the real client from SCANNER_URL and
  // SCANNER_TOKEN.
  surveyDeps?: SurveyDeps;
}

export function createApp(options: AppOptions = {}): Express {
  const surveyDeps = options.surveyDeps ?? { scanner: createScannerClient() };
  const app = express();
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(publicRouter);
  app.use(createSurveyRouter(surveyDeps));
  app.use(indexRouter);
  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/surveyApi.test.ts && npm run build && npm test`
Expected: 11 new tests pass; full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/routes/survey.ts src/app.ts test/surveyApi.test.ts
git commit -m "Add the signed-in survey API: status, scan and save"
```

---

### Task 7: Dashboard shell and the /dashboard page

**Files:**
- Create: `src/views/dashboardShell.ts`, `src/views/dashboard.ts`, `src/routes/dashboard.ts`, `test/dashboard.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `BASE_CSS`, `HEADER_CSS`, `FAVICON_LINKS`, `renderHeaderActions` (Task 2); `requireAuthPage` (Task 1); `SurveyDeps` (Task 6); `CARD_COLORS` from `src/links.ts`
- Produces:
  - `interface Crumb { label: string; href?: string }`
  - `renderDashboardShell(options: { title: string; breadcrumb: Crumb[]; body: string; extraCss?: string; script?: string }): string`
  - `renderDashboardPage(): string`
  - `createDashboardRouter(deps: SurveyDeps): Router` — Task 8 adds `/dashboard/ip-survey` to it

- [ ] **Step 1: Write the failing test**

Create `test/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';

function cookie(): string {
  return `session=${signSession('allowed@example.com')}`;
}

describe('GET /dashboard', () => {
  it('redirects a signed-out visitor to the cards', async () => {
    const response = await request(createApp()).get('/dashboard');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('renders the dashboard for a signed-in user', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1>Dashboard</h1>');
    expect(response.text).toContain('href="/dashboard/ip-survey"');
    expect(response.text).toContain('<a href="/">← Cards</a>');
  });

  it('keeps the signed-in header but drops the image refresh button', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.text).toContain('id="dashboard-button"');
    expect(response.text).toContain('<a id="auth-button" href="/auth/logout">Logout</a>');
    expect(response.text).toContain('id="app-version"');
    expect(response.text).not.toContain('id="refresh-button"');
  });

  it('asks search engines not to index it', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.text).toContain('<meta name="robots" content="noindex" />');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dashboard.test.ts`
Expected: FAIL — `/dashboard` returns 200 from nothing / 404 (no route yet), so the redirect assertion fails.

- [ ] **Step 3: Implement**

Create `src/views/dashboardShell.ts`:

```ts
import { escapeHtml } from './escapeHtml';
import { BASE_CSS, FAVICON_LINKS, HEADER_CSS, renderHeaderActions } from './layout';

export interface Crumb {
  label: string;
  href?: string;
}

export interface DashboardShellOptions {
  title: string;
  breadcrumb: Crumb[];
  body: string;
  extraCss?: string;
  script?: string;
}

const SHELL_CSS = `
  .page { padding: 40px 5%; max-width: 1100px; margin: 0 auto; }
  .breadcrumb { font-size: 13px; margin: 0 0 18px; opacity: 0.85; }
  .breadcrumb a { color: #93a5fd; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .breadcrumb .sep { margin: 0 6px; opacity: 0.5; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .intro { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0 0 24px; }
`;

function renderBreadcrumb(crumbs: Crumb[]): string {
  return crumbs
    .map((crumb) =>
      crumb.href
        ? `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`
        : `<span aria-current="page">${escapeHtml(crumb.label)}</span>`,
    )
    .join('<span class="sep" aria-hidden="true">›</span>');
}

// Only ever served behind requireAuthPage, so the header is always the
// signed-in variant.
export function renderDashboardShell(options: DashboardShellOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)} — Klaus Hofrichter</title>
    <meta name="robots" content="noindex" />
    ${FAVICON_LINKS}
    <style>${BASE_CSS}${HEADER_CSS}${SHELL_CSS}${options.extraCss ?? ''}</style>
  </head>
  <body>
    ${renderHeaderActions({ isAuthenticated: true, showRefresh: false })}
    <div class="page">
      <nav class="breadcrumb" aria-label="Breadcrumb">${renderBreadcrumb(options.breadcrumb)}</nav>
      ${options.body}
    </div>
    ${options.script ? `<script>${options.script}</script>` : ''}
  </body>
</html>`;
}
```

Create `src/views/dashboard.ts`:

```ts
import { CARD_COLORS } from '../links';
import { renderDashboardShell } from './dashboardShell';

const TILES_CSS = `
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
  .tile {
    display: block; padding: 18px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.12);
    background: ${CARD_COLORS.indigo};
    color: #eef0fb; text-decoration: none;
  }
  .tile:hover { border-color: rgba(255,255,255,0.35); }
  .tile h2 { margin: 0; font-size: 16px; }
  .tile p { margin: 6px 0 0; font-size: 13px; opacity: 0.75; }
`;

export function renderDashboardPage(): string {
  return renderDashboardShell({
    title: 'Dashboard',
    breadcrumb: [{ label: '← Cards', href: '/' }],
    extraCss: TILES_CSS,
    body: `
      <h1>Dashboard</h1>
      <p class="intro">Tools for the signed-in owner of this site.</p>
      <main class="tiles">
        <a class="tile" href="/dashboard/ip-survey">
          <h2>IP Survey</h2>
          <p>Scan the home network and list every connected device.</p>
        </a>
      </main>`,
  });
}
```

Create `src/routes/dashboard.ts`:

```ts
import { Request, Response, Router } from 'express';
import { requireAuthPage } from '../requireAuth';
import { renderDashboardPage } from '../views/dashboard';
import { SurveyDeps } from './survey';

export function createDashboardRouter(_deps: SurveyDeps): Router {
  const router = Router();

  router.get('/dashboard', requireAuthPage, (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderDashboardPage());
  });

  return router;
}
```

In `src/app.ts`, add the import `import { createDashboardRouter } from './routes/dashboard';` and mount it after the survey router:

```ts
  app.use(createSurveyRouter(surveyDeps));
  app.use(createDashboardRouter(surveyDeps));
  app.use(indexRouter);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dashboard.test.ts && npm run build && npm test`
Expected: 4 new tests pass; full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboardShell.ts src/views/dashboard.ts src/routes/dashboard.ts src/app.ts test/dashboard.test.ts
git commit -m "Add the signed-in /dashboard page"
```

---

### Task 8: IP Survey page

**Files:**
- Create: `src/views/ipSurvey.ts`, `test/ipSurveyPage.test.ts`
- Modify: `src/routes/dashboard.ts`

**Interfaces:**
- Consumes: `renderDashboardShell` (Task 7); `SurveyStatus` (Task 3); `loadSurveyStatus`, `SurveyDeps` (Task 6); `requireAuthPage` (Task 1)
- Produces:
  - `embedJson(value: unknown): string`
  - `renderIpSurveyPage(status: SurveyStatus): string`
  - Route `GET /dashboard/ip-survey`
- Element ids the e2e suite relies on: `scan-button`, `save-button`, `scan-progress`, `survey-status-line`, `survey-message`, `survey-table`, `survey-rows`, `details-dialog`, `details-title`, `details-meta`, `details-ports-table`, `details-ports`, `details-no-ports`, `details-services`, `details-rtt`, `survey-status` (embedded JSON). Classes: `badge-new`, `badge-gone`, row class `gone`, `details-button`.

- [ ] **Step 1: Write the failing test**

Create `test/ipSurveyPage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';
import { embedJson, renderIpSurveyPage } from '../src/views/ipSurvey';
import { SurveyStatus, ScanState } from '../src/survey/types';
import { ScannerClient } from '../src/survey/scannerClient';

const hostileName = '</script><script>alert(1)</script>';

const status: SurveyStatus = {
  scan: { state: 'idle' },
  view: {
    source: 'saved', scannedAt: '2026-09-17T11:00:00.000Z', savedAt: '2026-09-17T11:01:00.000Z', unsaved: false,
    counts: { devices: 1, new: 0, gone: 0 },
    rows: [{
      ip: '192.168.1.9', mac: 'b8:27:eb:11:22:33', vendor: null, privateMac: false, name: hostileName,
      nameSource: 'mdns', web: null, services: [], ports: [], rttMs: 4,
      status: 'unchanged', ipNum: 3232235785, statusRank: 1,
    }],
  },
};

function extractEmbedded(html: string): unknown {
  const match = html.match(/<script type="application\/json" id="survey-status">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('embedded status not found');
  return JSON.parse(match[1]);
}

describe('embedJson', () => {
  it('cannot close the surrounding script element', () => {
    const embedded = embedJson({ name: hostileName });

    expect(embedded).not.toContain('<');
    expect(JSON.parse(embedded)).toEqual({ name: hostileName });
  });
});

describe('renderIpSurveyPage', () => {
  it('renders the toolbar, the sortable table and the details dialog', () => {
    const html = renderIpSurveyPage(status);

    expect(html).toContain('id="scan-button"');
    expect(html).toContain('id="save-button"');
    expect(html).toContain('id="survey-rows"');
    expect(html).toContain('<th data-sort-key="ipNum" aria-sort="ascending">');
    expect(html).toContain('<dialog id="details-dialog"');
  });

  it('embeds the status so the page renders without a second request', () => {
    expect(extractEmbedded(renderIpSurveyPage(status))).toEqual(status);
  });

  it('does not let a device name break out of the embedded JSON', () => {
    const html = renderIpSurveyPage(status);

    expect(html).not.toContain(hostileName);
  });

  it('links back to the cards and the dashboard', () => {
    const html = renderIpSurveyPage(status);

    expect(html).toContain('<a href="/">Cards</a>');
    expect(html).toContain('<a href="/dashboard">Dashboard</a>');
    expect(html).toContain('<span aria-current="page">IP Survey</span>');
  });
});

describe('GET /dashboard/ip-survey', () => {
  function scanner(state: ScanState): ScannerClient {
    return { getScan: vi.fn().mockResolvedValue(state), startScan: vi.fn().mockResolvedValue(state) };
  }

  it('redirects a signed-out visitor to the cards', async () => {
    const response = await request(createApp()).get('/dashboard/ip-survey');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('renders with the current status for a signed-in user', async () => {
    const app = createApp({ surveyDeps: { scanner: scanner({ state: 'idle' }), surveyDir: '/nonexistent-survey-dir' } });

    const response = await request(app)
      .get('/dashboard/ip-survey')
      .set('Cookie', `session=${signSession('allowed@example.com')}`);

    expect(response.status).toBe(200);
    expect(extractEmbedded(response.text)).toEqual({
      scan: { state: 'idle' },
      view: { source: 'none', scannedAt: null, savedAt: null, unsaved: false, rows: [], counts: { devices: 0, new: 0, gone: 0 } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ipSurveyPage.test.ts`
Expected: FAIL — cannot find `../src/views/ipSurvey`.

- [ ] **Step 3: Implement the view**

Create `src/views/ipSurvey.ts`:

```ts
import { SurveyStatus } from '../survey/types';
import { renderDashboardShell } from './dashboardShell';

// "<" becomes < so no value - a device name, a page title - can close
// the <script> element the JSON sits in. JSON.parse reads it back unchanged.
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const IP_SURVEY_CSS = `
  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 10px; }
  .toolbar button {
    height: 34px; padding: 0 16px; border-radius: 17px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
    color: #eef0fb; font-size: 13px; cursor: pointer;
  }
  .toolbar button:disabled { opacity: 0.4; cursor: default; }
  #scan-progress { font-size: 13px; opacity: 0.85; }
  #survey-status-line { font-size: 13px; opacity: 0.75; margin: 0 0 6px; }
  #survey-message { font-size: 13px; color: #fca5a5; margin: 0 0 12px; min-height: 1em; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
  th button { background: none; border: 0; color: inherit; font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
  th[aria-sort="ascending"] button::after { content: ' ▲'; font-size: 10px; }
  th[aria-sort="descending"] button::after { content: ' ▼'; font-size: 10px; }
  tr.gone td { opacity: 0.45; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-new { background: #065f46; color: #d1fae5; }
  .badge-gone { background: #4b5563; color: #e5e7eb; }
  .source { margin-left: 6px; font-size: 10px; opacity: 0.55; text-transform: uppercase; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  td a { color: #93a5fd; text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .details-button {
    height: 26px; padding: 0 10px; border-radius: 13px;
    border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
    color: #eef0fb; font-size: 12px; cursor: pointer;
  }
  dialog {
    background: #1b1740; color: #eef0fb; border: 1px solid rgba(255,255,255,0.2);
    border-radius: 14px; padding: 20px 24px; width: 90vw; max-width: 560px;
  }
  dialog::backdrop { background: rgba(0,0,0,0.6); }
  dialog h2 { margin: 0 0 4px; font-size: 17px; padding-right: 28px; }
  dialog h3 { font-size: 13px; margin: 16px 0 4px; opacity: 0.8; }
  .dialog-close { position: absolute; top: 10px; right: 12px; margin: 0; }
  .dialog-close button { background: none; border: 0; color: #eef0fb; font-size: 20px; cursor: pointer; opacity: 0.6; }
  .dialog-close button:hover { opacity: 1; }
`;

// Browser code, served inline like the homepage's scripts. Kept free of
// backslashes and backticks: this is a template literal, and escapes inside
// it would be rewritten before the browser ever saw them.
const IP_SURVEY_SCRIPT = `
  (function () {
    var STAGE_LABELS = {
      discovery: 'finding devices',
      names: 'finding names',
      ports: 'checking ports',
      web: 'checking web pages'
    };
    var POLL_MS = 1500;
    var state = JSON.parse(document.getElementById('survey-status').textContent);
    var sortKey = 'ipNum';
    var sortDir = 1;
    var pollTimer = null;

    var scanButton = document.getElementById('scan-button');
    var saveButton = document.getElementById('save-button');
    var progress = document.getElementById('scan-progress');
    var statusLine = document.getElementById('survey-status-line');
    var message = document.getElementById('survey-message');
    var table = document.getElementById('survey-table');
    var tbody = document.getElementById('survey-rows');
    var dialog = document.getElementById('details-dialog');

    // Names, titles and services come from whatever answers on the LAN, so
    // they are untrusted: everything goes in through textContent.
    function el(tag, value, className) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined && value !== null) node.textContent = String(value);
      return node;
    }

    function safeHref(url) {
      if (typeof url !== 'string') return null;
      return url.indexOf('http://') === 0 || url.indexOf('https://') === 0 ? url : null;
    }

    function link(href, label) {
      var a = el('a', label);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }

    function formatTime(iso) {
      if (!iso) return '';
      return new Date(iso).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    }

    function showMessage(text) {
      message.textContent = text;
    }

    function sortValue(row, key) {
      if (key === 'name') return (row.name || '').toLowerCase();
      if (key === 'vendor') return (row.privateMac ? 'private address' : (row.vendor || '')).toLowerCase();
      if (key === 'mac') return row.mac.toLowerCase();
      if (key === 'web') return row.web ? (row.web.title || row.web.url).toLowerCase() : '';
      return row[key];
    }

    function compareRows(a, b) {
      // Devices that did not answer stay below the ones that did, whatever
      // column is sorted.
      var gone = (a.status === 'gone' ? 1 : 0) - (b.status === 'gone' ? 1 : 0);
      if (gone !== 0) return gone;
      var av = sortValue(a, sortKey);
      var bv = sortValue(b, sortKey);
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return a.ipNum - b.ipNum;
    }

    function openDetails(row) {
      document.getElementById('details-title').textContent = row.name || row.ip;
      document.getElementById('details-meta').textContent = row.ip + ' · ' + row.mac;
      var ports = document.getElementById('details-ports');
      ports.textContent = '';
      row.ports.forEach(function (p) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', p.port, 'mono'));
        tr.appendChild(el('td', p.service));
        var webCell = el('td');
        var href = p.web ? safeHref(p.web.url) : null;
        if (href) {
          webCell.appendChild(link(href, p.web.title || href));
        } else {
          webCell.textContent = '—';
        }
        tr.appendChild(webCell);
        ports.appendChild(tr);
      });
      document.getElementById('details-ports-table').hidden = row.ports.length === 0;
      document.getElementById('details-no-ports').hidden = row.ports.length > 0;
      document.getElementById('details-services').textContent = row.services.length ? row.services.join(', ') : '—';
      document.getElementById('details-rtt').textContent = row.rttMs === null ? '—' : row.rttMs + ' ms';
      dialog.showModal();
    }

    function renderRows() {
      tbody.textContent = '';
      var rows = state.view.rows.slice().sort(compareRows);
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        if (row.status === 'gone') tr.className = 'gone';

        var statusCell = el('td');
        if (row.status !== 'unchanged') {
          statusCell.appendChild(el('span', row.status, 'badge badge-' + row.status));
        }
        tr.appendChild(statusCell);

        tr.appendChild(el('td', row.ip, 'mono'));

        var nameCell = el('td');
        var href = row.web ? safeHref(row.web.url) : null;
        if (href) {
          nameCell.appendChild(link(href, row.name || row.ip));
        } else {
          nameCell.appendChild(el('span', row.name || '—'));
        }
        if (row.nameSource) nameCell.appendChild(el('span', row.nameSource, 'source'));
        tr.appendChild(nameCell);

        tr.appendChild(el('td', row.privateMac ? 'Private address' : (row.vendor || '—')));
        tr.appendChild(el('td', row.mac, 'mono'));
        tr.appendChild(el('td', row.web ? (row.web.title || row.web.url) : '—'));

        var detailsCell = el('td');
        if (row.ports.length > 0 || row.services.length > 0) {
          var label = row.ports.length === 1 ? '1 port' : (row.ports.length > 1 ? row.ports.length + ' ports' : 'Details');
          var button = el('button', label, 'details-button');
          button.type = 'button';
          button.addEventListener('click', function () { openDetails(row); });
          detailsCell.appendChild(button);
        } else {
          detailsCell.textContent = '—';
        }
        tr.appendChild(detailsCell);

        tbody.appendChild(tr);
      });
      table.hidden = rows.length === 0;
    }

    function renderToolbar() {
      var scan = state.scan;
      var view = state.view;
      var running = scan.state === 'running';
      scanButton.disabled = running;
      saveButton.disabled = running || !view.unsaved;
      if (running) {
        progress.textContent = 'Scanning ' + scan.stageIndex + ' of ' + scan.stageCount + ': ' + (STAGE_LABELS[scan.stage] || scan.stage) + '…';
      } else if (scan.state === 'unavailable') {
        progress.textContent = 'Scanner unavailable';
      } else if (scan.state === 'failed') {
        progress.textContent = 'Last scan failed: ' + scan.error;
      } else {
        progress.textContent = '';
      }
      if (view.source === 'none') {
        statusLine.textContent = 'No saved survey yet. Run a scan.';
      } else if (view.source === 'saved') {
        statusLine.textContent = 'Saved survey · ' + formatTime(view.savedAt) + ' · ' + view.counts.devices + ' devices';
      } else {
        statusLine.textContent = 'Unsaved scan · ' + formatTime(view.scannedAt) + ' · ' + view.counts.devices + ' devices · ' + view.counts.new + ' new · ' + view.counts.gone + ' gone';
      }
    }

    function apply(status) {
      state = status;
      renderToolbar();
      renderRows();
      if (state.scan.state === 'running') schedulePoll();
    }

    function request(method, url) {
      return fetch(url, { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(function (response) {
          if (response.status === 401) {
            window.location.href = '/';
            throw new Error('signed out');
          }
          return response.json().catch(function () { return {}; }).then(function (body) {
            return { status: response.status, body: body };
          });
        });
    }

    function schedulePoll() {
      if (pollTimer) return;
      pollTimer = setTimeout(function () {
        pollTimer = null;
        request('GET', '/api/survey').then(function (r) {
          if (r.status !== 200) throw new Error('HTTP ' + r.status);
          showMessage('');
          apply(r.body);
        }).catch(function (err) {
          showMessage('Lost track of the scan (' + err.message + '), retrying.');
          if (state.scan.state === 'running') schedulePoll();
        });
      }, POLL_MS);
    }

    scanButton.addEventListener('click', function () {
      showMessage('');
      scanButton.disabled = true;
      request('POST', '/api/survey/scan').then(function (r) {
        if (r.status === 202) { apply(r.body); return; }
        // Already running, e.g. started in another tab: follow that scan.
        if (r.status === 409) { apply(r.body.status); return; }
        if (r.status === 503) { apply(r.body.status); showMessage('Scanner unavailable.'); return; }
        throw new Error('HTTP ' + r.status);
      }).catch(function (err) {
        showMessage('Could not start a scan: ' + err.message);
        renderToolbar();
      });
    });

    saveButton.addEventListener('click', function () {
      showMessage('');
      saveButton.disabled = true;
      request('POST', '/api/survey/save').then(function (r) {
        if (r.status === 200) { apply(r.body); return; }
        if (r.status === 409) { showMessage('Nothing to save: the scanner has no finished scan.'); renderToolbar(); return; }
        if (r.status === 503) { showMessage('Scanner unavailable, so its result could not be read. Nothing was saved.'); renderToolbar(); return; }
        throw new Error('HTTP ' + r.status);
      }).catch(function (err) {
        showMessage('Save failed (' + err.message + '). The unsaved scan is still shown.');
        renderToolbar();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort-key] button'), function (button) {
      button.addEventListener('click', function () {
        var key = button.parentElement.getAttribute('data-sort-key');
        if (key === sortKey) {
          sortDir = -sortDir;
        } else {
          sortKey = key;
          sortDir = 1;
        }
        Array.prototype.forEach.call(document.querySelectorAll('th[data-sort-key]'), function (th) {
          var active = th.getAttribute('data-sort-key') === sortKey;
          th.setAttribute('aria-sort', active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
        });
        renderRows();
      });
    });

    apply(state);
  })();
`;

const DETAILS_DIALOG = `
    <dialog id="details-dialog" aria-labelledby="details-title">
      <form method="dialog" class="dialog-close"><button type="submit" aria-label="Close">×</button></form>
      <h2 id="details-title"></h2>
      <p id="details-meta" class="mono"></p>
      <h3>Open ports</h3>
      <table id="details-ports-table">
        <thead><tr><th>Port</th><th>Likely use</th><th>Web</th></tr></thead>
        <tbody id="details-ports"></tbody>
      </table>
      <p id="details-no-ports" hidden>None of the common ports are open.</p>
      <h3>Services</h3>
      <p id="details-services"></p>
      <h3>Response time</h3>
      <p id="details-rtt"></p>
    </dialog>`;

export function renderIpSurveyPage(status: SurveyStatus): string {
  return renderDashboardShell({
    title: 'IP Survey',
    breadcrumb: [
      { label: 'Cards', href: '/' },
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'IP Survey' },
    ],
    extraCss: IP_SURVEY_CSS,
    script: IP_SURVEY_SCRIPT,
    body: `
      <h1>IP Survey</h1>
      <div class="toolbar">
        <button id="scan-button" type="button">Scan</button>
        <button id="save-button" type="button" disabled>Save</button>
        <span id="scan-progress" role="status" aria-live="polite"></span>
      </div>
      <p id="survey-status-line"></p>
      <p id="survey-message" role="alert"></p>
      <div class="table-wrap">
        <table id="survey-table" hidden>
          <thead>
            <tr>
              <th data-sort-key="statusRank" aria-sort="none"><button type="button">Status</button></th>
              <th data-sort-key="ipNum" aria-sort="ascending"><button type="button">IP</button></th>
              <th data-sort-key="name" aria-sort="none"><button type="button">Name</button></th>
              <th data-sort-key="vendor" aria-sort="none"><button type="button">Manufacturer</button></th>
              <th data-sort-key="mac" aria-sort="none"><button type="button">MAC</button></th>
              <th data-sort-key="web" aria-sort="none"><button type="button">Web</button></th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="survey-rows"></tbody>
        </table>
      </div>
      ${DETAILS_DIALOG}
      <script type="application/json" id="survey-status">${embedJson(status)}</script>`,
  });
}
```

- [ ] **Step 4: Add the route**

Replace `src/routes/dashboard.ts` with:

```ts
import { Request, Response, Router } from 'express';
import { requireAuthPage } from '../requireAuth';
import { renderDashboardPage } from '../views/dashboard';
import { renderIpSurveyPage } from '../views/ipSurvey';
import { loadSurveyStatus, SurveyDeps } from './survey';

export function createDashboardRouter(deps: SurveyDeps): Router {
  const router = Router();

  router.get('/dashboard', requireAuthPage, (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderDashboardPage());
  });

  // The current status is embedded in the page, so it renders complete on the
  // first response and only polls while a scan is running.
  router.get('/dashboard/ip-survey', requireAuthPage, async (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderIpSurveyPage(await loadSurveyStatus(deps)));
  });

  return router;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/ipSurveyPage.test.ts && npm run build && npm test`
Expected: 7 new tests pass; full suite passes.

- [ ] **Step 6: Check the script survived the template literal**

Run: `npm run build && node -e "const {renderIpSurveyPage}=require('./dist/views/ipSurvey');const h=renderIpSurveyPage({scan:{state:'idle'},view:{source:'none',scannedAt:null,savedAt:null,unsaved:false,rows:[],counts:{devices:0,new:0,gone:0}}});const s=h.split('<script>')[1].split('</script>')[0];new Function(s);console.log('script parses')"`
Expected: `script parses`. A syntax error here means an escape or backtick slipped into `IP_SURVEY_SCRIPT`.

- [ ] **Step 7: Commit**

```bash
git add src/views/ipSurvey.ts src/routes/dashboard.ts test/ipSurveyPage.test.ts
git commit -m "Add the IP Survey page: sortable table, details dialog, scan and save"
```

---

### Task 9: Fake scanner and signed-in e2e

**Files:**
- Create: `e2e/fakeScanner.ts`, `e2e/fixtures/scan-a.json`, `e2e/fixtures/scan-b.json`, `e2e/session.ts`, `e2e/dashboard.spec.ts`
- Modify: `package.json`, `.github/workflows/production-checks.yml`, `.env.example`

**Interfaces:**
- Consumes: scanner contract from Task 3 (`Device`, `ScanStage`, `ScanState`); element ids and classes from Task 8.
- Produces:
  - Fake scanner on `127.0.0.1:$FAKE_SCANNER_PORT` (default `9451`), token from `SCANNER_TOKEN`. Scans alternate fixtures A, B, A, …; each stage lasts `FAKE_SCANNER_STAGE_MS` (default 250). Test-only `POST /__fake/reset` restarts the alternation at A.
  - `sessionCookie(baseURL: string)` from `e2e/session.ts` → a Playwright cookie for the first `ALLOWED_EMAILS` address, signed with `COOKIE_SECRET`.
  - npm script `fake-scanner`.

- [ ] **Step 1: Create the fixtures**

Create `e2e/fixtures/scan-a.json`:

```json
[
  {
    "ip": "192.168.1.1", "mac": "04:42:1a:14:e8:00", "vendor": "ASUSTek COMPUTER INC.", "privateMac": false,
    "name": "RT-AX86U-14E8", "nameSource": "dns",
    "web": { "url": "http://192.168.1.1", "title": "ASUS Wireless Router RT-AX86U" },
    "services": [],
    "ports": [
      { "port": 53, "service": "DNS", "web": null },
      { "port": 80, "service": "Web", "web": { "url": "http://192.168.1.1", "title": "ASUS Wireless Router RT-AX86U" } }
    ],
    "rttMs": 2
  },
  {
    "ip": "192.168.1.9", "mac": "b8:27:eb:11:22:33", "vendor": "Raspberry Pi Foundation", "privateMac": false,
    "name": "Lab <b>bench</b>", "nameSource": "mdns", "web": null,
    "services": ["SSH"],
    "ports": [{ "port": 22, "service": "SSH", "web": null }],
    "rttMs": 4
  },
  {
    "ip": "192.168.1.10", "mac": "00:1b:a9:44:55:66", "vendor": "Brother Industries, Ltd.", "privateMac": false,
    "name": "Brother HL-L2350DW", "nameSource": "mdns",
    "web": { "url": "http://192.168.1.10", "title": "Brother HL-L2350DW" },
    "services": ["Printer"],
    "ports": [
      { "port": 80, "service": "Web", "web": { "url": "http://192.168.1.10", "title": "Brother HL-L2350DW" } },
      { "port": 631, "service": "Printer (IPP)", "web": null },
      { "port": 9100, "service": "Printer (raw)", "web": null }
    ],
    "rttMs": 12
  },
  {
    "ip": "192.168.1.50", "mac": "dc:a6:32:77:88:99", "vendor": "Raspberry Pi Trading Ltd", "privateMac": false,
    "name": "homeassistant.local", "nameSource": "mdns",
    "web": { "url": "http://192.168.1.50:8123", "title": "Home Assistant" },
    "services": ["Home Assistant"],
    "ports": [
      { "port": 22, "service": "SSH", "web": null },
      { "port": 8123, "service": "Home Assistant", "web": { "url": "http://192.168.1.50:8123", "title": "Home Assistant" } }
    ],
    "rttMs": 3
  },
  {
    "ip": "192.168.1.103", "mac": "18:66:da:aa:bb:cc", "vendor": "Dell Inc.", "privateMac": false,
    "name": "klaus-optiplex-9020", "nameSource": "dns", "web": null,
    "services": [],
    "ports": [{ "port": 22, "service": "SSH", "web": null }],
    "rttMs": null
  },
  {
    "ip": "192.168.1.120", "mac": "6a:1f:22:33:44:55", "vendor": null, "privateMac": true,
    "name": null, "nameSource": null, "web": null,
    "services": [], "ports": [], "rttMs": 35
  }
]
```

Create `e2e/fixtures/scan-b.json` — scan A without the printer (`192.168.1.10`) and with a Chromecast added:

```json
[
  {
    "ip": "192.168.1.1", "mac": "04:42:1a:14:e8:00", "vendor": "ASUSTek COMPUTER INC.", "privateMac": false,
    "name": "RT-AX86U-14E8", "nameSource": "dns",
    "web": { "url": "http://192.168.1.1", "title": "ASUS Wireless Router RT-AX86U" },
    "services": [],
    "ports": [
      { "port": 53, "service": "DNS", "web": null },
      { "port": 80, "service": "Web", "web": { "url": "http://192.168.1.1", "title": "ASUS Wireless Router RT-AX86U" } }
    ],
    "rttMs": 2
  },
  {
    "ip": "192.168.1.9", "mac": "b8:27:eb:11:22:33", "vendor": "Raspberry Pi Foundation", "privateMac": false,
    "name": "Lab <b>bench</b>", "nameSource": "mdns", "web": null,
    "services": ["SSH"],
    "ports": [{ "port": 22, "service": "SSH", "web": null }],
    "rttMs": 4
  },
  {
    "ip": "192.168.1.50", "mac": "dc:a6:32:77:88:99", "vendor": "Raspberry Pi Trading Ltd", "privateMac": false,
    "name": "homeassistant.local", "nameSource": "mdns",
    "web": { "url": "http://192.168.1.50:8123", "title": "Home Assistant" },
    "services": ["Home Assistant"],
    "ports": [
      { "port": 22, "service": "SSH", "web": null },
      { "port": 8123, "service": "Home Assistant", "web": { "url": "http://192.168.1.50:8123", "title": "Home Assistant" } }
    ],
    "rttMs": 3
  },
  {
    "ip": "192.168.1.103", "mac": "18:66:da:aa:bb:cc", "vendor": "Dell Inc.", "privateMac": false,
    "name": "klaus-optiplex-9020", "nameSource": "dns", "web": null,
    "services": [],
    "ports": [{ "port": 22, "service": "SSH", "web": null }],
    "rttMs": null
  },
  {
    "ip": "192.168.1.120", "mac": "6a:1f:22:33:44:55", "vendor": null, "privateMac": true,
    "name": null, "nameSource": null, "web": null,
    "services": [], "ports": [], "rttMs": 35
  },
  {
    "ip": "192.168.1.130", "mac": "f4:f5:d8:01:02:03", "vendor": "Google, Inc.", "privateMac": false,
    "name": "Living Room TV", "nameSource": "mdns", "web": null,
    "services": ["Chromecast"],
    "ports": [
      { "port": 8008, "service": "Chromecast", "web": null },
      { "port": 8009, "service": "Chromecast", "web": null }
    ],
    "rttMs": 8
  }
]
```

- [ ] **Step 2: Create the fake scanner**

Create `e2e/fakeScanner.ts`:

```ts
// A stand-in for the real scanner, implementing the same HTTP contract
// (src/survey/types.ts) from fixture data. Used by the e2e suite in CI and for
// local development: `npm run fake-scanner`. It never touches the network
// beyond its own listening socket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Device, ScanStage, ScanState } from '../src/survey/types';

const PORT = Number(process.env.FAKE_SCANNER_PORT ?? 9451);
const TOKEN = process.env.SCANNER_TOKEN ?? '';
const STAGE_MS = Number(process.env.FAKE_SCANNER_STAGE_MS ?? 250);
const STAGES: ScanStage[] = ['discovery', 'names', 'ports', 'web'];
const FIXTURES: Device[][] = ['scan-a.json', 'scan-b.json'].map(
  (file) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8')) as Device[],
);

if (!TOKEN) {
  console.error('SCANNER_TOKEN must be set (the same value the website uses)');
  process.exit(1);
}

let scanCount = 0;
let state: ScanState = { state: 'idle' };
let timers: NodeJS.Timeout[] = [];

function startScan(): void {
  const devices = FIXTURES[scanCount % FIXTURES.length];
  scanCount += 1;
  const startedAt = new Date().toISOString();
  state = { state: 'running', stage: STAGES[0], stageIndex: 1, stageCount: STAGES.length, startedAt };
  timers = STAGES.slice(1).map((stage, i) =>
    setTimeout(() => {
      state = { state: 'running', stage, stageIndex: i + 2, stageCount: STAGES.length, startedAt };
    }, (i + 1) * STAGE_MS),
  );
  timers.push(
    setTimeout(() => {
      state = { state: 'finished', result: { scannedAt: new Date().toISOString(), cidr: '192.168.1.0/24', devices } };
    }, STAGES.length * STAGE_MS),
  );
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake-scanner');
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { status: 'ok', service: 'www-scanner-fake', version: 'dev' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  if (url.pathname === '/scan' && req.method === 'GET') {
    send(res, 200, state);
    return;
  }
  if (url.pathname === '/scan' && req.method === 'POST') {
    if (state.state === 'running') {
      send(res, 409, { error: 'busy' });
      return;
    }
    startScan();
    send(res, 202, state);
    return;
  }
  // Test-only: lets a spec start from fixture A regardless of earlier runs.
  // The real scanner has no such route.
  if (url.pathname === '/__fake/reset' && req.method === 'POST') {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
    scanCount = 0;
    state = { state: 'idle' };
    send(res, 200, state);
    return;
  }
  send(res, 404, { error: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake scanner listening on 127.0.0.1:${PORT}`);
});
```

In `package.json` `scripts`, add after `"test:e2e"`:

```json
    "fake-scanner": "tsx --env-file=.env e2e/fakeScanner.ts"
```

(Remember the comma after the `test:e2e` line.)

- [ ] **Step 3: Create the session helper**

Create `e2e/session.ts`:

```ts
import jwt from 'jsonwebtoken';

// Signs a session the way the server does (src/session.ts), so signed-in
// specs need no Google login. COOKIE_SECRET and ALLOWED_EMAILS must match the
// server under test; CI sets both on the same step.
export function sessionCookie(baseURL: string) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('COOKIE_SECRET must be set to the server\'s value for signed-in e2e specs');
  }
  const email = (process.env.ALLOWED_EMAILS ?? '').split(',')[0].trim();
  if (!email) {
    throw new Error('ALLOWED_EMAILS must be set to the server\'s value for signed-in e2e specs');
  }
  return {
    name: 'session',
    value: jwt.sign({ email }, secret, { expiresIn: '10m' }),
    domain: new URL(baseURL).hostname,
    path: '/',
    httpOnly: true,
    // The server marks its own cookie Secure; this one is for http://localhost.
    secure: false,
    sameSite: 'Lax' as const,
  };
}
```

- [ ] **Step 4: Write the e2e spec**

Create `e2e/dashboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { sessionCookie } from './session';

test.describe('signed out', () => {
  test('the homepage has no Dashboard button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#dashboard-button')).toHaveCount(0);
  });

  test('dashboard pages send you back to the cards', async ({ page }) => {
    await page.goto('/dashboard/ip-survey');
    await expect(page).toHaveURL(/\/$/);
  });

  test('the survey API refuses requests', async ({ request }) => {
    expect((await request.get('/api/survey')).status()).toBe(401);
    expect((await request.post('/api/survey/scan')).status()).toBe(401);
    expect((await request.post('/api/survey/save')).status()).toBe(401);
  });
});

test.describe('signed in', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(baseURL!)]);
  });

  test('Dashboard sits left of Logout and leads to the survey and back', async ({ page }) => {
    await page.goto('/');
    const dashboard = page.locator('#dashboard-button');
    const logout = page.locator('#auth-button');
    await expect(dashboard).toBeVisible();
    await expect(logout).toHaveText('Logout');
    expect((await dashboard.boundingBox())!.x).toBeLessThan((await logout.boundingBox())!.x);

    await dashboard.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('link', { name: /IP Survey/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/ip-survey$/);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Cards' }).click();
    await expect(page.locator('h1')).toHaveText('Klaus Hofrichter');
  });
});

test.describe('IP survey against the fake scanner', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const scannerUrl = process.env.SCANNER_URL;
    const token = process.env.SCANNER_TOKEN;
    if (!scannerUrl || !token) {
      throw new Error('SCANNER_URL and SCANNER_TOKEN must point at e2e/fakeScanner.ts');
    }
    const reset = await request.post(`${scannerUrl}/__fake/reset`, { headers: { authorization: `Bearer ${token}` } });
    expect(reset.status()).toBe(200);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(baseURL!)]);
  });

  test('scan, sort, inspect, save, then see what changed', async ({ page }) => {
    const rows = page.locator('#survey-rows tr');
    const statusLine = page.locator('#survey-status-line');

    await page.goto('/dashboard/ip-survey');

    // Scan 1 (fixture A)
    await page.locator('#scan-button').click();
    await expect(statusLine).toContainText('Unsaved scan', { timeout: 15_000 });
    await expect(rows).toHaveCount(6);

    // IPs sort numerically: .9 before .10
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('192.168.1.1');
    await expect(rows.nth(1).locator('td').nth(1)).toHaveText('192.168.1.9');
    await expect(rows.nth(2).locator('td').nth(1)).toHaveText('192.168.1.10');
    await page.locator('th[data-sort-key="ipNum"] button').click();
    await expect(page.locator('th[data-sort-key="ipNum"]')).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('192.168.1.120');

    // Device-supplied names render as text, never as markup
    await expect(page.locator('#survey-rows').getByText('Lab <b>bench</b>')).toBeVisible();
    await expect(page.locator('#survey-rows b')).toHaveCount(0);

    // Randomized MAC is labelled, web devices are links
    await expect(page.locator('#survey-rows')).toContainText('Private address');
    await expect(page.locator('#survey-rows a[href="http://192.168.1.50:8123"]')).toHaveText('homeassistant.local');

    // Details dialog
    await rows.filter({ hasText: 'homeassistant.local' }).getByRole('button', { name: '2 ports' }).click();
    const dialog = page.locator('#details-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('8123');
    await expect(dialog.locator('a[href="http://192.168.1.50:8123"]')).toHaveText('Home Assistant');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Save, and it survives a reload
    await page.locator('#save-button').click();
    await expect(statusLine).toContainText('Saved survey');
    await expect(page.locator('#save-button')).toBeDisabled();
    await page.reload();
    await expect(statusLine).toContainText('Saved survey');
    await expect(rows).toHaveCount(6);

    // Scan 2 (fixture B): printer gone, Chromecast new
    await page.locator('#scan-button').click();
    await expect(statusLine).toContainText('1 new', { timeout: 15_000 });
    await expect(statusLine).toContainText('1 gone');
    await expect(page.locator('#survey-rows .badge-new')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Living Room TV' }).locator('.badge-new')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Brother HL-L2350DW' })).toHaveClass(/gone/);
    await expect(page.locator('#save-button')).toBeEnabled();
  });
});
```

- [ ] **Step 5: Run the suite locally**

```bash
mkdir -p "$TMPDIR/e2e-surveys" && rm -rf "$TMPDIR/e2e-surveys"/*
export COOKIE_SECRET=e2e-local-secret GOOGLE_CLIENT_ID=e2e GOOGLE_CLIENT_SECRET=e2e \
  GOOGLE_REDIRECT_URI=http://localhost:8090/auth/google/callback ALLOWED_EMAILS=klaus@klaushofrichter.net \
  SCANNER_URL=http://127.0.0.1:9451 SCANNER_TOKEN=e2e-scanner-token FAKE_SCANNER_PORT=9451 \
  SURVEY_DIR="$TMPDIR/e2e-surveys" PORT=8090
npm run build
npx tsx e2e/fakeScanner.ts & echo $! > "$TMPDIR/fake.pid"
npm start & echo $! > "$TMPDIR/server.pid"
until curl -sf http://localhost:8090/health >/dev/null && curl -sf http://127.0.0.1:9451/health >/dev/null; do sleep 0.5; done
BASE_URL=http://localhost:8090 npx playwright test
kill "$(cat "$TMPDIR/server.pid")" "$(cat "$TMPDIR/fake.pid")"
```

Expected: all specs pass — the 4 in `smoke.spec.ts` plus 5 in `dashboard.spec.ts`.

(`npm start`, not `npm run dev`: `dev` loads `.env`, which would override the exported values.)

- [ ] **Step 6: Wire the fake scanner into CI**

In `.github/workflows/production-checks.yml`, replace the whole `- name: Start the server and run the smoke test` step with:

```yaml
      - name: Start the server and fake scanner, run the e2e suite
        env:
          # Shared by the server and the signed-in specs, which sign their own
          # session cookie with it (e2e/session.ts). Not a real secret.
          COOKIE_SECRET: e2e-cookie-secret-not-used-for-anything-real
          GOOGLE_CLIENT_ID: e2e
          GOOGLE_CLIENT_SECRET: e2e
          GOOGLE_REDIRECT_URI: http://localhost:8080/auth/google/callback
          ALLOWED_EMAILS: klaus@klaushofrichter.net
          # The survey specs run against e2e/fakeScanner.ts. CI never scans a
          # real network.
          SCANNER_URL: http://127.0.0.1:9451
          SCANNER_TOKEN: e2e-scanner-token
          FAKE_SCANNER_PORT: '9451'
          SURVEY_DIR: ${{ runner.temp }}/surveys
        run: |
          set -euo pipefail
          npx tsx e2e/fakeScanner.ts &
          echo $! > /tmp/fake-scanner.pid
          npm start &
          echo $! > /tmp/server.pid
          for i in $(seq 1 20); do
            if curl -sf http://localhost:8080/health >/dev/null && curl -sf http://127.0.0.1:9451/health >/dev/null; then
              break
            fi
            echo "waiting for server and fake scanner (${i}/20)"; sleep 2
          done
          curl -sf http://localhost:8080/health >/dev/null \
            || { echo "::error::server did not come up"; exit 1; }
          curl -sf http://127.0.0.1:9451/health >/dev/null \
            || { echo "::error::fake scanner did not come up"; exit 1; }
          npm run test:e2e
          kill "$(cat /tmp/server.pid)" "$(cat /tmp/fake-scanner.pid)" || true
```

- [ ] **Step 7: Document local development in `.env.example`**

Append to `.env.example`:

```
# IP Survey. For local development run `npm run fake-scanner` and point at it;
# in production these come from the scanner Secret.
SCANNER_URL=http://127.0.0.1:9451
SCANNER_TOKEN=dev-scanner-token
FAKE_SCANNER_PORT=9451
```

- [ ] **Step 8: Commit**

```bash
git add e2e/fakeScanner.ts e2e/fixtures/scan-a.json e2e/fixtures/scan-b.json e2e/session.ts e2e/dashboard.spec.ts package.json .github/workflows/production-checks.yml .env.example
git commit -m "Test the dashboard end to end against a fake scanner"
```

---

### Task 10: Container, docs, and the PVC

**Files:**
- Modify: `Dockerfile`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`
- Create (in `../kube-setup`): `manifests/www-klaushofrichter/www-data-pvc.yaml`
- Modify (in `../kube-setup`): `manifests/www-klaushofrichter/www-ksvc.yaml`

**Interfaces:**
- Consumes: `SURVEY_DIR` default `/app/data/surveys` (Task 4); `SCANNER_URL`/`SCANNER_TOKEN` (Task 3).

- [ ] **Step 1: Create the mount point in the image**

In `Dockerfile`, replace:

```dockerfile
RUN mkdir -p /app/data/images && chown -R node:node /app/data
```

with:

```dockerfile
# data/surveys is where the www-data PVC mounts. Created here too, so a pod
# without the volume still starts and can save (to container storage that a
# restart discards).
RUN mkdir -p /app/data/images /app/data/surveys && chown -R node:node /app/data
```

- [ ] **Step 2: Verify the image**

Run: `docker build -t www-khf:dashboard . && docker run --rm www-khf:dashboard sh -c 'ls -ld /app/data/surveys && id'`
Expected: directory owned by `node`; `uid=1000(node)`. Then `docker rmi www-khf:dashboard`.

- [ ] **Step 3: Update `README.md`**

Add to the `## API` list, after the `/public` entry:

```markdown
- `GET /dashboard`, `GET /dashboard/ip-survey` — signed-in pages (see
  "Dashboard"). Signed-out requests are redirected to `/`.
- `GET /api/survey`, `POST /api/survey/scan`, `POST /api/survey/save` — the IP
  Survey API. Signed-out requests get `401`.
```

Add a new section before `## Development`:

```markdown
## Dashboard

Signed in, a **Dashboard** button appears left of Logout. It is omitted from
the markup for everyone else, and every `/dashboard*` page and `/api/survey*`
route is guarded server-side by `src/requireAuth.ts` — which also re-checks
`ALLOWED_EMAILS` on each request, so removing an address takes effect
immediately rather than when its cookie expires.

### IP Survey

`/dashboard/ip-survey` lists every device on the home LAN: IP, MAC,
manufacturer, name (with where it came from), web page title, and a Details
dialog for open ports, services and response time. **Scan** asks the scanner
for a fresh survey; **Save** stores the scanner's finished result as
`latest.json` under `SURVEY_DIR` (the `www-data` PVC in production, mounted at
`/app/data/surveys`). A new scan is compared with the saved one by MAC
address, marking devices *new* or *gone*.

The scan itself runs in a separate privileged scanner service (see
`docs/superpowers/specs/2026-09-17-ip-survey-design.md`). The website reaches
it at `SCANNER_URL` with the bearer token in `SCANNER_TOKEN`; if either is
unset or the scanner is down, the page says "Scanner unavailable" and keeps
showing the saved survey.

For local work, `npm run fake-scanner` serves fixture data under the same
contract (`e2e/fakeScanner.ts`); set `SCANNER_URL`/`SCANNER_TOKEN` in `.env`
as in `.env.example`.
```

In `## End-to-end smoke test`, after the sentence ending "and that the page
header shows it", add:

```markdown
`e2e/dashboard.spec.ts` covers the Dashboard signed out and signed in, and the
IP Survey against `e2e/fakeScanner.ts`: scan, numeric IP sort, the Details
dialog, Save, and the new/gone comparison. Signed-in specs sign their own
session cookie (`e2e/session.ts`) with the server's `COOKIE_SECRET`, so both
must be set to the same value. To run the whole suite locally:

    mkdir -p "$TMPDIR/e2e-surveys" && rm -rf "$TMPDIR/e2e-surveys"/*
    export COOKIE_SECRET=e2e-local-secret GOOGLE_CLIENT_ID=e2e GOOGLE_CLIENT_SECRET=e2e \
      GOOGLE_REDIRECT_URI=http://localhost:8090/auth/google/callback \
      ALLOWED_EMAILS=klaus@klaushofrichter.net \
      SCANNER_URL=http://127.0.0.1:9451 SCANNER_TOKEN=e2e-scanner-token \
      FAKE_SCANNER_PORT=9451 SURVEY_DIR="$TMPDIR/e2e-surveys" PORT=8090
    npm run build
    npx tsx e2e/fakeScanner.ts & npm start &
    BASE_URL=http://localhost:8090 npx playwright test
```

(`npm start`, not `npm run dev`: `dev` loads `.env` and would override those
values.)

- [ ] **Step 4: Update `CHANGELOG.md`**

Under `## [Unreleased]` → `### Added`, insert at the top:

```markdown
- A signed-in **Dashboard** (button left of Logout) with an **IP Survey**
  page: sortable device table, per-device Details dialog, Save to persistent
  storage, and new/gone comparison against the saved survey. Works against
  the scanner API; the scanner itself ships separately.
```

- [ ] **Step 5: Update `CLAUDE.md`**

Add a section after `## Versioning and releases`:

```markdown
## Signed-in routes

Anything under `/dashboard` or `/api/survey` must use `requireAuthPage` /
`requireAuthApi` from `src/requireAuth.ts`. Hiding a link is not access
control: the Dashboard button is omitted for signed-out visitors, but the
routes are what actually refuse them. `currentUser` is the one definition of
"signed in" — it re-checks `ALLOWED_EMAILS`, so use it rather than calling
`verifySession` directly.

Device data shown on the IP Survey page comes from the LAN and is untrusted.
The browser script inserts it with `textContent` only; keep it that way.
```

- [ ] **Step 6: Run everything and commit**

Run: `npm run build && npm test` and the Playwright block from Task 9 Step 5.
Expected: all pass.

```bash
git add Dockerfile README.md CHANGELOG.md CLAUDE.md
git commit -m "Document the Dashboard and create the survey mount point"
```

- [ ] **Step 7: Prepare the PVC in `kube-setup`**

In `../kube-setup` (run `git pull` first; another session also works there):

Create `manifests/www-klaushofrichter/www-data-pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: www-data
  namespace: www-klaushofrichter
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
  storageClassName: local-path
```

In `manifests/www-klaushofrichter/www-ksvc.yaml`, under `spec.template.metadata.annotations`, add:

```yaml
        backup.velero.io/backup-volumes: www-data
```

Under the container (after `envFrom`), add:

```yaml
        volumeMounts:
        - mountPath: /app/data/surveys
          name: www-data
```

And under `spec.template.spec` (sibling of `containers`), add:

```yaml
      volumes:
      - name: www-data
        persistentVolumeClaim:
          claimName: www-data
```

**Do not commit or push the `www-ksvc.yaml` change yet.** The deploy workflow applies that file from `kube-setup` `main`; if the mount lands before the PVC exists, the next revision cannot start.

- [ ] **Step 8: Hand off to the user (cluster access required)**

Stop and ask the user to run, from `../kube-setup`:

```bash
kubectl apply -f manifests/www-klaushofrichter/www-data-pvc.yaml
kubectl get pvc www-data -n www-klaushofrichter
```

Expected: `Pending` (local-path binds on first use) or `Bound`. Only after that: commit and push both `kube-setup` files, and message the `kube-setup` session that `www-klaushofrichter` now mounts a PVC.

- [ ] **Step 9: Ship and verify**

Open a PR `main` → `production`, wait for `test`, `e2e`, `codeql`, merge, watch the deploy. Then:

- Signed out: `curl -s https://www.klaushofrichter.net/ | grep -c dashboard-button` → `0`; `curl -s -o /dev/null -w '%{http_code}' https://www.klaushofrichter.net/api/survey` → `401`.
- Signed in (browser): Dashboard button → IP Survey shows "Scanner unavailable" and "No saved survey yet. Run a scan." (expected until the scanner plan ships).
- Ask the user to confirm the PVC is writable by the app user:

```bash
POD=$(kubectl get pod -n www-klaushofrichter -l serving.knative.dev/service=www-klaushofrichter -o name | head -1)
kubectl exec -n www-klaushofrichter "$POD" -c user-container -- sh -c 'touch /app/data/surveys/.w && rm /app/data/surveys/.w && echo writable'
```

Expected: `writable`. If it prints `Permission denied`, the local-path directory is not writable by uid 1000; stop and report it — the fix belongs in the scanner plan's cluster changes, not a workaround here.

---

## Prerequisite for the scanner plan

Before a real scanner can be pointed at this website, `isScanState` in
`src/survey/scannerClient.ts` must also validate each element of
`result.devices` (at minimum: `ip` and `mac` present and strings). Today it
checks only that `devices` is an array, so a device object missing `mac` is
persisted by Save and then throws in `compareToSaved` on every later request —
`GET /api/survey` and `/dashboard/ip-survey` return 500 permanently, and
recovery means deleting `latest.json` from the PVC by hand. Unreachable while
the only producer is the fixture-driven fake scanner and production has no
`SCANNER_URL`. `readSavedSurvey` casts the on-disk file with no validation
either, which fails the same way if `latest.json` is ever corrupted.

## Next plan

`2026-09-XX-ip-survey-scanner.md` (written after this one ships): the privileged scanner in `scanner/` implementing the contract in `src/survey/types.ts` — `arp-scan` discovery, mDNS/SSDP/reverse-DNS names, port and web probes, `/health` — plus its image, the `www-scanner` Deployment, token Secret, runner Role change, the two-image deploy, and the first real scan.
