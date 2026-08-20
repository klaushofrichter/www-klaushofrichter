# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Deployment isn't versioned (every merge to `production` ships automatically,
image-tagged with the exact git SHA — see `README.md` "Deployment") — entries
here are dated by when they shipped, not by a semver bump.

## Unreleased

### Added

- Replaced the placeholder static page with the real homepage: about
  section, responsive card grid (LinkedIn, GitHub, Portfolio 2017,
  Instagram, Three Puppies, Medium), each card showing a hero image
  fetched from the target site's `og:image` and refreshed daily via an
  in-process cron job (also triggerable on demand via the page's ⟳
  button / `POST /refresh`).
- `GET /images/:id` route to serve downloaded hero images.

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
