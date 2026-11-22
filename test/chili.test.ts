import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

// The public mini-site at /chili (sites/chili). Its QR code points at
// https://klaushofrichter.net/chili, which Squarespace forwards to
// https://www.klaushofrichter.net/chili, so both forms must reach the page.
describe('the /chili mini-site', () => {
  it('serves its page at /chili/ without signing in', async () => {
    const response = await request(createApp()).get('/chili/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('<h1>Chili<span class="con">con');
    expect(response.text).toContain('<html lang="en">');
  });

  // Covers the CSS background (border.webp), every srcset entry and the
  // og:image (chili.jpg), not only <img src>.
  it('serves the images the page references', async () => {
    const app = createApp();
    const page = await request(app).get('/chili/');
    const images = [...new Set(page.text.match(/img\/[a-z0-9-]+\.(?:jpg|webp)/g) ?? [])];

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      const response = await request(app).get(`/chili/${image}`);
      expect(response.status, image).toBe(200);
      expect(response.headers['content-type'], image).toMatch(/image\/(jpeg|webp)/);
    }
  });

  it('redirects /chili (the QR code address) to /chili/', async () => {
    const response = await request(createApp()).get('/chili');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/chili/');
  });

  it('keeps a request outside the folder out', async () => {
    const response = await request(createApp()).get('/chili/..%2F..%2Fpackage.json');

    expect(response.status).toBe(404);
  });
});
