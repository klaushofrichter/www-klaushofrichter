# www-klaushofrichter

[![Release](https://img.shields.io/github/v/release/klaushofrichter/www-klaushofrichter?label=release&color=blue)](https://github.com/klaushofrichter/www-klaushofrichter/releases)
[![PR checks](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/production-checks.yml/badge.svg)](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/production-checks.yml)
[![Build and publish image](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/build-push.yml/badge.svg)](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/build-push.yml)
[![Deploy production](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/deploy-production.yml/badge.svg)](https://github.com/klaushofrichter/www-klaushofrichter/actions/workflows/deploy-production.yml)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/klaushofrichter/www-klaushofrichter/security/dependabot)

<!-- The release badge tracks the newest tag, which a successful production
     deploy cuts (see "Versioning and releases"). It is the last *released*
     version, not necessarily the running one: a deploy that rolls out and then
     fails its smoke test leaves production ahead of the tag. GET /health is
     what reports the running version.

     The three workflow badges are live status. The Dependabot one is static -
     GitHub publishes no endpoint for alert status on a repo, so it asserts
     that alerts, security updates, and .github/dependabot.yml are all in place
     rather than checking them. If Dependabot is ever turned off, this badge
     will not notice. -->

Personal homepage for Klaus Hofrichter, served at
[www.klaushofrichter.net](https://www.klaushofrichter.net) — an about
section plus a grid of link cards, each with a hero image (see "Image
refresh" below). The public cards cover professional profiles, side projects
and creative work, with older sites grouped at the end and marked
`(archive)`; a further set is auth-gated (see "Login"). `src/links.ts` is the
single source of truth for all of them.

## API

- `GET /` — the homepage: an about section, a responsive grid of link
  cards (each with a title, short abstract, and hero image fetched from
  the target site's `og:image` where available), and a footer.
- `GET /images/:id` — serves a downloaded hero image; `404` if none was
  successfully fetched for that id.
- `POST /refresh` — re-fetches all hero images on demand (also the small
  ⟳ button in the page's top-right corner). Subject to a 60-second
  cooldown; returns `429` if called again too soon.
- `GET /health` — returns
  `{"status": "ok", "service": "www-klaushofrichter", "version": "2026.09.02.9"}`.
  The version is stamped into the image at deploy time (see "Versioning and
  releases"); it reads `dev` for a local build.
- `/assets/*` — static asset serving for the og:image social-preview
  image and favicons (`assets/og-image.png`, `assets/favicon-16x16.png`,
  `assets/favicon-32x32.png`, `assets/apple-touch-icon.png`).
- `GET /public` — a listing of the files committed under `public/`, each a
  download link; `GET /public/<filename>` serves one. See "Public files".
- `GET /dashboard`, `GET /dashboard/ip-survey` — signed-in pages (see
  "Dashboard"). Signed-out requests are redirected to `/`.
- `GET /api/survey`, `POST /api/survey/scan`, `POST /api/survey/save` — the IP
  Survey API. Signed-out requests get `401`.

### Social previews

`GET /` carries a full Open Graph set — `og:site_name`, `og:title`,
`og:description`, `og:url`, `og:type`, and `og:image` with its `type`, `width`,
`height`, and `alt` — plus the `twitter:*` equivalents. `twitter:card` is
`summary_large_image`, without which X renders a small thumbnail even though it
reads the `og:*` tags for everything else.

The declared `og:image:width`/`height` must match `assets/og-image.png`; a test
reads the PNG header and fails if they drift, since nothing else would catch it
until someone shared a link.

### Public files

Anything committed under `public/` is served at `https://www.klaushofrichter.net/public`
as a plain listing, with each entry a download link. The folder is copied into
the runtime image by the Dockerfile, so adding or removing a file is a commit
plus a deploy — there is no upload path and nothing is written at runtime.

The listing is flat: files directly in `public/` are shown, subdirectories and
dotfiles are skipped. Files are served by `express.static`, which resolves the
path itself, so a traversal attempt like `/public/../.env` cannot escape the
folder. Responses carry a one-hour `max-age`, which is safe because a given
URL's bytes only change when a new image is deployed.

Nothing on the homepage links to `/public` — it is a place to park a file you
want to hand someone a URL for, not a section of the site.

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

## Development

```bash
npm install
npm test        # vitest, plus npm audit in CI
npm run dev     # tsx, reads .env
```

Node 26 — matching `node:26-alpine` in the Dockerfile, `node-version: 26` in
the workflows, and `@types/node` in `package.json`. Those four should always
name the same major.

## Image refresh

Each card's hero image resolves in this order:

1. **Static card asset** — `assets/cards/<id>.webp`, a hand-curated screenshot
   committed to the repo (currently every link has one). If present, it's
   used as-is: no network fetch at startup, no daily cron entry for that
   link. Ships baked into the Docker image.
2. **Dynamic `og:image` fetch** — for any link without a static asset, the
   target URL's `og:image` meta tag is fetched and downloaded to local disk
   on container startup and re-fetched once a day (06:00 UTC) via an
   in-process `node-cron` job — no persistent storage, no separate CronJob
   resource; images just repopulate on every restart.
3. **Gradient fallback** — if neither of the above produced an image (no
   static asset, and the dynamic fetch failed — some target sites block
   non-browser requests), the card renders a plain gradient instead of a
   broken image.

The card image is a clickable link to the card's URL. See
`docs/superpowers/specs/2026-08-20-homepage-design.md` for the full design.

### Card images

Card assets are **WebP at 800px wide**, roughly 2x the widest the 110px-tall
hero slot ever gets. They were 1200x630 PNGs, which made the page 4.4MB and
held mobile LCP at 3.6s on PageSpeed Insights; converting dropped the set from
6.2MB to 0.35MB. To add one, capture the screenshot and convert it:

```sh
npm install sharp --no-save
node -e "require('sharp')('shot.png').resize({width:800}).webp({quality:82}).toFile('assets/cards/<id>.webp')"
npm uninstall sharp
```

`assets/og-image.png` deliberately stays PNG — some social scrapers still do
not accept WebP.

## Login

A "Login" button in the top-right corner starts a Google OAuth sign-in
(`GET /auth/google/login`). Only the addresses in the `ALLOWED_EMAILS` env
var can complete it — a comma-separated list, matched exactly, and accepted
only when Google reports the address as verified. Anyone else is sent back to
`/` with an error toast that does not name who *is* allowed. In production the
list comes from the `www-oauth` Secret in the `www-klaushofrichter` namespace
(loaded through `envFrom`), not from this repo; changing it takes effect on the
next revision, i.e. the next deploy or a pod restart. Once logged in, the button becomes
"Logout" (`GET /auth/logout`), and the auth-gated cards become visible —
dashboards, operational consoles, and a few personal apps, each marked
`requiresAuth: true` in `src/links.ts`. Logged-out visitors never
receive their markup at all, rather than having it hidden in CSS. The session
is a signed, httpOnly cookie (7-day expiry) — there's no server-side
session store.

For local development, copy `.env.example` to `.env` and fill in real
values; `npm run dev` loads it automatically.

## End-to-end smoke test

`e2e/smoke.spec.ts` (Playwright) checks, against a running instance: that the
public cards render (asserted by card URL rather than title, since titles are
editorial and pick up markers like `(archive)`), that auth-gated cards are
absent for a logged-out visitor, that `/health` reports a well-formed version,
and that the page header shows it. Run it locally against `npm run dev`/Docker
with `BASE_URL=http://localhost:8080 npm run test:e2e`. In CI it is the `e2e`
job of `production-checks.yml`, which runs on pull requests to **both** `main`
and `production` — on GitHub's runners against a locally started server, not in
the deploy, where installing a browser exceeds the in-cluster runner's memory
limit and gets it OOM-killed.

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

(`npm start`, not `npm run dev`: `dev` loads `.env` and would override those
values.)

The deploy's own smoke test is `curl`-based: after the rollout it waits for
`/health` to return 200, asserts the version it reports is the one that run
just stamped, and checks that `/` returns 200 with the version label present.

## Dependency security

Three layers, with different timing:

- **Dependabot alerts + security updates** — continuous; they fire when an
  advisory is published, not on a schedule.
- **Version updates** — `.github/dependabot.yml`, weekly on Mondays, covering
  npm, github-actions, and the Docker base image. Minor and patch updates are
  grouped; majors arrive one at a time.
- **`npm audit --audit-level=high`** in the `test` job — the part that
  *blocks*. Noticing a vulnerable dependency does not stop it being merged;
  failing a required check does. The threshold is `high` rather than npm's
  default so that a moderate advisory whose only fix is a major upgrade cannot
  wedge unrelated merges.

## Versioning and releases

Versions are generated at deploy time, not carried in the sources —
`package.json` has no `version` field. Each merge to `production` computes
`vYYYY.MM.DD.N` (the date in Central time, plus a counter over that day's
existing releases), bakes it into the image as `ARG APP_VERSION`, tags the
image with it alongside the SHA tag, and — after the rollout and smoke test
pass — creates a GitHub release. The release notes are whatever is curated
under `## [Unreleased]` in `CHANGELOG.md`, followed by the commits since the
previous release. The existing tags are the only state, so nothing needs
bumping and a failed deploy produces no release.

Each release also carries a **Verified at release** section: what the deploy's
own smoke test observed on the public URL — the version `/health` reported, the
page status, the UTC timestamp, and a link to the run. Because the release step
runs only after that check passes, the section's presence is itself the claim; a
failed verification cuts no release at all.

The running build reports its version on `GET /health` and in the page
header, to the left of the Login/Logout button. For a signed-in visitor that
label is a link to this repository; logged out it stays inert text.

## Deployment

Builds and pushes to `ghcr.io/klaushofrichter/www-klaushofrichter` via GitHub
Actions on push to `main`. Deploying to production happens on merge to the
`production` branch, via an in-cluster self-hosted GitHub Actions runner —
see `klaushofrichter/kube-setup`'s `docs/self-hosted-runner-cicd-pattern.md`
for the full design, and its `manifests/www-klaushofrichter/` (Knative Service
+ DomainMapping) and `manifests/www-klaushofrichter-runner/` (this repo's
dedicated runner) for this service's cluster manifests.
