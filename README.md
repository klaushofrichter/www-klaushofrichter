# www-klaushofrichter

Personal homepage for Klaus Hofrichter, served at
[www.klaushofrichter.net](https://www.klaushofrichter.net) — an about
section plus a grid of links to LinkedIn, GitHub, past portfolio/blog work,
Instagram, Medium, and Skylar Technology, each with a hero image (see
"Image refresh" below).

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
  `{"status": "ok", "service": "www-klaushofrichter", "version": "2026.08.26.1"}`.
  The version is stamped into the image at deploy time (see "Versioning and
  releases"); it reads `dev` for a local build.
- `/assets/*` — static asset serving for the og:image social-preview
  image and favicons (`assets/og-image.png`, `assets/favicon-16x16.png`,
  `assets/favicon-32x32.png`, `assets/apple-touch-icon.png`).

### Social previews

`GET /` carries a full Open Graph set — `og:site_name`, `og:title`,
`og:description`, `og:url`, `og:type`, and `og:image` with its `type`, `width`,
`height`, and `alt` — plus the `twitter:*` equivalents. `twitter:card` is
`summary_large_image`, without which X renders a small thumbnail even though it
reads the `og:*` tags for everything else.

The declared `og:image:width`/`height` must match `assets/og-image.png`; a test
reads the PNG header and fails if they drift, since nothing else would catch it
until someone shared a link.

## Development

```bash
npm install
npm test
npm run dev
```

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
(`GET /auth/google/login`). Only `klaus@klaushofrichter.net` (configured
via the `ALLOWED_EMAILS` env var) can complete it — anyone else is sent
back to `/` with an error toast. Once logged in, the button becomes
"Logout" (`GET /auth/logout`), and cards marked as auth-gated (currently
just the `status.klaushofrichter.net` card) become visible. The session
is a signed, httpOnly cookie (7-day expiry) — there's no server-side
session store.

For local development, copy `.env.example` to `.env` and fill in real
values; `npm run dev` loads it automatically.

## End-to-end smoke test

`e2e/smoke.spec.ts` (Playwright) checks the home page and `/health` against
a running instance. Run it locally against `npm run dev`/Docker with
`BASE_URL=http://localhost:8080 npm run test:e2e`. It runs in CI as the `e2e`
job of the production PR checks, on GitHub's runners against a locally started
server — not in the deploy, where installing a browser exceeds the in-cluster
runner's memory limit and gets it OOM-killed.

The deploy's own smoke test is `curl`-based: after the rollout it waits for
`/health` to return 200, asserts the version it reports is the one that run
just stamped, and checks that `/` returns 200 with the version label present.

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

The running build reports its version on `GET /health` and in the page
header, to the left of the Login/Logout button.

## Deployment

Builds and pushes to `ghcr.io/klaushofrichter/www-klaushofrichter` via GitHub
Actions on push to `main`. Deploying to production happens on merge to the
`production` branch, via an in-cluster self-hosted GitHub Actions runner —
see `klaushofrichter/kube-setup`'s `docs/self-hosted-runner-cicd-pattern.md`
for the full design, and its `manifests/www/` and `manifests/www-klaushofrichter-runner/`
for this service's cluster manifests.
