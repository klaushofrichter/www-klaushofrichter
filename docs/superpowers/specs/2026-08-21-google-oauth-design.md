# Google OAuth login and gated cards

Date: 2026-08-21

## Goal

Add a "Login" button (top-right, unobtrusive, next to the existing
refresh button) that starts a Google OAuth sign-in. Only
`klaus@klaushofrichter.net` is allowed to authenticate successfully.
Once logged in, the button becomes "Logout", and additional cards that
are marked as requiring auth become visible. The first such card links
to `https://status.klaushofrichter.net`. Look and feel of the existing
page stays the same; only the header controls and the set of visible
cards change based on login state.

This mirrors the existing Google OAuth pattern already in production in
the sibling `steps-service` repo (`google-auth-library` +
`jsonwebtoken` + `cookie-parser`, stateless signed-cookie session, no
session store).

## Non-goals

- No user accounts, roles, or per-user data beyond "is this the one
  allowed email."
- No CSRF `state` parameter in the OAuth flow — the sibling
  `steps-service` doesn't use one either, and there is no sensitive
  action gated behind the callback beyond setting a cookie.
- No session persistence beyond the JWT's own expiry — logging in again
  after a redeploy is fine (in practice sessions now survive redeploys
  anyway, since the JWT itself is stateless).
- Not adding a general-purpose "protected route" middleware
  (`requireAuth`-style page gating) — this is only about which cards
  render on `/`, not about protecting a full page or API.

## Architecture

### Session mechanism

`src/session.ts` (new) — ported from `steps-service/src/session.ts`
with no changes to the logic:

```ts
export interface SessionPayload {
  email: string;
}

export function signSession(email: string): string; // jwt.sign(..., COOKIE_SECRET, { expiresIn: '7d' })
export function verifySession(token: string): SessionPayload | null; // jwt.verify, catches all errors -> null
```

`COOKIE_SECRET` is read from `process.env` at call time (not cached at
module load), matching the existing pattern; throws if unset, which is
acceptable since it's read only inside request handlers, not at
startup.

### Auth routes

`src/routes/auth.ts` (new), mounted in `src/app.ts`:

- `GET /auth/google/login` — redirects (302) to Google's OAuth consent
  screen. Builds the URL from `GOOGLE_CLIENT_ID` / `GOOGLE_REDIRECT_URI`
  env vars, `response_type=code`, `scope=openid email`.
- `GET /auth/google/callback` — rate-limited
  (`express-rate-limit`, same config as `steps-service`:
  15-minute window, 30 requests). Exchanges the `code` for tokens via
  `google-auth-library`'s `OAuth2Client`, verifies the ID token,
  extracts `email` (only if `email_verified`), checks it against
  `ALLOWED_EMAILS` (comma-separated env var, exact match). On success,
  sets the signed session cookie and redirects to `/`. On any failure
  (missing code, bad code, unverified/mismatched email), redirects to
  `/?auth_error=1` instead of returning a raw JSON error — this is a
  page-based flow, not an API, so the user should land back on the page
  with a visible toast rather than a bare error response.
- `GET /auth/logout` — clears the session cookie, redirects to `/`.

Cookie config: `session` cookie name, `httpOnly: true`, `secure: true`,
`sameSite: 'lax'`, `maxAge` matching the JWT's 7-day expiry.

### Reading auth state for `/`

`src/routes/index.ts`'s `GET /` handler reads `req.cookies?.session`,
calls `verifySession`, and passes a plain `boolean` (`isAuthenticated`)
into `renderPage()`. `src/app.ts` adds `cookieParser()` middleware
ahead of the routers (mirrors `steps-service/src/app.ts`).

### Cards data model

`src/links.ts`: add an optional field to `Link`:

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

Add one new entry:

```ts
{
  id: 'status',
  title: 'Status',
  url: 'https://status.klaushofrichter.net',
  abstract: '...", // short description, finalized when the card is captured
  gradient: '...',
  requiresAuth: true,
}
```

A static screenshot is captured into `assets/cards/status.png` the same
way the other 7 cards were (Playwright, 1200x630, realistic desktop
User-Agent), shown to the user for approval before being committed.

### Rendering

`src/views/page.ts`:

- `renderPage(isAuthenticated: boolean)` — filters the card list with
  `links.filter((l) => !l.requiresAuth || isAuthenticated)` before
  mapping to `renderCard`.
- Header controls: wrap the existing `#refresh-button` and a new
  `#auth-button` in a single fixed-position flex container
  (`.header-actions`, `top: 16px; right: 16px; display: flex; gap: 8px;`)
  so they lay out side by side without overlapping. `#auth-button` is a
  small pill (`<a>` tag, not `<button>` — it's pure navigation, no JS
  needed): text "Login" linking to `/auth/google/login` when logged
  out, text "Logout" linking to `/auth/logout` when logged in. Same
  translucent glass style as the refresh button (`rgba(255,255,255,0.06)`
  background, `rgba(255,255,255,0.15)` border) so it reads as part of
  the same control cluster, low default opacity, full opacity on hover
  — "unobtrusive" per the request.
- `auth_error=1` query param: if present, the existing
  `#refresh-message` toast element is reused to show "Login failed —
  only klaus@klaushofrichter.net can sign in." on page load (small
  inline script addition next to `REFRESH_SCRIPT`, checking
  `location.search` and clearing the param via
  `history.replaceState` so a reload doesn't re-show it).

### Env vars / secrets

Local dev: `.env` (gitignored, already in `.gitignore`), loaded via
`tsx --env-file=.env src/server.ts` (update the `dev` script in
`package.json` to match `steps-service`'s). A checked-in `.env.example`
documents the required keys with placeholder values:

```
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback
COOKIE_SECRET=generate-with-openssl-rand-hex-32
ALLOWED_EMAILS=klaus@klaushofrichter.net
```

Production: a new Kubernetes Secret `www-oauth` in the `www` namespace
(mirrors `steps-oauth`), created directly with `kubectl create secret
generic www-oauth -n www --from-literal=...` (not through this repo or
`.env`, same as `steps-oauth`'s documented pattern) with
`GOOGLE_REDIRECT_URI=https://www.klaushofrichter.net/auth/google/callback`.
Wired into `manifests/www/www-ksvc.yaml` via `envFrom` (a `kube-setup`
change, done alongside this feature). `kube-setup/README.md`'s Secrets
section gets a new bullet documenting `www-oauth`, matching the
existing `steps-oauth` bullet's format.

**Prerequisites only the user can do** (walked through when we get
there, not automated):
1. Create an OAuth 2.0 Web Client in Google Cloud Console with the
   production and local redirect URIs authorized.
2. Generate a `COOKIE_SECRET` (`openssl rand -hex 32`) and create the
   `www-oauth` Secret on the cluster before the updated `www-ksvc.yaml`
   is applied — `envFrom` referencing a missing Secret prevents the pod
   from starting, so ordering matters here, same as `steps-oauth`'s
   documented "before applying `manifests/steps/`" requirement.

### New dependencies

`cookie-parser`, `google-auth-library`, `jsonwebtoken` (+
`@types/cookie-parser`, `@types/jsonwebtoken` as dev deps) — exact same
versions as pinned in `steps-service/package.json` for consistency.

## Testing

- `test/session.test.ts` (new): sign/verify round-trip, verify rejects
  tampered/expired/garbage tokens, verify rejects a payload missing
  `email`.
- `test/auth.test.ts` (new): `/auth/google/login` redirects to Google
  with the right query params; `/auth/google/callback` sets the cookie
  and redirects to `/` on success (mock `OAuth2Client`); redirects to
  `/?auth_error=1` on missing code, token-exchange failure, unverified
  email, and email not in `ALLOWED_EMAILS`; `/auth/logout` clears the
  cookie and redirects to `/`.
- `test/page.test.ts` (extend): with `isAuthenticated: false`, the
  `status` card is absent and the button reads "Login" linking to
  `/auth/google/login`; with `isAuthenticated: true`, the card is
  present and the button reads "Logout" linking to `/auth/logout`.
- `test/index.test.ts` (extend): `GET /` with no cookie renders logged
  out; with a validly-signed cookie renders logged in; with a garbage
  cookie value renders logged out (doesn't throw).
- Docker build + container smoke test (manual, as done for prior
  features) before opening the PR: verify `/auth/google/login` redirects,
  `/` renders without the status card when logged out.
- Local CodeQL scan before pushing, since this introduces new
  attack surface (external redirect construction, cookie handling,
  token verification) — same lesson as the earlier
  `js/path-injection` finding on this repo.

## Rollout

1. Implement + test on `main` (build-push only, no deploy).
2. Before merging to `production`: walk through Google Cloud Console
   OAuth client setup and `www-oauth` Secret creation with the user,
   update `kube-setup/manifests/www/www-ksvc.yaml` with `envFrom`, and
   update `kube-setup/README.md`'s Secrets section — as a `kube-setup`
   change committed alongside/before this repo's PR to `production`, so
   the ksvc doesn't fail to start.
3. Capture and get approval for the `status.klaushofrichter.net`
   screenshot before adding the card.
4. Merge to `production`, verify live: logged-out view unchanged,
   login flow works end-to-end for `klaus@klaushofrichter.net`, status
   card appears, logout works, an arbitrary other Google account is
   rejected.
