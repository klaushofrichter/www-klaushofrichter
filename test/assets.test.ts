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
