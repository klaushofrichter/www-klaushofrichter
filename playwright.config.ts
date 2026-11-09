import { defineConfig, devices } from '@playwright/test';

/**
 * Where the suite points:
 *  - BASE_URL unset: http://localhost:8080, a server you started yourself
 *    (`npm start`, or the image as production-checks.yml runs it);
 *  - BASE_URL=https://www.klaushofrichter.net with --grep @live: the live
 *    site, after a release (live-check.yml). Only read-only, signed-out tests
 *    carry @live: nothing tagged @live may POST or sign in.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const LIVE = BASE_URL.startsWith('https://');

// The stateful signed-in story; see the projects below.
const SIGNED_IN_STORY = /dashboard\.spec\.ts/;

// For machines with a Chromium outside Playwright's cache. Unset in CI, which
// installs its own browsers.
const chromiumLaunch = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One retry absorbs a runner hiccup, but a test that needed it fails the
  // run anyway (failOnFlakyTests): in christina.art a "passed on retry" in
  // Firefox and WebKit was a real layout bug, not noise (kube-setup vault,
  // Gotchas, "Lazy pictures take no space in Firefox and Safari").
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  timeout: LIVE ? 60_000 : 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Desktop Chrome, an Android phone, an iPhone (WebKit is Safari's engine)
  // and desktop Firefox: the four a visitor arrives on.
  //
  // The signed-in IP survey (dashboard.spec.ts) runs in desktop Chromium
  // only: it is a serial story against ONE server and ONE fake scanner, whose
  // saved survey is shared state, so four browsers running it at once would
  // edit each other's data. It is a private page; the four-browser rule is
  // for what the public sees.
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
    { name: 'phone-chromium', testIgnore: SIGNED_IN_STORY, use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch } },
    { name: 'phone-webkit', testIgnore: SIGNED_IN_STORY, use: { ...devices['iPhone 13'] } },
    { name: 'desktop-firefox', testIgnore: SIGNED_IN_STORY, use: { ...devices['Desktop Firefox'] } },
  ],
});
