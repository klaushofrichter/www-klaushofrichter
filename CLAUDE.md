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

## Cluster-side manifests

Live in `klaushofrichter/kube-setup`: `manifests/www-klaushofrichter/` (the
Knative Service + DomainMapping, `www-klaushofrichter` namespace) and
`manifests/www-klaushofrichter-runner/` (this repo's
dedicated self-hosted runner — its own namespace/ServiceAccount/RBAC,
isolated from `steps-service`'s runner per that repo's
`docs/self-hosted-runner-cicd-pattern.md`).
