import { test, expect } from '@playwright/test';
import { sessionCookie } from './session';

test.describe('signed out', () => {
  test('the homepage has no Dashboard button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#dashboard-button')).toHaveCount(0);
  });

  test('dashboard pages send you back to the cards', async ({ page }) => {
    await page.goto('/dashboard/ip-survey');
    await expect(page).toHaveURL(/\/$/);
  });

  test('the survey API refuses requests', async ({ request }) => {
    expect((await request.get('/api/survey')).status()).toBe(401);
    expect((await request.post('/api/survey/scan')).status()).toBe(401);
    expect((await request.post('/api/survey/save')).status()).toBe(401);
  });
});

test.describe('signed in', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(baseURL!)]);
  });

  test('Dashboard sits left of Logout and leads to the survey and back', async ({ page }) => {
    await page.goto('/');
    const dashboard = page.locator('#dashboard-button');
    const logout = page.locator('#auth-button');
    await expect(dashboard).toBeVisible();
    await expect(logout).toHaveText('Logout');
    expect((await dashboard.boundingBox())!.x).toBeLessThan((await logout.boundingBox())!.x);

    await dashboard.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('link', { name: /IP Survey/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/ip-survey$/);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Cards' }).click();
    await expect(page.locator('h1')).toHaveText('Klaus Hofrichter');
  });
});

test.describe('IP survey against the fake scanner', () => {
  test.describe.configure({ mode: 'serial' });

  // Playwright's `request` fixture is test-scoped and unavailable inside
  // beforeAll, so the reset uses plain fetch instead of the request fixture
  // the fake scanner would otherwise be driven with.
  test.beforeAll(async () => {
    const scannerUrl = process.env.SCANNER_URL;
    const token = process.env.SCANNER_TOKEN;
    if (!scannerUrl || !token) {
      throw new Error('SCANNER_URL and SCANNER_TOKEN must point at e2e/fakeScanner.ts');
    }
    const reset = await fetch(`${scannerUrl}/__fake/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (reset.status !== 200) {
      throw new Error(`fake scanner reset failed: HTTP ${reset.status}`);
    }
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(baseURL!)]);
  });

  test('scan, sort, inspect, save, then see what changed', async ({ page }) => {
    const rows = page.locator('#survey-rows tr');
    const statusLine = page.locator('#survey-status-line');

    await page.goto('/dashboard/ip-survey');

    // Scan 1 (fixture A)
    await page.locator('#scan-button').click();
    await expect(statusLine).toContainText('Unsaved scan', { timeout: 15_000 });
    await expect(rows).toHaveCount(6);

    // IPs sort numerically: .9 before .10
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('192.168.1.1');
    await expect(rows.nth(1).locator('td').nth(1)).toHaveText('192.168.1.9');
    await expect(rows.nth(2).locator('td').nth(1)).toHaveText('192.168.1.10');
    await page.locator('th[data-sort-key="ipNum"] button').click();
    await expect(page.locator('th[data-sort-key="ipNum"]')).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('192.168.1.120');

    // Device-supplied names render as text, never as markup
    await expect(page.locator('#survey-rows').getByText('Lab <b>bench</b>')).toBeVisible();
    await expect(page.locator('#survey-rows b')).toHaveCount(0);

    // Randomized MAC is labelled, web devices are links
    await expect(page.locator('#survey-rows')).toContainText('Private address');
    await expect(page.locator('#survey-rows a[href="http://192.168.1.50:8123"]')).toHaveText('homeassistant.local');

    // Details dialog
    await rows.filter({ hasText: 'homeassistant.local' }).getByRole('button', { name: '2 ports' }).click();
    const dialog = page.locator('#details-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('8123');
    await expect(dialog.locator('a[href="http://192.168.1.50:8123"]')).toHaveText('Home Assistant');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Save, and it survives a reload
    await page.locator('#save-button').click();
    await expect(statusLine).toContainText('Saved survey');
    await expect(page.locator('#save-button')).toBeDisabled();
    await page.reload();
    await expect(statusLine).toContainText('Saved survey');
    await expect(rows).toHaveCount(6);

    // Scan 2 (fixture B): printer gone, Chromecast new
    await page.locator('#scan-button').click();
    await expect(statusLine).toContainText('1 new', { timeout: 15_000 });
    await expect(statusLine).toContainText('1 gone');
    await expect(page.locator('#survey-rows .badge-new')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Living Room TV' }).locator('.badge-new')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Brother HL-L2350DW' })).toHaveClass(/gone/);
    await expect(page.locator('#save-button')).toBeEnabled();
  });

  // Reviewer follow-up from Task 8: a scan in progress that loses its session
  // should bounce the page home rather than sit there showing a transport
  // error, since /api/survey now answers 401 instead of 200.
  test('losing the session mid-poll sends the page home, not an error', async ({ page, context }) => {
    await page.goto('/dashboard/ip-survey');
    await page.locator('#scan-button').click();
    // Let the scan start (so the page schedules its next poll), then pull
    // the session out from under it. The next poll gets a 401 and the page's
    // own redirect-on-401 handling should take it home, not show an error.
    await page.waitForTimeout(300);
    await context.clearCookies();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  });
});
