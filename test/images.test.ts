import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /images/:id', () => {
  it('returns 404 for an id with no downloaded image', async () => {
    const app = createApp();
    const response = await request(app).get('/images/linkedin');

    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const app = createApp();
    const response = await request(app).get('/images/not-a-real-link');

    expect(response.status).toBe(404);
  });

  it('returns 404 for an id containing path traversal characters', async () => {
    const app = createApp();
    const response = await request(app).get('/images/..%2F..%2Fetc%2Fpasswd');

    expect(response.status).toBe(404);
  });
});
