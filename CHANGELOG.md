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

- IP Survey: devices that were online but are not now stay listed as *gone*,
  with when they were last seen, instead of being forgotten when a scan without
  them is saved. Clicking *gone* removes one from the list (its note is kept).
- Accessibility and speed, from kube-setup's "public web pages" baseline:
  - Text contrast now meets WCAG 2.2 AA everywhere. Visible: the version
    label and the Login / Dashboard / refresh buttons in the top corner are
    brighter (opacity 0.6 instead of 0.25 and 0.35; they were 2.1:1 and
    2.9:1), card links are a shade lighter (`#a5b4fc`, was 4.4:1 on the grey
    cards), and gone rows in the IP Survey are grey text instead of faded
    (the gone badge was 1.9:1).
  - The card picture links show a focus ring when tabbed to (the card's
    rounded corners clipped it before).
  - The "Login failed" message is announced to screen readers.
  - An unknown address gets a 404 page in the site's style with a link home,
    instead of Express's bare "Cannot GET".
  - Pages are sent gzip-compressed, card pictures below the first four load
    lazily and carry their size, and the avatar is a 2 KB WebP instead of a
    34 KB PNG.
- Checks: the required `e2e` check now tests the Docker image in four
  browsers (desktop Chromium, Android, iPhone/WebKit, desktop Firefox; a test
  that passes only on retry fails the run), with axe-core WCAG 2.2 AA audits
  and a Lighthouse gate on a phone profile. A new `live-check.yml` runs the
  read-only part and Lighthouse against the live site after each deploy and
  daily.

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
