import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with a status ok body and the build version', async () => {
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'www-klaushofrichter',
      version: 'dev',
    });
  });

  it('reports the version stamped into the image', async () => {
    vi.stubEnv('APP_VERSION', '2026.08.26.1');

    const response = await request(createApp()).get('/health');

    expect(response.body.version).toBe('2026.08.26.1');
    vi.unstubAllEnvs();
  });
});
