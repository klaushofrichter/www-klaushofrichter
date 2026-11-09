import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /assets', () => {
  it('serves the og:image asset', async () => {
    const app = createApp();
    const response = await request(app).get('/assets/og-image.png');

    expect(response.status).toBe(200);
  });
});

describe('an unknown address', () => {
  it('is a 404 page in the site\'s style with a way home', async () => {
    const response = await request(createApp()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('<h1>Page not found</h1>');
    expect(response.text).toContain('<a href="/">');
  });
});

describe('compression', () => {
  it('sends the home page gzipped to a client that accepts it', async () => {
    const response = await request(createApp()).get('/').set('Accept-Encoding', 'gzip');

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('serves the avatar as a small WebP', async () => {
    const response = await request(createApp()).get('/assets/avatar.webp');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.body.length).toBeLessThan(5_000);
  });
});
