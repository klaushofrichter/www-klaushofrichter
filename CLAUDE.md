# CLAUDE.md

Operational context for working in this repo.

## What this is

Klaus Hofrichter's personal homepage — an Express/TypeScript app that
server-renders an about section, a grid of link cards (each with a
daily-refreshed hero image from the target site's `og:image`), and a
footer. Deployed as a Knative Service on the `kube-setup`-managed k3s
cluster (see `../kube-setup/CLAUDE.md` for cluster-wide context). Design
rationale lives in `docs/superpowers/specs/2026-08-20-homepage-design.md`.

## Branches

- `main` — normal development, unprotected. Push here builds and pushes
  `ghcr.io/klaushofrichter/www-klaushofrichter:latest` +
  `:<sha>` via `.github/workflows/build-push.yml`, but does **not** deploy.
- `production` — protected, PR-only from `main`. Merging here triggers
  `.github/workflows/deploy-production.yml` on the in-cluster self-hosted
  runner, which builds/pushes the image, updates
  `kube-setup/manifests/www-klaushofrichter/www-ksvc.yaml`'s image tag, and
  applies it.

## Versioning and releases

A merge into `production` cuts a release. The version is generated in
`deploy-production.yml` as `vYYYY.MM.DD.N` — the date in Central time plus a
counter over the releases that already exist for that day. The tags are the
only state, so nothing is stored and nothing needs bumping; `package.json`
deliberately carries no `version` field.

The version is passed to the image build as `ARG APP_VERSION` and read back by
`src/version.ts`, which feeds `GET /health` and the `#app-version` label in the
page header. Local builds and tests see `dev`.

Release notes come from the commits since the previous release, preceded by
anything under `## [Unreleased]` in `CHANGELOG.md`. The release step runs last
(after the rollout check and the curl smoke test), so a failed deploy produces
no release, and the checkout uses `fetch-depth: 0` because the notes are
computed from history and tags.

## Don't run Playwright on the self-hosted runner

The deploy used to end with `npx playwright install --with-deps chromium` plus
the e2e suite. The runner container is capped at 512Mi
(`kube-setup/manifests/www-klaushofrichter-runner/runner-deployment.yaml`), so
the browser install OOM-killed it; GitHub surfaces that as "The self-hosted
runner lost communication with the server", which reads like a network fault
and is not one. The suite now runs in `production-checks.yml` on GitHub's
runners against a locally started server, and the deploy smoke-tests with
`curl`. Keep heavyweight installs off that runner.

## Cluster-side manifests

Live in `klaushofrichter/kube-setup`: `manifests/www-klaushofrichter/` (the
Knative Service + DomainMapping, `www-klaushofrichter` namespace) and
`manifests/www-klaushofrichter-runner/` (this repo's
dedicated self-hosted runner — its own namespace/ServiceAccount/RBAC,
isolated from `steps-service`'s runner per that repo's
`docs/self-hosted-runner-cicd-pattern.md`).
