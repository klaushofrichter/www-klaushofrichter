import { Page, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// Shared by the public-page specs (site, quality, a11y). Adapted from
// klaushofrichter/christina.art, the reference for kube-setup's "public web
// pages" baseline.

/** Console errors, uncaught exceptions, CSP violations and failed same-site
 *  requests seen while a test runs. Walkthroughs end by asserting it is
 *  empty: a page that "works" while the console fills with errors is not
 *  working. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(page.url() || r.url()).origin && r.status() >= 400 && !u.pathname.startsWith('/does-not-exist')) {
      problems.push(`HTTP ${r.status()}: ${u.pathname}`);
    }
  });
  page.on('requestfailed', (r) => {
    const failure = r.failure()?.errorText ?? '';
    // A navigation away aborts in-flight lazy images; that is not a fault.
    if (!/ABORTED|cancelled|NS_BINDING_ABORTED/i.test(failure)) problems.push(`failed: ${r.url()} ${failure}`);
  });
  return problems;
}

/** Report CSP violations as console errors, so watchProblems sees them. */
export async function reportCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
  });
}

/** Scroll the whole page in steps, so lazy pictures load, then return to the
 *  top. */
export async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 120));
    window.scrollTo(0, 0);
  });
}

/** Every <img> on the page has arrived and decoded. WebKit starts a lazy
 *  picture only while it is near the viewport and a quick scroll can leave
 *  one unrequested, so each poll brings the first missing one into view, as
 *  a reader stopping there would. */
export async function expectAllPicturesLoaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const missing = Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0);
          missing[0]?.scrollIntoView({ block: 'center' });
          return missing.map((img) => img.currentSrc || img.src);
        }),
      { timeout: 20_000, message: 'pictures that did not load' },
    )
    .toEqual([]);
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function describeViolations(violations: { impact?: string | null; id: string; help: string; nodes: { target: unknown[]; failureSummary?: string }[] }[]) {
  return violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n    ${v.nodes
        .slice(0, 4)
        .map((n) => `${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n    ')}`,
  );
}

/** axe-core, WCAG 2.2 A and AA, zero violations.
 *
 *  Then contrast once more, because axe skips it on this site: every text
 *  here sits on a CSS gradient (the page, every card), and axe reports text
 *  on a gradient as "incomplete" rather than judging it. That left the whole
 *  public page with no contrast check at all, and a 2.8:1 Login button
 *  passing. So each gradient is swapped for one of its own colour stops at a
 *  time (first, middle, last: the extremes of a linear gradient) and axe's
 *  color-contrast rule runs against each. */
export async function audit(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(describeViolations(result.violations), 'WCAG 2.2 AA violations').toEqual([]);

  const stops = await page.evaluate(() => {
    let most = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg.includes('linear-gradient')) continue;
      const colors = bg.match(/rgba?\([^)]*\)/g) ?? [];
      if (!colors.length) continue;
      el.dataset.a11yStops = JSON.stringify(colors);
      el.dataset.a11yStyle = el.getAttribute('style') ?? '';
      most = Math.max(most, colors.length);
    }
    return most;
  });
  try {
    for (let k = 0; k < stops; k++) {
      await page.evaluate((k) => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-a11y-stops]'))) {
          const colors = JSON.parse(el.dataset.a11yStops!) as string[];
          el.style.setProperty('background-image', 'none', 'important');
          el.style.setProperty('background-color', colors[Math.min(k, colors.length - 1)], 'important');
        }
      }, k);
      const flat = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(describeViolations(flat.violations), `contrast against gradient stop ${k + 1}`).toEqual([]);
    }
  } finally {
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-a11y-stops]'))) {
        el.setAttribute('style', el.dataset.a11yStyle ?? '');
        if (!el.getAttribute('style')) el.removeAttribute('style');
        delete el.dataset.a11yStops;
        delete el.dataset.a11yStyle;
      }
    });
  }
}
