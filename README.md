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
