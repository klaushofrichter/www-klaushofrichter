# www-klaushofrichter

Personal homepage for Klaus Hofrichter, served at
[www.klaushofrichter.net](https://www.klaushofrichter.net) — an about
section plus a grid of links to LinkedIn, GitHub, past portfolio/blog work,
Instagram, and Medium, each with a hero image kept fresh via a daily
background refresh (see "Image refresh" below).

## API

- `GET /` — the homepage: an about section, a responsive grid of link
  cards (each with a title, short abstract, and hero image fetched from
  the target site's `og:image` where available), and a footer.
- `GET /images/:id` — serves a downloaded hero image; `404` if none was
  successfully fetched for that id.
- `POST /refresh` — re-fetches all hero images on demand (also the small
  ⟳ button in the page's top-right corner). Subject to a 60-second
  cooldown; returns `429` if called again too soon.
- `GET /health` — returns `{"status": "ok", "service": "www-klaushofrichter"}`

## Development

```bash
npm install
npm test
npm run dev
```

## Image refresh

Each card's hero image comes from the target URL's `og:image` meta tag,
downloaded to local disk on container startup and re-fetched once a day
(06:00 UTC) via an in-process `node-cron` job — no persistent storage, no
separate CronJob resource; images just repopulate on every restart. A
link whose `og:image` can't be fetched (LinkedIn and Instagram commonly
block non-browser requests) falls back to a plain gradient card instead
of a broken image. See `docs/superpowers/specs/2026-08-20-homepage-design.md`
for the full design.

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
