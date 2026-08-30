import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../src/refreshImages', () => ({
  hasImage: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/staticCards', () => ({
  hasStaticCard: vi.fn().mockReturnValue(false),
  staticCardUrl: vi.fn((id: string) => `/assets/cards/${id}.webp`),
}));

import { hasImage } from '../src/refreshImages';
import { hasStaticCard } from '../src/staticCards';
import { renderPage } from '../src/views/page';

const mockedHasImage = vi.mocked(hasImage);
const mockedHasStaticCard = vi.mocked(hasStaticCard);

describe('renderPage card images', () => {
  beforeEach(() => {
    mockedHasImage.mockReset();
    mockedHasImage.mockReturnValue(false);
    mockedHasStaticCard.mockReset();
    mockedHasStaticCard.mockReturnValue(false);
  });

  it('uses the static card asset when one exists, in preference to a dynamic image', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');
    mockedHasImage.mockReturnValue(true);

    const html = renderPage(false);

    expect(html).toContain('src="/assets/cards/linkedin.webp"');
  });

  it('falls back to the dynamic /images/:id route when no static card exists', () => {
    mockedHasStaticCard.mockReturnValue(false);
    mockedHasImage.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage(false);

    expect(html).toContain('src="/images/linkedin"');
  });

  it('wraps the card image area in a link to the card URL', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage(false);

    expect(html).toContain(
      '<a class="card-image" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);" href="https://www.linkedin.com/in/klaushofrichter" target="_blank" rel="noopener noreferrer">'
    );
  });

  it('applies the card\'s cardColor as the whole card background', () => {
    const html = renderPage(false);

    expect(html).toContain(
      '<div class="card" style="background: linear-gradient(160deg, #1e2a4a, #2d1b4e);">'
    );
  });
});

describe('renderPage auth-gated cards and login button', () => {
  it('hides auth-gated cards and shows a Login link when logged out', () => {
    const html = renderPage(false);

    expect(html).not.toContain('>Status<');
    expect(html).toContain('id="auth-button" href="/auth/google/login">Login</a>');
    expect(html).not.toContain('href="/auth/logout"');
  });

  it('shows auth-gated cards and a Logout link when logged in', () => {
    const html = renderPage(true);

    expect(html).toContain('>Status<');
    expect(html).toContain('id="auth-button" href="/auth/logout">Logout</a>');
    expect(html).not.toContain('href="/auth/google/login"');
  });
});

describe('renderPage version label', () => {
  it('shows "dev" as the version when nothing is stamped in', () => {
    expect(renderPage(false)).toContain('<span id="app-version" title="Deployed build">dev</span>');
  });

  it('shows the stamped build version left of the auth button', () => {
    vi.stubEnv('APP_VERSION', '2026.08.26.1');

    const html = renderPage(false);

    expect(html).toContain('<span id="app-version" title="Deployed build">2026.08.26.1</span>');
    expect(html.indexOf('id="app-version"')).toBeLessThan(html.indexOf('id="auth-button"'));
    vi.unstubAllEnvs();
  });
});

describe('renderPage social preview tags', () => {
  const html = renderPage(false);

  it('emits the Open Graph tags a scraper needs', () => {
    expect(html).toContain('<meta property="og:site_name" content="Klaus Hofrichter" />');
    expect(html).toContain('<meta property="og:title" content="Klaus Hofrichter" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://www.klaushofrichter.net/assets/og-image.png" />'
    );
    expect(html).toContain('<meta property="og:image:type" content="image/png" />');
    expect(html).toContain('<meta property="og:url" content="https://www.klaushofrichter.net/" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toMatch(/<meta property="og:description" content="[^"]+" \/>/);
    expect(html).toMatch(/<meta property="og:image:alt" content="[^"]+" \/>/);
  });

  it('asks X for the large card rather than the default thumbnail', () => {
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta name="twitter:image" content="https://www.klaushofrichter.net/assets/og-image.png" />'
    );
    expect(html).toMatch(/<meta name="twitter:title" content="[^"]+" \/>/);
    expect(html).toMatch(/<meta name="twitter:description" content="[^"]+" \/>/);
  });

  it('declares dimensions that match the actual og-image asset', () => {
    // A stale width/height makes a scraper reserve the wrong space, and the
    // failure is invisible until someone shares a link - so pin it to the file.
    const png = fs.readFileSync(path.join(process.cwd(), 'assets', 'og-image.png'));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);

    expect(html).toContain(`<meta property="og:image:width" content="${width}" />`);
    expect(html).toContain(`<meta property="og:image:height" content="${height}" />`);
  });
});
