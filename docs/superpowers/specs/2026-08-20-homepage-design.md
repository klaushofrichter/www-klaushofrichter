# Klaus Hofrichter Homepage — Design Spec

## Goal

Replace the current placeholder page served at `www.klaushofrichter.net`
with a real personal homepage: a short "about" section followed by a
responsive grid of cards, one per external profile/site, each showing a
hero image, title, and short abstract. Same repo (`www-klaushofrichter`),
same Knative Service/domain/CI-CD pipeline built previously — this replaces
the app's content, not its infrastructure.

## Non-goals

- No dynamic/admin configuration of the link list — it's a hand-authored
  config file, edited via a normal code change + deploy.
- No pagination (fixed at ~10 cards max, currently 6).
- No light/dark mode toggle — one fixed dark color scheme.
- No persistent storage (PVC/S3) for downloaded images — see "Image
  persistence" below.
- No user accounts/auth anywhere on the site, including the refresh button.

## Content

### Link list (`src/links.ts`)

| id | Title | URL | Abstract |
|---|---|---|---|
| `linkedin` | LinkedIn | `https://www.linkedin.com/in/klaushofrichter` | Professional profile, career history, and updates. |
| `github` | GitHub | `https://github.com/klaushofrichter` | Open-source projects, code, and experiments. |
| `portfolio2017` | Portfolio 2017 | `https://klaushofrichter.wordpress.com` | An earlier portfolio and blog archive. |
| `instagram` | Instagram | `https://www.instagram.com/klaushofrichter` | Photos and moments, shared casually. |
| `threepuppies` | Three Puppies | `https://three-pups.mystrikingly.com` | A small site about three very good dogs. |
| `medium` | Medium | `https://medium.com/@klaushofrichter` | Articles and longer-form writing. |
| `skylar` | Skylar Technology | `https://www.skylar.technology` | Skylar Technology LLC. |

Each entry is `{ id, title, url, abstract }`. Adding a 7th–10th link later
is a one-line addition to this array — no other code changes needed.

### About section

Short, centered, above the card grid:

> **Klaus Hofrichter**
> Engineer, tinkerer, and occasional puppy photographer. This page
> collects the places you can find me online — from professional profiles
> to side projects and creative work.

### Footer

Centered, small text, below the card grid:

> Contact: klaus@klaushofrichter.net

## Visual design

Approved via mockup during brainstorming: **dark glassmorphism** (style
"A"). One fixed color scheme, no light/dark toggle.

- Background: dark gradient, `linear-gradient(160deg, #0f0c29, #1b1740, #24243e)`.
- Text: near-white (`#eef0fb`) at ~75% opacity for body copy, full opacity
  for headings.
- Cards: `rgba(255,255,255,0.06)` background, `backdrop-filter: blur(6px)`,
  `1px solid rgba(255,255,255,0.12)` border, `14px` border-radius.
- Card hero image area: the downloaded image if available; otherwise a
  decorative gradient specific to that card (used as both a stylistic
  accent behind/around real images and as the fallback when no image was
  fetched — see "Image fetch failure" below).
- Link color accent: `#93a5fd`.
- Per-card accent gradient (used behind/around the image, and alone as the
  fallback when no image was downloaded), matching the approved mockup:

  | id | Gradient |
  |---|---|
  | `linkedin` | `linear-gradient(135deg, #3b82f6, #8b5cf6)` |
  | `github` | `linear-gradient(135deg, #1f2937, #374151)` |
  | `instagram` | `linear-gradient(135deg, #f97316, #ec4899)` |
  | `threepuppies` | `linear-gradient(135deg, #059669, #10b981)` |
  | `portfolio2017` | `linear-gradient(135deg, #6b7280, #9ca3af)` |
  | `medium` | `linear-gradient(135deg, #000000, #3a3a3a)` |
- Layout: `display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` —
  reflows from a multi-column grid down to a single column automatically as
  the viewport narrows, satisfying "one card fits on a mobile screen"
  without a separate mobile stylesheet.
- Scrollbar: default browser behavior already only shows a scrollbar when
  content overflows (no extra CSS needed for that part). Styled to match
  the dark theme: `::-webkit-scrollbar` (thin, dark track, subtle
  lavender thumb) for Chromium/Safari, `scrollbar-width: thin` +
  `scrollbar-color` for Firefox.

## Architecture

Extends the existing Express/TypeScript app — no new services, no new
framework.

```
src/
  links.ts          — the static link config (table above)
  ogImage.ts         — fetch a URL, parse og:image, download it
  refreshImages.ts    — orchestrate fetching all links' images + cron
  views/page.ts       — render the full HTML page from links.ts + disk state
  routes/index.ts     — GET / (renders page), POST /refresh
  routes/images.ts    — GET /images/:file (serves downloaded images)
  routes/health.ts     — unchanged
  app.ts              — wires it all together
  server.ts            — unchanged entrypoint, calls refreshImages() once
                          before listening
data/
  images/             — downloaded hero images live here at runtime
                          (gitignored; created at container startup)
```

### Image fetch (`ogImage.ts`)

- `fetchOgImage(url: string): Promise<string | null>` — `GET`s the URL
  with a realistic `User-Agent` header and an 8s timeout, parses the HTML
  with `cheerio`, reads `meta[property="og:image"]`'s `content` attribute.
  Returns `null` (not a throw) if the request fails, times out, or no tag
  is found.
- `downloadImage(imageUrl: string, destPath: string): Promise<boolean>` —
  downloads the image bytes to `destPath`. Returns `false` (not a throw)
  on any failure.

### Refresh orchestration (`refreshImages.ts`)

- `refreshAllImages(): Promise<void>` — for every entry in `links.ts`, in
  parallel: `fetchOgImage(link.url)` → if non-null,
  `downloadImage(result, data/images/${link.id}.jpg)`. Failures for one
  link never affect the others (each wrapped so a rejection doesn't
  reject the whole `Promise.all`).
- Called once at server startup, before `app.listen()` — this makes the
  readiness probe (`/health`, unchanged) only start passing once the
  first image pass has completed, so Knative won't route traffic to a
  pod with a completely empty image set. (A link whose fetch fails still
  renders fine — via the gradient fallback — so one bad link doesn't
  block startup.)
- Scheduled via `node-cron` (`0 6 * * *`, once a day) after the initial
  startup call, re-running the same function and overwriting files in
  place. No pod restart needed for the daily refresh to take effect.

### Image fetch failure (fallback)

If `data/images/<id>.jpg` doesn't exist when the page renders (fetch
failed, or server just started and hasn't finished yet), that card's
image area renders the decorative gradient only, with no `<img>` tag —
same visual language as a successful card, just without the photo. This
is expected to happen for LinkedIn and Instagram specifically, both of
which are known to block non-browser `User-Agent`s / require
authentication for their `og:image` — the design treats this as a normal
outcome, not an error state a user would notice.

### Manual refresh button

- Small circular icon button (⟳), fixed top-right corner, low default
  opacity, full opacity on hover — unobtrusive per the requirement.
- `POST /refresh`: in-memory `lastRefresh` timestamp; if now − lastRefresh
  < 60s, responds `429` with `{"error": "cooldown"}`. Otherwise awaits
  `refreshAllImages()` and responds `200 {"status": "ok"}`.
- Client JS: click → button shows a spinner → `fetch('/refresh', {method: 'POST'})` →
  on `200`, `window.location.reload()`; on `429` or network failure, show
  a small inline "try again in a bit" message next to the button instead
  of reloading.
- No auth — the cooldown is the only abuse guard, judged sufficient for a
  low-traffic personal page.

### Routes summary

| Route | Method | Behavior |
|---|---|---|
| `/` | GET | Renders the full page from `links.ts` + current `data/images/` contents |
| `/images/:file` | GET | Serves a downloaded image (404 if not present) |
| `/refresh` | POST | Triggers `refreshAllImages()`, subject to 60s cooldown |
| `/health` | GET | Unchanged: `{"status": "ok", "service": "www-klaushofrichter"}` |

## Data flow

1. Container starts → `refreshAllImages()` runs, populating
   `data/images/*.jpg` for whichever links succeed.
2. `app.listen()` starts; `/health` now returns 200; Knative routes
   traffic in.
3. `node-cron` schedules a daily re-run of `refreshAllImages()`, silently
   overwriting `data/images/*.jpg` in place.
4. A user hitting `/` always gets the current on-disk state rendered
   fresh (no caching layer) — always up to date with the last successful
   refresh, per link.
5. A user clicking the refresh button triggers an out-of-band re-run,
   same function, same effect as the daily cron firing early.

## Testing

- **Unit** (Vitest, existing pattern): `ogImage.ts` (mock `fetch`/HTTP —
  cases: valid og:image found, no og:image tag, non-2xx response, timeout),
  `refreshImages.ts` (mocks `ogImage` module — cases: all succeed, one
  fails and others still complete, cooldown logic for the `/refresh`
  route handler).
- **Route tests** (Supertest, existing pattern): `GET /` renders 200 with
  expected structural markers (about text, all 6 card titles present);
  `GET /images/:file` 404s for a non-existent file; `POST /refresh` cooldown
  behavior (first call 200, immediate second call 429).
- **E2E smoke test** (Playwright, existing `e2e/smoke.spec.ts`, run against
  production as the deploy gate — see `docs/self-hosted-runner-cicd-pattern.md`):
  update to assert the new page's real content (about heading, all 6 card
  titles, footer contact text) instead of the old placeholder text.
  `/health` assertion is unchanged.

## Migration notes

- `public/index.html` (the current static placeholder) is removed —
  replaced by server-rendered `views/page.ts`.
- `express.static` serving of `public/` is replaced by the new
  `GET /images/:file` route (downloaded images only; no other static
  assets needed since styling is inline/embedded in the rendered page).
- Docker image: add `cheerio` and `node-cron` as production dependencies;
  no change to the multi-stage build shape otherwise. `data/` is created
  at runtime (not baked into the image) and stays out of `.dockerignore`
  concerns since nothing references it at build time.
- CPU/memory: this is still just HTTP fetches + string templating, no
  headless browser — the existing 200m CPU / 256Mi memory limits (already
  right-sized down from the original placeholder in the previous work)
  should remain sufficient; revisit only if the daily refresh proves
  otherwise.

## Implementation notes (post-design)

- **`downloadImage` return type and filenames deviated from this spec.**
  The spec above describes `downloadImage(): Promise<boolean>` writing to
  `data/images/<id>.jpg`. The shipped implementation instead returns
  `Promise<string | null>` — `null` on any failure, otherwise the
  downloaded image's actual (allowlisted) content-type — and writes to an
  extensionless `data/images/<id>` path, with `refreshImages.ts` keeping a
  separate in-memory `Map<id, contentType>` that `GET /images/:id` reads
  to set the response's `Content-Type` header. This is a deliberate
  improvement made during implementation: assuming `.jpg`/`image/jpeg` for
  every downloaded image was incorrect (og:image targets commonly serve
  PNG, WebP, or GIF), and tracking the real content-type is what makes it
  possible to safely validate it against an allowlist and serve it back
  correctly rather than mislabeling non-JPEG images.
- **og:image social preview + favicons were added after this spec was
  written.** `views/page.ts` now emits `og:image`/`og:title`/
  `og:description`/`og:url`/`og:type` meta tags (so links to this page
  render a rich preview in Slack, iMessage, LinkedIn, etc.) and standard
  favicon `<link>` tags (16x16, 32x32, apple-touch-icon), added because a
  personal homepage with no social preview or browser-tab icon reads as
  unfinished. The backing image files live in `assets/` at the repo root
  (`assets/og-image.png`, `assets/favicon-16x16.png`,
  `assets/favicon-32x32.png`, `assets/apple-touch-icon.png`) and are
  served via a new `express.static` mount at `/assets` in `app.ts` —
  static, checked-in files, unrelated to the dynamically downloaded
  `data/images/` hero images described above.
- **Static per-card screenshots now take priority over the dynamic
  `og:image` fetch — added after this spec was written.** Unauthenticated
  `og:image` fetches for LinkedIn/Instagram hit their login walls, and a
  couple of other targets (mystrikingly.com, medium.com) initially returned
  bot-detection blocks to a plain fetch. Rather than rely on that fragile,
  unauthenticated path, `assets/cards/<id>.png` holds a hand-curated
  1200x630 screenshot per link (all 6 currently have one, captured via
  Playwright/Chromium — and for LinkedIn, via a real logged-in browser
  session, since the anonymous view is a permanent login wall). `src/staticCards.ts`
  exposes `hasStaticCard(id)`/`staticCardUrl(id)`; `refreshImages.ts` skips
  any link with a static card entirely (no startup fetch, no daily cron
  entry for it), and `page.ts` resolves each card's image in the order
  static asset → dynamic `/images/:id` → gradient fallback. The dynamic
  fetch/cron path from the section above is unchanged and still applies to
  any future link added without a static asset. The card image area is now
  wrapped in a link to the card's URL (previously only the small text link
  at the bottom was clickable), and the card grid is 25% wider
  (`minmax(220px, 1fr)` → `minmax(275px, 1fr)`).
