# CLAUDE.md

Operational context for working in this repo.

## What this is

A small Express/TypeScript static site serving `www.klaushofrichter.net`,
deployed as a Knative Service on the `kube-setup`-managed k3s cluster (see
`../kube-setup/CLAUDE.md` for cluster-wide context). Structured to match
`../steps-service` (same branch/CI/CD pattern), but deliberately simple —
static HTML plus a `/health` endpoint.

## Branches

- `main` — normal development, unprotected. Push here builds and pushes
  `ghcr.io/klaushofrichter/www-klaushofrichter:latest` +
  `:<sha>` via `.github/workflows/build-push.yml`, but does **not** deploy.
- `production` — protected, PR-only from `main`. Merging here triggers
  `.github/workflows/deploy-production.yml` on the in-cluster self-hosted
  runner, which builds/pushes the image, updates
  `kube-setup/manifests/www/www-ksvc.yaml`'s image tag, and applies it.

## Cluster-side manifests

Live in `klaushofrichter/kube-setup`: `manifests/www/` (the Knative Service +
DomainMapping) and `manifests/www-klaushofrichter-runner/` (this repo's
dedicated self-hosted runner — its own namespace/ServiceAccount/RBAC,
isolated from `steps-service`'s runner per that repo's
`docs/self-hosted-runner-cicd-pattern.md`).
