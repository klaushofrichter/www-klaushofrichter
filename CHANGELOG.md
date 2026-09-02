# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are **generated at deploy time**, not carried in the sources: a merge
into `production` is tagged `vYYYY.MM.DD.N`, where `N` counts that day's
releases. Nothing needs bumping and nothing can be forgotten, and the running
build reports its own version on `/health` and in the page header.
`package.json` deliberately carries no `version` field.

Each release's notes are assembled from the commits since the previous one,
preceded by anything curated under Unreleased below. The full history lives on
the [releases page](https://github.com/klaushofrichter/www-klaushofrichter/releases);
this file is where notes are written *before* a release.

<!-- Anything written under Unreleased is prepended to the next release's
     notes. Keep prose out of it unless you mean it to be published. -->
## [Unreleased]

### Added

- Replaced the placeholder static page with the real homepage: about
  section, responsive card grid (LinkedIn, GitHub, Portfolio 2017,
  Instagram, Three Puppies, Medium), each card showing a hero image
  fetched from the target site's `og:image` and refreshed daily via an
  in-process cron job (also triggerable on demand via the page's ⟳
  button / `POST /refresh`).
- `GET /images/:id` route to serve downloaded hero images.
- Social preview support: `og:image`/`og:title`/`og:description`/`og:url`
  meta tags plus 16x16/32x32/apple-touch favicon `<link>` tags on `GET /`,
  backed by a new `/assets/*` static mount (`express.static`) serving
  `assets/og-image.png`, `assets/favicon-16x16.png`,
  `assets/favicon-32x32.png`, and `assets/apple-touch-icon.png`.
- Static card screenshots: `assets/cards/<id>.png`, one hand-curated
  1200x630 screenshot per link (all 6 currently), take priority over the
  dynamic `og:image` fetch — a link with a static asset gets no startup
  fetch and no daily cron entry at all. The dynamic fetch/cron mechanism
  stays in place as the fallback for any link added later without one.
  Card images are now clickable (link to the card's URL), and cards are
  25% wider (`minmax(220px,...)` → `minmax(275px,...)`).
- Added Google OAuth login (top-right "Login"/"Logout" button, restricted
  to klaus@klaushofrichter.net) and an auth-gated status.klaushofrichter.net
  card that only appears once logged in.
- Completed the social preview tags on `GET /`: `og:site_name`,
  `og:image:type`/`width`/`height`/`alt`, a plain `description`, and the
  `twitter:*` set with `twitter:card: summary_large_image` — without which X
  renders a small thumbnail. A test pins the declared image dimensions to the
  actual PNG header so they cannot drift.
- Converted the card images from 1200x630 PNG to 800px WebP: the set went
  from 6.2MB to 0.35MB (-94%), which was the page's entire weight problem —
  PageSpeed Insights measured a 4,416 KiB page and flagged 4,079 KiB of it as
  avoidable, holding mobile LCP at 3.6s. `assets/og-image.png` stays PNG for
  scraper compatibility.
- Card titles are now `h2` rather than `h3`. Jumping `h1` → `h3` skipped a
  level, the one accessibility audit the site was failing.

- Hardened the deploy's version step: a failed `gh release list` used to be
  swallowed by `|| true` and read as "no releases today", silently reusing a
  version already shipped. It now fails the step.
- The deploy's smoke test checks the served version inside its retry loop
  rather than once after it — ingress can answer from the previous revision
  for a moment after the ksvc reports Ready, which is a race to wait out, not
  a deploy failure.
- Cleared every Dependabot advisory (1 critical, 1 high, 8 moderate) by taking
  three majors: express 4 -> 5 (the only route to the patched `qs` 6.16.0 —
  express 4 pins `qs: ~6.15.1`, below the fix), node-cron 3 -> 4, and vitest
  2 -> 4. `npm audit` is now clean.
- Added `.github/dependabot.yml` (npm, github-actions, docker; weekly,
  grouped). Dependabot alerts and security updates were enabled as repo
  settings at the same time.
- Worked through the Dependabot queue: express-rate-limit 8.7.0, tsx 4.23.13,
  actions/checkout + actions/setup-node v7, codeql-action v4,
  google-auth-library 11, TypeScript 7, and the base image to `node:26-alpine`
  (with CI on Node 26 to match).
- TypeScript 7 removed `"moduleResolution": "node"`, so tsconfig moves to
  `nodenext` for both `module` and `moduleResolution`. `package.json` has
  `"type": "commonjs"`, so the emit is still CJS — verified by running the
  built `dist`, not just by compiling.
- PR checks now run on pull requests to `main` as well as `production`.
  Previously a PR to main ran nothing: `build-push.yml` triggers on push and
  `production-checks.yml` only listened for production, so Dependabot's bumps
  were landing unverified.
- Added the Swift Sensors card to the protected area
  (`my.swiftsensors.net`) and CI/Dependabot badges to the README.
- Aligned `@types/node` with the runtime (20 -> 26). It had been left three
  majors behind `node:26-alpine`, so the type definitions described APIs the
  container does not have and missed the ones it does.

### Changed

- Upgraded the runtime from Node 20 to Node 24 (`node:24-alpine` in both
  Dockerfile stages, `node-version: 24` in all three workflows).
- Bumped `actions/checkout` and `actions/setup-node` to `@v5`, and
  `docker/login-action`/`docker/build-push-action` to `@v4`/`@v7`, clearing
  the Node 20 runtime deprecation warning.
- Every merge to `production` now cuts a release: the deploy generates a
  `vYYYY.MM.DD.N` version, bakes it into the image (`ARG APP_VERSION`), tags
  the image with it, and creates a GitHub release whose notes are this file's
  Unreleased section plus the commits since the last release. The running
  build reports its version in `GET /health` (`{"status":"ok","service":...,
  "version":"2026.08.26.1"}`) and in the page header, left of the
  Login/Logout button. `package.json` no longer carries a `version` field.
- Moved the Playwright suite out of the production deploy and into the
  production PR checks, where it runs on GitHub's runners against a locally
  started server. Installing a browser on the in-cluster self-hosted runner
  exceeded its 512Mi limit and got it OOM-killed mid-deploy. The deploy now
  smoke-tests with `curl`, and additionally asserts that the version `/health`
  reports is the one that run just stamped.

## 2026-08-20

### Added

- Initial static site: `GET /` serves `public/index.html`, `GET /health`
  returns `{"status": "ok", "service": "www-klaushofrichter"}`.
- Playwright end-to-end smoke test (`e2e/smoke.spec.ts`), run against
  `https://www.klaushofrichter.net` as the deploy gate in
  `deploy-production.yml`.
- CI/CD: `production-checks.yml` (test + CodeQL on PRs into `production`),
  `build-push.yml` (build + push `ghcr.io/klaushofrichter/www-klaushofrichter`
  on push to `main`), `deploy-production.yml` (build, push, update
  `kube-setup`, apply, verify rollout, smoke test — on push to `production`).
- Dedicated in-cluster self-hosted GitHub Actions runner
  (`www-klaushofrichter-runner` namespace in `kube-setup`), isolated from
  `steps-service`'s runner.
- Deployed to the `www` namespace on the `kube-setup`-managed k3s cluster,
  replacing the `www-placeholder` static placeholder that previously served
  `www.klaushofrichter.net`.
- Public GitHub repo, MIT licensed.

### Fixed

- Vitest's default test-discovery glob was picking up `e2e/smoke.spec.ts`
  too, colliding with Playwright's own test runner and failing `npm test`
  in CI. Fixed by excluding `e2e/**` in `vitest.config.ts`.
- The Knative Service's default 500m CPU limit left the cluster node with
  no spare CPU to schedule a new revision during rollouts. Reduced to
  200m, which is still generous for a static file server.
