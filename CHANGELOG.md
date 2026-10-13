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
