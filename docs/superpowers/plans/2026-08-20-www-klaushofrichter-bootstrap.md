# www-klaushofrichter Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a public, MIT-licensed GitHub repo `klaushofrichter/www-klaushofrichter`, structured like `../steps-service` (Node/TS/Express, tests, Docker multi-stage build, `main`/`production` branches, protected-branch CI, in-cluster self-hosted-runner CD), serving a simple static HTML site that replaces the `www-placeholder` Knative Service currently answering `www.klaushofrichter.net` on the `../kube-setup`-managed k3s cluster.

**Architecture:** App repo mirrors `steps-service`'s shape exactly (Express app factory in `src/app.ts`, entrypoint in `src/server.ts`, one router per concern, Vitest + Supertest). The site itself is a static `public/index.html` served via `express.static`, plus a `/health` JSON endpoint — deliberately simple; a "more complex service" replaces this content later without needing to touch the deploy pipeline. Deployment mirrors `steps-service`'s CI/CD pattern (`docs/self-hosted-runner-cicd-pattern.md` in `kube-setup`): PR checks on GitHub-hosted runners, deploy-on-merge-to-`production` on a new in-cluster self-hosted runner with its own registration PAT and its own `ServiceAccount`/`Role` (isolated from `steps-service`'s runner, per that doc's "one runner per repo, not shared" decision). The existing `www-placeholder` namespace/ksvc/DomainMapping are retired and replaced by a new `www` namespace/ksvc, reusing the domain's already-provisioned Traefik ingress rule and TLS cert (no DNS/ingress/cert changes needed — `www.klaushofrichter.net` is already routed to Kourier and already has a cert).

**Tech Stack:** Node 20, TypeScript, Express 4, Vitest + Supertest (unit tests), Playwright (end-to-end smoke test run against the live production URL as part of the deploy workflow), Docker (`node:20-alpine` multi-stage), GitHub Actions, Knative Serving on k3s (Kourier ingress), `kubectl`.

**Spec:** No separate spec doc — the user's instructions plus `../steps-service` (reference implementation) and `../kube-setup/docs/self-hosted-runner-cicd-pattern.md` (documented replication steps) together constitute the spec. Key facts pulled from those sources:
- `steps-service` structure: `package.json`/`tsconfig.json`/`Dockerfile`/`.dockerignore`/`.gitignore`, `src/app.ts` + `src/server.ts` + `src/routes/*.ts`, `test/*.test.ts`, three workflows (`production-checks.yml`, `build-push.yml`, `deploy-production.yml`).
- `kube-setup` reference manifests: `manifests/steps/steps-ksvc.yaml`, `manifests/github-runner/*.yaml` (namespace, serviceaccount, rbac, networkpolicy, runner-deployment).
- `www-placeholder`'s current manifests: `manifests/placeholders/www-{ksvc,domainmapping,configmap}.yaml`, plus its namespace entry in `manifests/00-namespaces.yaml` and its `for name in horse hook monitor www` loop entry in `scripts/export.sh`.
- `www.klaushofrichter.net` already has a Traefik `Ingress` rule + TLS secret (`manifests/networking/knative-gateway-ingress.yaml`) and a `DomainMapping` — DNS was moved to this cluster 2026-08-20. No changes needed to the Ingress resource itself.

## Global Constraints

- Repo name: `www-klaushofrichter`, owner `klaushofrichter` (personal GitHub account, same as `steps-service` — confirmed via `gh api user` that "klaushofrichter" is the personal account login, not a separate org).
- Image: `ghcr.io/klaushofrichter/www-klaushofrichter`, tagged `:latest` + `:<sha>` on `main`, `:<sha>` only (no `:latest` re-tag) on `production` deploy.
- k8s app namespace/Knative Service name: `www` (mirrors `steps`/`steps` — short, purpose-named, not repo-named).
- k8s runner namespace: `www-klaushofrichter-runner` (new, isolated from `github-runner` — per `docs/self-hosted-runner-cicd-pattern.md`'s "one runner per repo, not shared" decision, this gets its own `ServiceAccount`, not a shared one).
- Domain `www.klaushofrichter.net` is unchanged; only its `DomainMapping` target moves from `www-placeholder/www-placeholder` to `www/www`.
- Never commit secrets. `KUBE_SETUP_DEPLOY_TOKEN` (GitHub Actions secret) and the runner's registration PAT (`runner-pat` K8s Secret) are created by the user directly (via `!`-prefixed shell commands or their own terminal), never pasted into chat.
- Any `kubectl delete` against the live cluster (retiring `www-placeholder`) requires explicit user confirmation before running, per this session's safety rules (shared/live infrastructure, hard to reverse).

---

## Task 1: Scaffold the app repo locally

**Files:**
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/package.json`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/tsconfig.json`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/vitest.config.ts`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/.gitignore`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/.dockerignore`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/Dockerfile`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/LICENSE`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/public/index.html`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/src/app.ts`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/src/server.ts`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/src/routes/health.ts`
- Test: `/Users/klaushofrichter/Development/www-klaushofrichter/test/health.test.ts`
- Test: `/Users/klaushofrichter/Development/www-klaushofrichter/test/index.test.ts`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/playwright.config.ts`
- Test: `/Users/klaushofrichter/Development/www-klaushofrichter/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `createApp(): Express` exported from `src/app.ts` — consumed by `src/server.ts` and both test files, exactly like `steps-service`'s `src/app.ts`.
- Produces: `healthRouter` (Express `Router`) exported from `src/routes/health.ts`, mounted in `src/app.ts`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "www-klaushofrichter",
  "version": "1.0.0",
  "private": true,
  "description": "Static site for www.klaushofrichter.net, served by Express on Knative/k3s.",
  "type": "commonjs",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {},
});
```

- [ ] **Step 4: `.gitignore`**

```
node_modules/
dist/
*.log
.env
test-results/
playwright-report/
```

- [ ] **Step 5: `.dockerignore`**

```
node_modules
dist
test
e2e
playwright.config.ts
test-results
playwright-report
.git
*.md
```

- [ ] **Step 6: `LICENSE`** (MIT, matching the "public, MIT license" requirement)

```
MIT License

Copyright (c) 2026 Klaus Hofrichter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: `public/index.html`** (deliberately different wording from `www-placeholder`'s page, so the swap is visibly confirmable)

```html
<!doctype html>
<html>
  <head><title>www.klaushofrichter.net</title></head>
  <body style="font-family: sans-serif; text-align: center; margin-top: 10%;">
    <h1>www.klaushofrichter.net</h1>
    <p>Hello from www-klaushofrichter, running on Knative/k3s.</p>
  </body>
</html>
```

- [ ] **Step 8: Write the failing test for `/health`**

`test/health.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with a status ok body', async () => {
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'www-klaushofrichter' });
  });
});
```

- [ ] **Step 9: Write the failing test for `/`**

`test/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /', () => {
  it('serves the static index page', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Hello from www-klaushofrichter');
  });

  it('returns 404 for an unknown path', async () => {
    const app = createApp();
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 10: Install dependencies and confirm both new tests fail**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
npm install
npm test
```
Expected: FAIL — `src/app.ts` does not exist yet (`Cannot find module '../src/app'`).

- [ ] **Step 11: Implement `src/routes/health.ts`**

```typescript
import { Router, Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'www-klaushofrichter' });
});
```

- [ ] **Step 12: Implement `src/app.ts`**

```typescript
import express, { Express } from 'express';
import path from 'path';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();
  app.use(healthRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}
```

- [ ] **Step 13: Implement `src/server.ts`**

```typescript
import { createApp } from './app';

const port = Number(process.env.PORT) || 8080;
const app = createApp();

app.listen(port, () => {
  console.log(`www-klaushofrichter listening on port ${port}`);
});
```

- [ ] **Step 14: Run tests and confirm they pass**

```bash
npm test
```
Expected: PASS — 3 tests (1 health, 2 index).

- [ ] **Step 15: `Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

- [ ] **Step 16: Build and smoke-test the image locally**

```bash
docker build -t www-klaushofrichter:local .
docker run --rm -p 8080:8080 -d --name www-klaushofrichter-smoke www-klaushofrichter:local
sleep 1
curl -sf http://localhost:8080/health
curl -sf http://localhost:8080/ | grep -q "Hello from www-klaushofrichter" && echo OK
docker stop www-klaushofrichter-smoke
```
Expected: `/health` returns the JSON body, `/` contains the marker text, `OK` printed.

- [ ] **Step 17: `playwright.config.ts`** — points at `BASE_URL` (defaults to local dev for running the suite by hand; the deploy workflow in Task 2 overrides it to the live production URL)

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
  },
});
```

- [ ] **Step 18: `e2e/smoke.spec.ts`** — the smoke test the deploy workflow runs against production after rollout

```typescript
import { test, expect } from '@playwright/test';

test('home page loads and shows the expected content', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('www.klaushofrichter.net');
  await expect(page.getByText('Hello from www-klaushofrichter')).toBeVisible();
});

test('/health reports ok', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', service: 'www-klaushofrichter' });
});
```

- [ ] **Step 19: Install Playwright's browser binary and run the suite locally against the Docker smoke-test container from Step 16**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
npx playwright install --with-deps chromium
docker run --rm -p 8080:8080 -d --name www-klaushofrichter-e2e www-klaushofrichter:local
sleep 1
BASE_URL=http://localhost:8080 npm run test:e2e
docker stop www-klaushofrichter-e2e
```
Expected: both Playwright tests pass (2 passed).

- [ ] **Step 20: `README.md`**

```markdown
# www-klaushofrichter

Static site served at [www.klaushofrichter.net](https://www.klaushofrichter.net).
Currently a minimal placeholder-style page — a more complex service will
replace this content once the deployment pipeline below is proven out.

## API

- `GET /` — the static HTML page (`public/index.html`)
- `GET /health` — returns `{"status": "ok", "service": "www-klaushofrichter"}`

## Development

```bash
npm install
npm test
npm run dev
```

## End-to-end smoke test

`e2e/smoke.spec.ts` (Playwright) checks the home page and `/health` against
a running instance. Run it locally against `npm run dev`/Docker with
`BASE_URL=http://localhost:8080 npm run test:e2e`. The deploy workflow runs
it against `https://www.klaushofrichter.net` right after every production
rollout, as the actual smoke test that gates a deploy as successful.

## Deployment

Builds and pushes to `ghcr.io/klaushofrichter/www-klaushofrichter` via GitHub
Actions on push to `main`. Deploying to production happens on merge to the
`production` branch, via an in-cluster self-hosted GitHub Actions runner —
see `klaushofrichter/kube-setup`'s `docs/self-hosted-runner-cicd-pattern.md`
for the full design, and its `manifests/www/` and `manifests/www-klaushofrichter-runner/`
for this service's cluster manifests.
```

- [ ] **Step 21: `CLAUDE.md`**

```markdown
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
```

- [ ] **Step 22: `git init` and initial commit on `main`**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
git init -b main
git add package.json package-lock.json tsconfig.json vitest.config.ts playwright.config.ts .gitignore .dockerignore Dockerfile LICENSE README.md CLAUDE.md public src test e2e
git commit -m "Initial scaffold: static site, health endpoint, Playwright smoke test"
```

---

## Task 2: Add GitHub Actions workflows

**Files:**
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/.github/workflows/production-checks.yml`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/.github/workflows/build-push.yml`
- Create: `/Users/klaushofrichter/Development/www-klaushofrichter/.github/workflows/deploy-production.yml`

**Interfaces:**
- Consumes: repo secrets `GITHUB_TOKEN` (automatic) and `KUBE_SETUP_DEPLOY_TOKEN` (set in Task 4).
- Consumes: in-cluster runner labels `[self-hosted, k3s]` registered against this repo (created in Task 5).
- Produces: image `ghcr.io/klaushofrichter/www-klaushofrichter:<sha>` (and `:latest` from `main`), and an updated `kube-setup/manifests/www/www-ksvc.yaml` on deploy.

- [ ] **Step 1: `production-checks.yml`** (identical pattern to `steps-service`, no per-repo changes needed beyond context)

```yaml
name: Production PR checks

on:
  pull_request:
    branches: [production]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - run: npm test

  codeql:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      actions: read
    steps:
      - uses: actions/checkout@v4

      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript

      - uses: github/codeql-action/analyze@v3
        with:
          output: sarif-results
          upload: never

      - name: Fail if CodeQL found any results
        run: |
          set -euo pipefail
          total=0
          for f in sarif-results/*.sarif; do
            count=$(jq '[.runs[].results[]] | length' "$f")
            total=$((total + count))
          done
          echo "CodeQL findings: $total"
          if [ "$total" -gt 0 ]; then
            echo "::error::CodeQL found $total finding(s) — blocking merge"
            exit 1
          fi
```

- [ ] **Step 2: `build-push.yml`**

```yaml
name: Build and publish image

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies and run tests
        run: |
          npm ci
          npm test

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/klaushofrichter/www-klaushofrichter:latest
            ghcr.io/klaushofrichter/www-klaushofrichter:${{ github.sha }}
```

- [ ] **Step 3: `deploy-production.yml`** (same pattern as `steps-service`'s, with the data-capture/restore steps dropped — this service is stateless static content, nothing to preserve across a deploy)

```yaml
name: Deploy production

on:
  push:
    branches: [production]

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: [self-hosted, k3s]
    steps:
      - uses: actions/checkout@v4

      - name: Install kubectl and configure in-cluster access
        run: |
          set -euo pipefail
          if ! command -v kubectl >/dev/null 2>&1; then
            curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
            chmod +x kubectl
            sudo mv kubectl /usr/local/bin/kubectl
          fi
          kubectl version --client
          SA_DIR=/var/run/secrets/kubernetes.io/serviceaccount
          kubectl config set-cluster in-cluster \
            --server=https://kubernetes.default.svc \
            --certificate-authority="${SA_DIR}/ca.crt"
          kubectl config set-credentials deploy-sa --token="$(cat "${SA_DIR}/token")"
          kubectl config set-context in-cluster --cluster=in-cluster --user=deploy-sa --namespace=www
          kubectl config use-context in-cluster

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/klaushofrichter/www-klaushofrichter:${{ github.sha }}

      - name: Prune old Docker images
        run: docker system prune -af --filter "until=168h" || true

      - name: Update kube-setup manifest and deploy
        env:
          KUBE_SETUP_DEPLOY_TOKEN: ${{ secrets.KUBE_SETUP_DEPLOY_TOKEN }}
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          rm -rf /tmp/kube-setup-deploy
          git clone "https://x-access-token:${KUBE_SETUP_DEPLOY_TOKEN}@github.com/klaushofrichter/kube-setup.git" /tmp/kube-setup-deploy
          cd /tmp/kube-setup-deploy
          sed -i "s|image: ghcr.io/klaushofrichter/www-klaushofrichter:.*|image: ghcr.io/klaushofrichter/www-klaushofrichter:${SHA}|" manifests/www/www-ksvc.yaml
          grep -q "image: ghcr.io/klaushofrichter/www-klaushofrichter:${SHA}$" manifests/www/www-ksvc.yaml \
            || { echo "::error::manifest image line did not update to ${SHA}"; exit 1; }
          git config user.name "www-klaushofrichter-deploy-bot"
          git config user.email "actions@users.noreply.github.com"
          git add manifests/www/www-ksvc.yaml
          if git diff --cached --quiet; then
            echo "No manifest change (image tag already up to date) — skipping commit/push."
          else
            git commit -m "Deploy www-klaushofrichter ${SHA}"
            git push
          fi
          kubectl apply -f manifests/www/www-ksvc.yaml
          rm -rf /tmp/kube-setup-deploy

      - name: Verify rollout
        run: |
          set -euo pipefail
          kubectl wait --for=condition=Ready ksvc/www -n www --timeout=120s
          kubectl get ksvc www -n www

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run Playwright smoke test against production
        env:
          BASE_URL: https://www.klaushofrichter.net
        run: |
          set -euo pipefail
          npm ci
          npx playwright install --with-deps chromium
          npm run test:e2e
```

This is the actual gate on deploy success — a `Ready` Knative revision only proves
the container started, not that the site behind the domain (DNS, TLS, Traefik
routing, the app itself) is actually serving correctly. A failure here fails
the workflow run, the same as any other step.

- [ ] **Step 4: Commit**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
git add .github
git commit -m "Add production PR checks, build-push, and deploy workflows"
```

---

## Task 3: Create the GitHub repo and branches

**Files:** none (GitHub API / git operations only).

- [ ] **Step 1: Create the repo (public, no auto-init — we already have local history)**

```bash
gh repo create klaushofrichter/www-klaushofrichter --public --source=/Users/klaushofrichter/Development/www-klaushofrichter --remote=origin --push
```
Expected: repo created at `https://github.com/klaushofrichter/www-klaushofrichter`, `main` pushed, `origin` remote set.

- [ ] **Step 2: Create and push the `production` branch from `main`**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
git checkout -b production
git push -u origin production
git checkout main
```

- [ ] **Step 3: Confirm both branches exist on GitHub**

```bash
gh api repos/klaushofrichter/www-klaushofrichter/branches --jq '.[].name'
```
Expected: `main` and `production` both listed.

---

## Task 4: kube-setup manifests for the `www` Knative Service

**Files:**
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www/www-ksvc.yaml`
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www/www-domainmapping.yaml`
- Modify: `/Users/klaushofrichter/Development/kube-setup/manifests/00-namespaces.yaml`
- Modify: `/Users/klaushofrichter/Development/kube-setup/scripts/export.sh`
- Modify: `/Users/klaushofrichter/Development/kube-setup/bootstrap.sh`
- Delete: `/Users/klaushofrichter/Development/kube-setup/manifests/placeholders/www-ksvc.yaml`
- Delete: `/Users/klaushofrichter/Development/kube-setup/manifests/placeholders/www-domainmapping.yaml`
- Delete: `/Users/klaushofrichter/Development/kube-setup/manifests/placeholders/www-configmap.yaml`

**Interfaces:**
- Produces: `www` namespace, Knative Service `www/www` (image placeholder tag, overwritten by the first real deploy), `DomainMapping www.klaushofrichter.net` → `www/www`.

- [ ] **Step 1: `manifests/www/www-ksvc.yaml`**

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  annotations:
    networking.knative.dev/ingress.class: kourier.ingress.networking.knative.dev
    serving.knative.dev/creator: system:admin
    serving.knative.dev/lastModifier: system:admin
  name: www
  namespace: www
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/max-scale: '1'
        autoscaling.knative.dev/min-scale: '1'
    spec:
      containerConcurrency: 0
      containers:
      - image: ghcr.io/klaushofrichter/www-klaushofrichter:latest
        name: user-container
        ports:
        - containerPort: 8080
          protocol: TCP
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          successThreshold: 1
        resources:
          limits:
            cpu: 500m
            memory: 256Mi
      enableServiceLinks: false
      timeoutSeconds: 300
  traffic:
  - latestRevision: true
    percent: 100
```

- [ ] **Step 2: `manifests/www/www-domainmapping.yaml`**

```yaml
apiVersion: serving.knative.dev/v1beta1
kind: DomainMapping
metadata:
  annotations:
    serving.knative.dev/creator: system:admin
    serving.knative.dev/lastModifier: system:admin
  name: www.klaushofrichter.net
  namespace: www
spec:
  ref:
    apiVersion: serving.knative.dev/v1
    kind: Service
    name: www
    namespace: www
```

- [ ] **Step 3: Edit `manifests/00-namespaces.yaml`** — replace the `www-placeholder` namespace block with `www`, and add the new runner namespace (Task 5 also touches this file for the runner namespace — do both edits together here to keep the file coherent):

Replace:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: www-placeholder
  name: www-placeholder
spec:
  finalizers:
  - kubernetes
```
with:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: www
  name: www
spec:
  finalizers:
  - kubernetes
```
and append after the existing `github-runner` namespace block:
```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: www-klaushofrichter-runner
  name: www-klaushofrichter-runner
spec:
  finalizers:
  - kubernetes
```

- [ ] **Step 4: Delete the retired placeholder manifests**

```bash
cd /Users/klaushofrichter/Development/kube-setup
git rm manifests/placeholders/www-ksvc.yaml manifests/placeholders/www-domainmapping.yaml manifests/placeholders/www-configmap.yaml
```

- [ ] **Step 5: Update `scripts/export.sh`**

Change the namespace list to drop `www-placeholder` and add `www`/`www-klaushofrichter-runner`:
```bash
kubectl get namespace home-assistant horse-placeholder hook-placeholder monitor-placeholder headlamp steps github-runner www www-klaushofrichter-runner -o yaml | $CLEAN > "$MDIR/00-namespaces.yaml"
```

Change the placeholder loop from `for name in horse hook monitor www; do` to:
```bash
for name in horse hook monitor; do
```

Add, alongside the existing `steps`/`github-runner` export block:
```bash
mkdir -p "$MDIR/www" "$MDIR/www-klaushofrichter-runner"

kubectl get ksvc www -n www -o yaml | $CLEAN > "$MDIR/www/www-ksvc.yaml"
kubectl get domainmapping -n www -o yaml | $CLEAN > "$MDIR/www/www-domainmapping.yaml"

kubectl get serviceaccount deploy-sa -n www-klaushofrichter-runner -o yaml | $CLEAN > "$MDIR/www-klaushofrichter-runner/serviceaccount.yaml"
kubectl get role,rolebinding -n www -o yaml | $CLEAN > "$MDIR/www-klaushofrichter-runner/rbac.yaml"
kubectl get networkpolicy default-deny-ingress -n www-klaushofrichter-runner -o yaml | $CLEAN > "$MDIR/www-klaushofrichter-runner/networkpolicy.yaml"
# www-klaushofrichter-runner/runner-deployment.yaml is hand-maintained (same
# dockerd arg-ordering fix as github-runner/runner-deployment.yaml) - not
# regenerated here.
# NOTE: the runner-pat Secret in this namespace is deliberately never
# exported - see README.md "Secrets" section.
```
(also add the same two `mkdir -p` targets into the existing combined `mkdir -p "$MDIR/home-assistant" ...` line instead of a separate line, to match the file's existing style)

- [ ] **Step 6: Update `bootstrap.sh`** — add, after the existing `manifests/github-runner/` apply block:

```bash
echo "== 10d. www Knative Service (www.klaushofrichter.net) =="
kubectl apply -f manifests/www/

echo "== 10e. In-cluster GitHub Actions runner (www-klaushofrichter CI/CD) =="
echo "   Requires a 'runner-pat' Secret (GitHub PAT scoped to Administration:"
echo "   Read and write on klaushofrichter/www-klaushofrichter) BEFORE this"
echo "   will come up healthy - see README.md 'Secrets' section:"
echo "   kubectl create secret generic runner-pat -n www-klaushofrichter-runner --from-literal=token='<value>'"
kubectl apply -f manifests/www-klaushofrichter-runner/
```

- [ ] **Step 7: Commit (do not push yet — hold until the live-cluster changes in Task 6 are verified, so the repo and cluster state move together)**

```bash
cd /Users/klaushofrichter/Development/kube-setup
git add manifests/www manifests/00-namespaces.yaml manifests/placeholders scripts/export.sh bootstrap.sh
git commit -m "Add www Knative Service manifests, retire www-placeholder"
```

---

## Task 5: kube-setup manifests for the dedicated www runner

**Files:**
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www-klaushofrichter-runner/namespace.yaml`
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www-klaushofrichter-runner/serviceaccount.yaml`
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www-klaushofrichter-runner/networkpolicy.yaml`
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www-klaushofrichter-runner/rbac.yaml`
- Create: `/Users/klaushofrichter/Development/kube-setup/manifests/www-klaushofrichter-runner/runner-deployment.yaml`
- Modify: `/Users/klaushofrichter/Development/kube-setup/README.md`
- Modify: `/Users/klaushofrichter/Development/kube-setup/CLAUDE.md`

**Interfaces:**
- Consumes: `runner-pat` Secret (created by the user in Task 7) in the `www-klaushofrichter-runner` namespace.
- Produces: a running runner pod registered to `klaushofrichter/www-klaushofrichter` with labels `self-hosted,k3s`, whose `ServiceAccount` (`deploy-sa`) is granted exactly `serving.knative.dev/services` create/update/patch/get/list/watch in the `www` namespace — nothing more, and isolated from `steps-service`'s runner (separate namespace, separate SA).

- [ ] **Step 1: `namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: www-klaushofrichter-runner
  name: www-klaushofrichter-runner
```

- [ ] **Step 2: `serviceaccount.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: deploy-sa
  namespace: www-klaushofrichter-runner
```

- [ ] **Step 3: `networkpolicy.yaml`**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: www-klaushofrichter-runner
spec:
  podSelector: {}
  policyTypes:
  - Ingress
```

- [ ] **Step 4: `rbac.yaml`** (no Secret-read rule needed — unlike `steps-oauth`, this service has no Secrets)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: www-deployer
  namespace: www
rules:
- apiGroups:
  - serving.knative.dev
  resources:
  - services
  verbs:
  - get
  - list
  - watch
  - create
  - update
  - patch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: www-klaushofrichter-runner-www-deployer
  namespace: www
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: www-deployer
subjects:
- kind: ServiceAccount
  name: deploy-sa
  namespace: www-klaushofrichter-runner
```

- [ ] **Step 5: `runner-deployment.yaml`** (same locked-down `dind` pattern as `github-runner/runner-deployment.yaml`: loopback-only Docker daemon, sized `emptyDir` for image storage, resource limits on both containers)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: www-klaushofrichter-runner
  namespace: www-klaushofrichter-runner
spec:
  replicas: 1
  selector:
    matchLabels:
      app: www-klaushofrichter-runner
  template:
    metadata:
      labels:
        app: www-klaushofrichter-runner
    spec:
      serviceAccountName: deploy-sa
      containers:
      - name: runner
        image: myoung34/github-runner:latest
        env:
        - name: ACCESS_TOKEN
          valueFrom:
            secretKeyRef:
              name: runner-pat
              key: token
        - name: RUNNER_SCOPE
          value: "repo"
        - name: REPO_URL
          value: "https://github.com/klaushofrichter/www-klaushofrichter"
        - name: RUNNER_NAME
          value: "www-klaushofrichter-in-cluster-runner"
        - name: LABELS
          value: "self-hosted,k3s"
        - name: RUNNER_WORKDIR
          value: "/tmp/runner-work"
        - name: DOCKER_HOST
          value: "tcp://localhost:2375"
        - name: DISABLE_WAIT_FOR_DOCKER
          value: "1"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "1"
        volumeMounts:
        - name: work
          mountPath: /tmp/runner-work
      - name: dind
        image: docker:24-dind
        # Explicit leading "dockerd" arg is required: the stock dind
        # entrypoint only skips its own default "--host=tcp://0.0.0.0:2375"
        # when the first arg doesn't start with "-" (i.e. is "dockerd"
        # itself). Passing just "--host=..." gets appended AFTER that
        # insecure default, so the daemon ends up listening on both.
        args:
        - dockerd
        - --host=unix:///var/run/docker.sock
        - --host=tcp://127.0.0.1:2375
        securityContext:
          privileged: true
        env:
        - name: DOCKER_TLS_CERTDIR
          value: ""
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "2"
        volumeMounts:
        - name: work
          mountPath: /tmp/runner-work
        - name: docker-storage
          mountPath: /var/lib/docker
      volumes:
      - name: work
        emptyDir: {}
      - name: docker-storage
        emptyDir:
          sizeLimit: 20Gi
```

- [ ] **Step 6: Add a "Secrets" bullet for `runner-pat` (www) to `README.md`**, next to the existing `runner-pat` (steps-service) bullet:

```markdown
  - **`runner-pat`** (Kubernetes Secret, `www-klaushofrichter-runner`
    namespace) - a GitHub PAT (`Administration: read and write` on
    `klaushofrichter/www-klaushofrichter`) that this repo's in-cluster
    Actions runner uses to self-register. Same pattern as the
    `steps-service` runner's `runner-pat` above, but repo-scoped separately
    - generate via
    `https://github.com/settings/personal-access-tokens/new`, then:
    `kubectl create secret generic runner-pat -n www-klaushofrichter-runner --from-literal=token='<value>'`.
```

- [ ] **Step 7: Update `CLAUDE.md`'s cluster overview bullet for `www.klaushofrichter.net`**, replacing the placeholder description:

Replace:
```
- `horse.zapto.org`, `hook.skylar.technology`, `monitor.skylar.technology`,
  `www.klaushofrichter.net` — simple static placeholder pages (Knative
  Services, each pinned min/max-scale=1 in their own namespace,
  `www-placeholder` for the last one). `www.klaushofrichter.net`'s DNS was
  moved here 2026-08-20 from a Squarespace CNAME (`ghs.google.com`) to an A
  record pointing at this cluster's public IP — this is a **different**
  domain from `www.skylar.technology` below, which stays on Squarespace.
```
with:
```
- `horse.zapto.org`, `hook.skylar.technology`, `monitor.skylar.technology` —
  simple static placeholder pages (Knative Services, each pinned
  min/max-scale=1 in their own namespace).
- `www.klaushofrichter.net` — `www-klaushofrichter` static site (Knative
  Service, pinned min/max-scale=1, `www` namespace, image from
  `ghcr.io/klaushofrichter/www-klaushofrichter`), replacing the earlier
  `www-placeholder`. DNS was moved here 2026-08-20 from a Squarespace CNAME
  (`ghs.google.com`) to an A record pointing at this cluster's public IP -
  this is a **different** domain from `www.skylar.technology` below, which
  stays on Squarespace. Deployed the same way as `steps-service` (protected
  `production` branch, dedicated in-cluster self-hosted runner in the
  `www-klaushofrichter-runner` namespace — see
  `docs/self-hosted-runner-cicd-pattern.md`).
```

- [ ] **Step 8: Commit (still held from pushing — see Task 4 Step 7)**

```bash
cd /Users/klaushofrichter/Development/kube-setup
git add manifests/www-klaushofrichter-runner README.md CLAUDE.md
git commit -m "Add dedicated in-cluster runner for www-klaushofrichter"
```

---

## Task 6: User-provided credentials (cannot be automated — do not paste secret values into chat)

**Files:** none — these are commands for the user to run themselves, via `!`-prefixed shell commands or their own terminal.

- [ ] **Step 1 (user): Set `KUBE_SETUP_DEPLOY_TOKEN` on the new repo.** The existing `steps-service` token is a fine-grained PAT scoped to `Contents: Read and write` on `kube-setup` only, not to a specific caller repo, so it can be reused if you still have its value (e.g. in a password manager); otherwise generate a fresh one the same way (`https://github.com/settings/personal-access-tokens/new`, `Contents: Read and write` on `kube-setup`). Then:
```bash
gh secret set KUBE_SETUP_DEPLOY_TOKEN --repo klaushofrichter/www-klaushofrichter --body "<paste-token-here>"
```

- [ ] **Step 2 (user): Generate a runner-registration PAT for the new repo.** Go to `https://github.com/settings/personal-access-tokens/new`, scope: `Administration: Read and write` on `klaushofrichter/www-klaushofrichter` only (cannot reuse `steps-service`'s — PATs are repo-scoped). Do not paste the value into chat.

- [ ] **Step 3 (user, on the k3s host, after Task 7's `kubectl apply` creates the `www-klaushofrichter-runner` namespace): Create the `runner-pat` Secret:**
```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl create secret generic runner-pat -n www-klaushofrichter-runner --from-literal=token='<value-from-step-2>'
```

---

## Task 7: Apply manifests to the live cluster

**Files:** none (live `kubectl` operations against the cluster documented by `kube-setup`).

This task touches shared/live infrastructure — confirm with the user before running Step 3 (deleting the old `www-placeholder` resources).

- [ ] **Step 1: Apply the new namespaces and RBAC/runner manifests (safe to apply before the Secret exists — the runner pod will just crash-loop until Task 6 Step 3 is done, per `bootstrap.sh`'s existing pattern for `steps-service`)**

```bash
export KUBECONFIG=~/.kube/k3s-config
cd /Users/klaushofrichter/Development/kube-setup
kubectl apply -f manifests/00-namespaces.yaml
kubectl apply -f manifests/www-klaushofrichter-runner/
```

- [ ] **Step 2: Apply the `www` Knative Service (using the `:latest` image tag from Task 4 Step 1 as an interim placeholder — the first real merge to `production` overwrites it with a `:<sha>` tag)**

```bash
kubectl apply -f manifests/www/
kubectl wait --for=condition=Ready ksvc/www -n www --timeout=120s
```

- [ ] **Step 3 (confirm with user first): Delete the retired `www-placeholder` namespace** (cascades its `ConfigMap`, Knative `Service`, and `DomainMapping`)

```bash
kubectl delete namespace www-placeholder
```

- [ ] **Step 4: Verify the domain now serves the new site**

```bash
curl -s https://www.klaushofrichter.net/health
curl -s https://www.klaushofrichter.net/ | grep -q "Hello from www-klaushofrichter" && echo OK
```
Expected: the new `/health` JSON body, `OK` printed.

- [ ] **Step 5: Push the held `kube-setup` commits from Tasks 4 and 5**

```bash
cd /Users/klaushofrichter/Development/kube-setup
git push
```

---

## Task 8: Branch protection and end-to-end deploy test

**Files:** none.

- [ ] **Step 1: Confirm the runner is online**

```bash
gh api repos/klaushofrichter/www-klaushofrichter/actions/runners --jq '.runners[] | {name, status}'
```
Expected: `www-klaushofrichter-in-cluster-runner`, `status: "online"`.

- [ ] **Step 2: Configure branch protection on `production`**

```bash
gh api --method PUT repos/klaushofrichter/www-klaushofrichter/branches/production/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=test" \
  -f "required_status_checks[contexts][]=codeql" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews=null" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

- [ ] **Step 3: End-to-end test — open a throwaway PR from `main` to `production`**

```bash
cd /Users/klaushofrichter/Development/www-klaushofrichter
git checkout main
echo "<!-- deploy pipeline smoke test -->" >> public/index.html
git add public/index.html
git commit -m "Smoke test: confirm production deploy pipeline"
git push
gh pr create --base production --head main --title "Smoke test: confirm production deploy pipeline" --body "Verifies production-checks + deploy-production work end to end."
```

- [ ] **Step 4: Confirm both PR checks pass, then merge**

```bash
gh pr checks --repo klaushofrichter/www-klaushofrichter --watch
gh pr merge --repo klaushofrichter/www-klaushofrichter --merge
```

- [ ] **Step 5: Confirm the deploy workflow ran on the self-hosted runner, including its Playwright smoke-test step, and succeeded**

```bash
gh run list --repo klaushofrichter/www-klaushofrichter --workflow=deploy-production.yml --limit 1
gh run view --repo klaushofrichter/www-klaushofrichter --log --job "$(gh run list --repo klaushofrichter/www-klaushofrichter --workflow=deploy-production.yml --limit 1 --json databaseId --jq '.[0].databaseId')" 2>/dev/null | grep -i "Run Playwright smoke test against production" || true
curl -s https://www.klaushofrichter.net/ | grep -q "deploy pipeline smoke test" && echo "Deploy pipeline confirmed working end to end"
```
Expected: the workflow run's conclusion is `success` (a failing Playwright
smoke test would have failed the whole run), and the `curl` marker text is
present.
