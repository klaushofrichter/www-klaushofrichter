import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /', () => {
  it('serves the static index page', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Hello from www-klaushofrichter');
  });

  it('returns 404 for an unknown path', async () => {
    const app = createApp();
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
  });
});
