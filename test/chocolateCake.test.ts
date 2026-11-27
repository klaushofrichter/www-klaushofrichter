import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

// The public mini-site at /chocolate-cake (sites/chocolate-cake), built like
// /chili. Its QR code points at https://klaushofrichter.net/chocolate-cake,
// which Squarespace forwards to https://www.klaushofrichter.net/chocolate-cake,
// so both forms must reach the page.
describe('the /chocolate-cake mini-site', () => {
  it('serves its page at /chocolate-cake/ without signing in', async () => {
    const response = await request(createApp()).get('/chocolate-cake/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('<html lang="en">');
    expect(response.text).toContain('Chocolate <span class="cherry">Cherry</span> Cake');
    // Klaus asked for the "adapted recipe" note to be removed (2026-11-27).
    expect(response.text).not.toContain('adapted recipe');
  });

  // Quantities are Klaus's recipe as given; a typo here bakes a different cake.
  it('lists the recipe quantities exactly', async () => {
    const page = (await request(createApp()).get('/chocolate-cake/')).text;

    for (const text of [
      'fine blanched almond flour <span class="g">(100 g)</span>',
      'unsweetened cocoa powder <span class="g">(22 g)</span>',
      'semisweet or dark chocolate chips <span class="g">(170 g)</span>',
      'unsalted butter <span class="g">(113 g)</span>',
      'coconut sugar or monkfruit sweetener <span class="g">(90 g)</span>',
      '<span class="frac">1/3</span> cup</span><span>plain Greek yogurt <span class="g">(80 g)</span>',
      'semisweet or dark chocolate chips <span class="g">(128 g)</span>',
      'heavy whipping cream <span class="g">(120 ml)</span>',
      '350°F (175°C)',
      'Bake on the middle rack for 30–40 minutes.',
      'Start checking at 28 minutes.',
    ]) {
      expect(page, text).toContain(text);
    }
  });

  // Covers every srcset entry, the preload and the og:image (a JPEG), not only <img src>.
  it('serves the images the page references', async () => {
    const app = createApp();
    const page = await request(app).get('/chocolate-cake/');
    const images = [...new Set(page.text.match(/img\/[a-z0-9-]+\.(?:jpg|webp)/g) ?? [])];

    expect(images.length).toBeGreaterThan(10);
    for (const image of images) {
      const response = await request(app).get(`/chocolate-cake/${image}`);
      expect(response.status, image).toBe(200);
      expect(response.headers['content-type'], image).toMatch(/image\/(jpeg|webp)/);
    }
  });

  // The fonts are self-hosted (the @font-face rules and the preload), so a
  // missing file would silently fall back to system fonts.
  it('serves the fonts the page references, from its own folder', async () => {
    const app = createApp();
    const page = await request(app).get('/chocolate-cake/');
    const fonts = [...new Set(page.text.match(/fonts\/[a-z0-9-]+\.woff2/g) ?? [])];

    expect(fonts.length).toBe(3);
    expect(page.text).not.toContain('fonts.googleapis.com');
    for (const font of fonts) {
      const response = await request(app).get(`/chocolate-cake/${font}`);
      expect(response.status, font).toBe(200);
      expect(response.headers['content-type'], font).toMatch(/font\/woff2/);
    }
  });

  it('serves its QR code', async () => {
    const app = createApp();
    for (const [file, type] of [
      ['chocolate-cake-qr.png', /image\/png/],
      ['chocolate-cake-qr.svg', /image\/svg\+xml/],
    ] as const) {
      const response = await request(app).get(`/chocolate-cake/${file}`);
      expect(response.status, file).toBe(200);
      expect(response.headers['content-type'], file).toMatch(type);
    }
  });

  it('redirects /chocolate-cake (the QR code address) to /chocolate-cake/', async () => {
    const response = await request(createApp()).get('/chocolate-cake');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/chocolate-cake/');
  });

  it('keeps a request outside the folder out', async () => {
    const response = await request(createApp()).get('/chocolate-cake/..%2F..%2Fpackage.json');

    expect(response.status).toBe(404);
  });
});
