# Google OAuth Login and Gated Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google OAuth "Login"/"Logout" button (top-right of the homepage) that only allows `klaus@klaushofrichter.net` to sign in, and reveal an auth-gated `status.klaushofrichter.net` card once logged in.

**Architecture:** Stateless signed-JWT cookie session (no session store), mirroring the working pattern already in production in the sibling `steps-service` repo (`google-auth-library` + `jsonwebtoken` + `cookie-parser`). `GET /` always renders 200; it just filters which cards it includes based on whether the request carries a valid session cookie.

**Tech Stack:** Express/TypeScript, Vitest+Supertest, `google-auth-library`, `jsonwebtoken`, `cookie-parser`, `express-rate-limit` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-08-21-google-oauth-design.md`

## Global Constraints

- Only `klaus@klaushofrichter.net` may authenticate successfully (exact match against `ALLOWED_EMAILS`, comma-separated env var).
- No CSRF `state` parameter in the OAuth flow (matches `steps-service`; no sensitive action is gated behind the callback beyond setting a cookie).
- No session store — sessions are self-contained signed JWTs, 7-day expiry, cookie name `session`, `httpOnly: true`, `secure: true`, `sameSite: 'lax'`.
- `GET /` must always return 200 and never redirect based on auth state — only the set of rendered cards and the header button text/link change.
- New dependency versions must match what's already pinned in `steps-service/package.json`: `cookie-parser@^1.4.7`, `google-auth-library@^10.9.1`, `jsonwebtoken@^9.0.3`, `@types/cookie-parser@^1.4.10`, `@types/jsonwebtoken@^9.0.10`.
- Local dev secrets go in a gitignored `.env` (already in `.gitignore`), loaded via `tsx --env-file=.env`, documented in a checked-in `.env.example` with placeholder values — never real secrets committed.
- Production secrets live in a Kubernetes Secret (`www-oauth` in the `www` namespace, `kube-setup` repo), never in this repo.

---

## Task 1: Test/dev environment scaffolding and new dependencies

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `test/setup.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `process.env.GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_SECRET`, `ALLOWED_EMAILS` are set to test values in every Vitest run via `test/setup.ts`. All later tasks' tests rely on this.

- [ ] **Step 1: Add the new dependencies**

Run:
```bash
npm install cookie-parser@^1.4.7 google-auth-library@^10.9.1 jsonwebtoken@^9.0.3
npm install --save-dev @types/cookie-parser@^1.4.10 @types/jsonwebtoken@^9.0.10
```

- [ ] **Step 2: Point the `dev` script at a local `.env` file**

In `package.json`, change:
```json
"dev": "tsx src/server.ts",
```
to:
```json
"dev": "tsx --env-file=.env src/server.ts",
```

- [ ] **Step 3: Create `.env.example`**

```
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback
COOKIE_SECRET=generate-with-openssl-rand-hex-32
ALLOWED_EMAILS=klaus@klaushofrichter.net
```

- [ ] **Step 4: Create `test/setup.ts`**

```ts
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:8080/auth/google/callback';
process.env.COOKIE_SECRET = 'test-cookie-secret-value';
process.env.ALLOWED_EMAILS = 'allowed@example.com';
```

- [ ] **Step 5: Wire the setup file into Vitest**

In `vitest.config.ts`, change:
```ts
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'e2e/**'],
  },
});
```
to:
```ts
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'e2e/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 6: Run the existing suite to confirm nothing broke**

Run: `npx vitest run`
Expected: all 31 existing tests still pass (this task adds no new tests of its own — it's pure scaffolding for later tasks).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/setup.ts .env.example
git commit -m "Add OAuth dependencies and test env scaffolding"
```

---

## Task 2: Session signing/verification

**Files:**
- Create: `src/session.ts`
- Test: `test/session.test.ts`

**Interfaces:**
- Consumes: `process.env.COOKIE_SECRET` (set by `test/setup.ts` in tests; required in production via the `www-oauth` Secret).
- Produces: `signSession(email: string): string`, `verifySession(token: string): SessionPayload | null`, `interface SessionPayload { email: string }` — consumed by Task 3 (`auth.ts`) and Task 5 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `test/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signSession, verifySession } from '../src/session';

describe('signSession / verifySession', () => {
  it('round-trips a valid session', () => {
    const token = signSession('allowed@example.com');
    const result = verifySession(token);

    expect(result).toEqual({ email: 'allowed@example.com' });
  });

  it('returns null for a garbage token', () => {
    expect(verifySession('not-a-real-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = jwt.sign({ email: 'allowed@example.com' }, 'wrong-secret');
    expect(verifySession(token)).toBeNull();
  });

  it('returns null for an expired token', () => {
    const expired = jwt.sign(
      { email: 'allowed@example.com', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.COOKIE_SECRET as string
    );
    expect(verifySession(expired)).toBeNull();
  });

  it('returns null for a validly-signed token missing an email claim', () => {
    const noEmail = jwt.sign({ foo: 'bar' }, process.env.COOKIE_SECRET as string);
    expect(verifySession(noEmail)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — `Cannot find module '../src/session'`.

- [ ] **Step 3: Implement `src/session.ts`**

```ts
import jwt from 'jsonwebtoken';

export interface SessionPayload {
  email: string;
}

function getCookieSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('COOKIE_SECRET is not set');
  }
  return secret;
}

export function signSession(email: string): string {
  return jwt.sign({ email }, getCookieSecret(), { expiresIn: '7d' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getCookieSecret());
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof (decoded as { email?: unknown }).email === 'string'
    ) {
      return { email: (decoded as { email: string }).email };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.ts test/session.test.ts
git commit -m "Add signed JWT session helpers"
```

---

## Task 3: Auth routes (login, callback, logout)

**Files:**
- Create: `src/routes/auth.ts`
- Modify: `src/app.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `signSession` from `src/session.ts` (Task 2).
- Produces: `authRouter` (Express `Router`), mounted in `src/app.ts`, exposing `GET /auth/google/login`, `GET /auth/google/callback`, `GET /auth/logout`. Task 5 relies on `GET /auth/google/login` and `GET /auth/logout` as the hrefs rendered by the page.

- [ ] **Step 1: Write the failing tests**

Create `test/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getTokenMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    getToken: getTokenMock,
    verifyIdToken: verifyIdTokenMock,
  })),
}));

import { createApp } from '../src/app';

describe('GET /auth/google/login', () => {
  it('redirects to the Google OAuth consent screen', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/google/login');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(response.headers.location).toContain('client_id=test-client-id');
    expect(response.headers.location).toContain('scope=openid+email');
  });
});

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('redirects to /?auth_error=1 with no code', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/google/callback');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('redirects to /?auth_error=1 when the token exchange fails', async () => {
    getTokenMock.mockRejectedValue(new Error('exchange failed'));

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sets a session cookie and redirects to / for an allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']?.[0]).toContain('session=');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
  });

  it('redirects to /?auth_error=1 with no cookie for a non-allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'stranger@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('redirects to /?auth_error=1 when the email is unverified, even if allowlisted', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: false }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('GET /auth/google/callback rate limiting', () => {
  it('rate-limits repeated requests', async () => {
    const app = createApp();
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).get('/auth/google/callback');
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('GET /auth/logout', () => {
  it('clears the session cookie and redirects to /', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    const setCookieHeader = response.headers['set-cookie']?.[0];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('session=;');
  });

  it('redirects to / and clears the cookie even with no existing session', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — `Cannot find module '../src/routes/auth'` (via `app.ts` not yet importing it) or 404s, since the routes don't exist yet.

- [ ] **Step 3: Implement `src/routes/auth.ts`**

```ts
import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import rateLimit from 'express-rate-limit';
import { signSession } from '../session';

export const authRouter = Router();

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

const authCallbackRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

authRouter.get('/auth/google/login', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'openid email',
  });
  res.redirect(302, `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
});

authRouter.get(
  '/auth/google/callback',
  authCallbackRateLimit,
  async (req: Request, res: Response) => {
    const code = req.query.code;

    if (typeof code !== 'string' || code.length === 0) {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    let email: string | undefined;
    try {
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token ?? '',
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload?.email_verified ? payload.email : undefined;
    } catch {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    if (!email || !getAllowedEmails().includes(email)) {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    res.cookie(SESSION_COOKIE, signSession(email), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.redirect(302, '/');
  }
);

authRouter.get('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  res.redirect(302, '/');
});
```

- [ ] **Step 4: Mount `authRouter` in `src/app.ts`**

```ts
import express, { Express } from 'express';
import path from 'path';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';

export function createApp(): Express {
  const app = express();
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(indexRouter);
  return app;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add src/routes/auth.ts src/app.ts test/auth.test.ts
git commit -m "Add Google OAuth login/callback/logout routes"
```

---

## Task 4: Auth-gated `status` card

**Files:**
- Modify: `src/links.ts`
- Test: `test/links.test.ts` (new)

**Interfaces:**
- Produces: `Link.requiresAuth?: boolean` field; a new entry in the exported `links` array with `id: 'status'`, `requiresAuth: true`. Task 5 (`page.ts`) filters on this field.

- [ ] **Step 1: Write the failing test**

Create `test/links.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { links } from '../src/links';

describe('links', () => {
  it('includes an auth-gated status card', () => {
    const status = links.find((link) => link.id === 'status');

    expect(status).toBeDefined();
    expect(status?.requiresAuth).toBe(true);
    expect(status?.url).toBe('https://status.klaushofrichter.net');
  });

  it('does not mark the existing public cards as auth-gated', () => {
    const publicIds = ['linkedin', 'github', 'portfolio2017', 'instagram', 'threepuppies', 'medium', 'skylar'];

    for (const id of publicIds) {
      const link = links.find((l) => l.id === id);
      expect(link?.requiresAuth).toBeFalsy();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/links.test.ts`
Expected: FAIL — no `status` entry found (`status` is `undefined`).

- [ ] **Step 3: Implement**

In `src/links.ts`, add the field to the interface:
```ts
export interface Link {
  id: string;
  title: string;
  url: string;
  abstract: string;
  gradient: string;
  requiresAuth?: boolean;
}
```

Add a new entry at the end of the `links` array (after `skylar`):
```ts
  {
    id: 'status',
    title: 'Status',
    url: 'https://status.klaushofrichter.net',
    abstract: 'Live uptime and status monitoring for my services.',
    gradient: 'linear-gradient(135deg, #16a34a, #0891b2)',
    requiresAuth: true,
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/links.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests still pass — the existing `test/index.test.ts` "all 7 card titles" test stays green because it never asserts an authenticated request, so the new 8th (`status`) card stays hidden by default; no existing test asserts an exhaustive/exclusive card count so nothing else needs updating here.

- [ ] **Step 6: Commit**

```bash
git add src/links.ts test/links.test.ts
git commit -m "Add auth-gated status card to the link list"
```

---

## Task 5: Page rendering — auth button, card filtering, and session cookie wiring

**Files:**
- Modify: `src/views/page.ts`
- Modify: `src/app.ts`
- Modify: `src/routes/index.ts`
- Modify: `test/page.test.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: `Link.requiresAuth` (Task 4), `verifySession` (Task 2).
- Produces: `renderPage(isAuthenticated: boolean): string` — signature change from the current no-argument `renderPage()`. `GET /` derives `isAuthenticated` from the `session` cookie via `cookie-parser` + `verifySession` and passes it straight to `renderPage`. This task changes the signature and updates its only call site in the same commit, so the build is never left broken.

- [ ] **Step 1: Update the existing page tests for the new signature, and write the failing new tests**

Replace the full contents of `test/page.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/refreshImages', () => ({
  hasImage: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/staticCards', () => ({
  hasStaticCard: vi.fn().mockReturnValue(false),
  staticCardUrl: vi.fn((id: string) => `/assets/cards/${id}.png`),
}));

import { hasImage } from '../src/refreshImages';
import { hasStaticCard } from '../src/staticCards';
import { renderPage } from '../src/views/page';

const mockedHasImage = vi.mocked(hasImage);
const mockedHasStaticCard = vi.mocked(hasStaticCard);

describe('renderPage card images', () => {
  beforeEach(() => {
    mockedHasImage.mockReset();
    mockedHasImage.mockReturnValue(false);
    mockedHasStaticCard.mockReset();
    mockedHasStaticCard.mockReturnValue(false);
  });

  it('uses the static card asset when one exists, in preference to a dynamic image', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');
    mockedHasImage.mockReturnValue(true);

    const html = renderPage(false);

    expect(html).toContain('src="/assets/cards/linkedin.png"');
  });

  it('falls back to the dynamic /images/:id route when no static card exists', () => {
    mockedHasStaticCard.mockReturnValue(false);
    mockedHasImage.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage(false);

    expect(html).toContain('src="/images/linkedin"');
  });

  it('wraps the card image area in a link to the card URL', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage(false);

    expect(html).toContain(
      '<a class="card-image" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);" href="https://www.linkedin.com/in/klaushofrichter" target="_blank" rel="noopener noreferrer">'
    );
  });
});

describe('renderPage auth-gated cards and login button', () => {
  it('hides auth-gated cards and shows a Login link when logged out', () => {
    const html = renderPage(false);

    expect(html).not.toContain('>Status<');
    expect(html).toContain('id="auth-button" href="/auth/google/login">Login</a>');
    expect(html).not.toContain('href="/auth/logout"');
  });

  it('shows auth-gated cards and a Logout link when logged in', () => {
    const html = renderPage(true);

    expect(html).toContain('>Status<');
    expect(html).toContain('id="auth-button" href="/auth/logout">Logout</a>');
    expect(html).not.toContain('href="/auth/google/login"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/page.test.ts`
Expected: FAIL — `renderPage` currently takes no arguments (TypeScript compile error) and the auth-button markup doesn't exist yet.

- [ ] **Step 3: Implement the changes in `src/views/page.ts`**

Change the function signature and card filtering:
```ts
export function renderPage(isAuthenticated: boolean): string {
  const visibleLinks = links.filter((link) => !link.requiresAuth || isAuthenticated);
  const cards = visibleLinks.map(renderCard).join('\n');
  const authButtonMarkup = isAuthenticated
    ? '<a id="auth-button" href="/auth/logout">Logout</a>'
    : '<a id="auth-button" href="/auth/google/login">Login</a>';
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
    <div class="header-actions">
      ${authButtonMarkup}
      <button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>
    </div>
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
    <script>${REFRESH_SCRIPT}${AUTH_ERROR_SCRIPT}</script>
  </body>
</html>`;
}
```

Update `PAGE_CSS`: replace the `#refresh-button` block (which currently carries `position: fixed; top: 16px; right: 16px;`) with a `.header-actions` wrapper plus an `#auth-button` style, and strip the now-redundant fixed-positioning from `#refresh-button`:
```css
  .header-actions {
    position: fixed; top: 16px; right: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  #auth-button {
    display: inline-flex; align-items: center; justify-content: center;
    height: 36px; padding: 0 14px; border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 12px; text-decoration: none;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #auth-button:hover { opacity: 1; }
  #refresh-button {
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 16px; cursor: pointer;
    opacity: 0.35; transition: opacity 0.2s;
  }
```
(the `#refresh-button.loading`, `@keyframes spin`, and `#refresh-message` rules stay exactly as they are today — only the block shown above changes.)

Add a new script constant, defined right after `REFRESH_SCRIPT`:
```ts
const AUTH_ERROR_SCRIPT = `
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      var message = document.getElementById('refresh-message');
      message.textContent = 'Login failed — only klaus@klaushofrichter.net can sign in.';
      message.classList.add('visible');
      setTimeout(function () { message.classList.remove('visible'); }, 6000);
      params.delete('auth_error');
      var newSearch = params.toString();
      var newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }
  })();
`;
```

- [ ] **Step 4: Update `test/index.test.ts` for cookie-driven auth state**

Add near the top, alongside the other imports:
```ts
import { signSession } from '../src/session';
```

Add these tests inside (or after) the existing `describe('GET /', ...)` block:
```ts
  it('does not render the status card or a Logout link with no session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.text).not.toContain('>Status<');
    expect(response.text).toContain('href="/auth/google/login">Login</a>');
  });

  it('renders the status card and a Logout link with a valid session cookie', async () => {
    const app = createApp();
    const token = signSession('allowed@example.com');
    const response = await request(app).get('/').set('Cookie', `session=${token}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('>Status<');
    expect(response.text).toContain('href="/auth/logout">Logout</a>');
  });

  it('renders logged out when the session cookie is garbage', async () => {
    const app = createApp();
    const response = await request(app).get('/').set('Cookie', 'session=not-a-real-token');

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('>Status<');
  });
```

- [ ] **Step 5: Add `cookie-parser` middleware in `src/app.ts`**

```ts
import express, { Express } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';

export function createApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(indexRouter);
  return app;
}
```

- [ ] **Step 6: Update `src/routes/index.ts` to read the cookie and call the new `renderPage` signature**

```ts
import { Router, Request, Response } from 'express';
import { renderPage } from '../views/page';
import { refreshAllImages } from '../refreshImages';
import { verifySession } from '../session';

export const indexRouter = Router();

const REFRESH_COOLDOWN_MS = 60_000;
let lastRefresh = 0;

indexRouter.get('/', (req: Request, res: Response) => {
  const token = req.cookies?.session;
  const session = typeof token === 'string' ? verifySession(token) : null;
  res.status(200).type('html').send(renderPage(session !== null));
});

indexRouter.post('/refresh', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
    res.status(429).json({ error: 'cooldown' });
    return;
  }
  lastRefresh = now;
  try {
    await refreshAllImages();
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Manual image refresh failed', err);
    lastRefresh = 0;
    res.status(500).json({ error: 'refresh failed' });
  }
});
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass — `test/page.test.ts` (5 tests) and `test/index.test.ts` (all tests including the 3 new ones), plus every previously-passing test in the repo.

- [ ] **Step 8: Commit**

```bash
git add src/views/page.ts src/app.ts src/routes/index.ts test/page.test.ts test/index.test.ts
git commit -m "Add Login/Logout button, auth-gated card filtering, and session cookie wiring"
```

---


## Task 6: Capture and add the `status` card screenshot

**Files:**
- Create: `assets/cards/status.png`
- Modify: `src/links.ts` (abstract text only, if it needs adjusting after seeing the real page)
- Modify: `test/staticCards.test.ts`

**Interfaces:**
- Consumes: `STATIC_CARDS_DIR` convention from `src/staticCards.ts` (unchanged — any `assets/cards/<id>.png` file is picked up automatically, no code change needed for the card to start using its static image).

- [ ] **Step 1: Capture the screenshot**

`https://status.klaushofrichter.net` redirects (301) to a public UptimeRobot status page (`https://stats.uptimerobot.com/8tOmmY5B64`) — confirmed reachable during design. Write a throwaway script (same pattern as the `skylar` and other card captures — see git history for `capture-skylar.mjs`), run it from the project root so Playwright's transitive dependency resolves, then delete the script:

```js
import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  userAgent: UA,
});
const page = await context.newPage();
await page.goto('https://status.klaushofrichter.net', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'assets/cards/status.png' });
await browser.close();
console.log('done');
```

Run: `node capture-status.mjs && rm capture-status.mjs`

- [ ] **Step 2: Show the screenshot to the user for approval**

Send `assets/cards/status.png` to the user (e.g. via the `SendUserFile` tool) before proceeding. If they want a different abstract/title/gradient after seeing the real page, update the `status` entry in `src/links.ts` accordingly. Do not continue to Step 3 without approval.

- [ ] **Step 3: Extend `test/staticCards.test.ts`**

Add a case to the existing `describe('hasStaticCard', ...)` block:
```ts
  it('returns true for the status card once its asset exists', () => {
    expect(hasStaticCard('status')).toBe(true);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/staticCards.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add assets/cards/status.png test/staticCards.test.ts src/links.ts
git commit -m "Add approved screenshot for the status card"
```

---

## Task 7: Update this repo's docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `README.md`**

Add a new section after "Image refresh" (or wherever that section currently ends) describing the login flow:

```markdown
## Login

A "Login" button in the top-right corner starts a Google OAuth sign-in
(`GET /auth/google/login`). Only `klaus@klaushofrichter.net` (configured
via the `ALLOWED_EMAILS` env var) can complete it — anyone else is sent
back to `/` with an error toast. Once logged in, the button becomes
"Logout" (`GET /auth/logout`), and cards marked as auth-gated (currently
just the `status.klaushofrichter.net` card) become visible. The session
is a signed, httpOnly cookie (7-day expiry) — there's no server-side
session store.

For local development, copy `.env.example` to `.env` and fill in real
values; `npm run dev` loads it automatically.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Add a new bullet under `## Unreleased` (or create that section if the last entry was already released):
```markdown
- Added Google OAuth login (top-right "Login"/"Logout" button, restricted
  to klaus@klaushofrichter.net) and an auth-gated status.klaushofrichter.net
  card that only appears once logged in.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document the login flow and gated status card"
```

---

## Task 8: `kube-setup` manifest changes (separate repo)

**Files (in `../kube-setup`):**
- Modify: `manifests/www/www-ksvc.yaml`
- Modify: `README.md`

**Interfaces:** None — infrastructure manifest only. This task does not touch this repo (`www-klaushofrichter`).

- [ ] **Step 1: Add `envFrom` to the `www` Knative Service**

In `kube-setup/manifests/www/www-ksvc.yaml`, change:
```yaml
      containers:
      - image: ghcr.io/klaushofrichter/www-klaushofrichter:cb1308101120bdd6db4fe74f5ee255e7acd8bad0
        name: user-container
```
to:
```yaml
      containers:
      - envFrom:
        - secretRef:
            name: www-oauth
        image: ghcr.io/klaushofrichter/www-klaushofrichter:cb1308101120bdd6db4fe74f5ee255e7acd8bad0
        name: user-container
```
(this mirrors `manifests/steps/steps-ksvc.yaml`'s `steps-oauth` wiring exactly; the image tag will be overwritten by the next `deploy-production.yml` run regardless, same as every other deploy).

- [ ] **Step 2: Document the new Secret in `kube-setup/README.md`**

Find the existing `steps-oauth` bullet in the Secrets section (`- **\`steps-oauth\`** (Kubernetes Secret, \`steps\` namespace) ...`) and add a matching bullet after it:
```markdown
  - **`www-oauth`** (Kubernetes Secret, `www` namespace) - Google OAuth
    credentials for `www-klaushofrichter`'s login feature, wired into the
    ksvc via `envFrom`. Created directly with `kubectl create secret
    generic www-oauth -n www --from-literal=...` (not through this repo or
    `.env`) - if rebuilding from scratch, recreate it with fresh values
    (Google Cloud Console > APIs & Services > Credentials) **before**
    applying `manifests/www/`, or the ksvc will fail to start.
```

- [ ] **Step 3: Commit (in the `kube-setup` repo)**

```bash
cd ../kube-setup
git add manifests/www/www-ksvc.yaml README.md
git commit -m "Wire www-oauth Secret into the www Knative Service"
```

Do not push yet — this should land right before Task 10's production deploy, once the Secret referenced actually exists on the cluster (Task 9), so the ksvc never fails to start on a missing Secret in between.

---

## Task 9: Google Cloud Console setup and Secret creation (manual, done live with the user)

This task has no code changes and cannot be delegated to a subagent — it requires the user's Google account and cluster access. Walk through it live:

- [ ] **Step 1: Create the OAuth 2.0 Client**

In Google Cloud Console (the same project `steps-service` already uses, if there is one, otherwise a new project) → APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type "Web application". Add two Authorized redirect URIs:
- `https://www.klaushofrichter.net/auth/google/callback` (production)
- `http://localhost:8080/auth/google/callback` (local dev)

Note the generated Client ID and Client Secret.

- [ ] **Step 2: Generate a cookie-signing secret**

Run: `openssl rand -hex 32`

- [ ] **Step 3: Fill in local `.env`**

Copy `.env.example` to `.env` (already gitignored) and fill in the real `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the localhost `GOOGLE_REDIRECT_URI`, the generated `COOKIE_SECRET`, and `ALLOWED_EMAILS=klaus@klaushofrichter.net`.

- [ ] **Step 4: Create the production Secret on the cluster**

Run (against the k3s cluster, `KUBECONFIG` pointed at it):
```bash
kubectl create secret generic www-oauth -n www \
  --from-literal=GOOGLE_CLIENT_ID='<client id>' \
  --from-literal=GOOGLE_CLIENT_SECRET='<client secret>' \
  --from-literal=GOOGLE_REDIRECT_URI='https://www.klaushofrichter.net/auth/google/callback' \
  --from-literal=COOKIE_SECRET='<openssl-generated value>' \
  --from-literal=ALLOWED_EMAILS='klaus@klaushofrichter.net'
```

This must exist before Task 8's `kube-setup` change is pushed/applied, since `envFrom` referencing a missing Secret prevents the `www` ksvc's pod from starting.

---

## Task 10: Local verification, then deploy

**Files:** None new — this is a verification and rollout task.

- [ ] **Step 1: Local dev smoke test**

Run: `npm run dev` (loads `.env` from Task 9), then in a browser: visit `http://localhost:8080/`, confirm the "Login" button appears top-right, click it, complete the Google sign-in as `klaus@klaushofrichter.net`, confirm redirect back to `/` with the button now reading "Logout" and the "Status" card visible. Click "Logout" and confirm it reverts.

- [ ] **Step 2: Full local test suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, all tests pass.

- [ ] **Step 3: Docker build and container smoke test**

```bash
docker build -t www-klaushofrichter:test .
docker run -d --rm --name www-test -p 18080:8080 \
  -e COOKIE_SECRET=dummy -e GOOGLE_CLIENT_ID=dummy \
  -e GOOGLE_CLIENT_SECRET=dummy -e GOOGLE_REDIRECT_URI=http://localhost:18080/auth/google/callback \
  -e ALLOWED_EMAILS=klaus@klaushofrichter.net \
  www-klaushofrichter:test
sleep 1.5
curl -s http://localhost:18080/health
curl -s http://localhost:18080/ | grep -o 'id="auth-button"[^>]*>Login<'
curl -s http://localhost:18080/auth/google/login -o /dev/null -w '%{http_code} %{redirect_url}\n'
docker stop www-test
```
Expected: `/health` ok, the anonymous `/` response contains the Login link, `/auth/google/login` returns a 302 to `accounts.google.com`.

- [ ] **Step 4: Local CodeQL scan**

Since this introduces new attack surface (redirect construction from user-controlled query params via `auth_error`, cookie handling, external token exchange), run the same local CodeQL check used for the earlier `js/path-injection` finding on this repo:
```bash
codeql database create codeql-db --language=javascript-typescript --overwrite
codeql database analyze codeql-db --format=sarif-latest --output=codeql-results.sarif codeql/javascript-queries
```
Expected: 0 findings. If there are findings, fix them before opening the PR (do not push with known findings — this repo's CodeQL check is a required, blocking PR gate).

- [ ] **Step 5: Push and open a PR against `main`**

```bash
git push origin main
```
(All of Tasks 1-8's commits are already on `main` if the branch was worked on directly; if a feature branch was used instead, open a PR to `main` and merge once `test`/`codeql`/`build-push` pass.)

- [ ] **Step 6: Push and apply the `kube-setup` change**

Only after Task 10's `www-oauth` Secret exists on the cluster:
```bash
cd ../kube-setup
git push origin main
```
Apply it per this repo's normal `kube-setup` workflow (see `kube-setup/README.md`) so `envFrom` is live before the next `www` deploy.

- [ ] **Step 7: PR `main` → `production` in `www-klaushofrichter`**

```bash
cd ../www-klaushofrichter
gh pr create --repo klaushofrichter/www-klaushofrichter --base production --head main \
  --title "Add Google OAuth login and gated status card" \
  --body "Adds a Login/Logout button restricted to klaus@klaushofrichter.net and an auth-gated status.klaushofrichter.net card. Requires the www-oauth Secret and kube-setup's envFrom wiring to already be live on the cluster."
```
Wait for `test`, `codeql`, `build-push` checks to pass, then merge.

- [ ] **Step 8: Verify live**

```bash
curl -s https://www.klaushofrichter.net/health
curl -s https://www.klaushofrichter.net/ | grep -o 'id="auth-button"[^>]*>Login<'
curl -s -o /dev/null -w '%{http_code} ' https://www.klaushofrichter.net/auth/google/login
```
Then in a real browser: log in as `klaus@klaushofrichter.net`, confirm the Status card appears and Logout works; optionally confirm a different Google account is rejected with the error toast.
