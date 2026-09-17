import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';

function cookie(): string {
  return `session=${signSession('allowed@example.com')}`;
}

describe('GET /dashboard', () => {
  it('redirects a signed-out visitor to the cards', async () => {
    const response = await request(createApp()).get('/dashboard');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('renders the dashboard for a signed-in user', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1>Dashboard</h1>');
    expect(response.text).toContain('href="/dashboard/ip-survey"');
    expect(response.text).toContain('<a href="/">← Cards</a>');
  });

  it('keeps the signed-in header but drops the image refresh button', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.text).toContain('id="dashboard-button"');
    expect(response.text).toContain('<a id="auth-button" href="/auth/logout">Logout</a>');
    expect(response.text).toContain('id="app-version"');
    expect(response.text).not.toContain('id="refresh-button"');
  });

  it('asks search engines not to index it', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.text).toContain('<meta name="robots" content="noindex" />');
  });

  it('is not cacheable, so it cannot linger in the browser after logout', async () => {
    const response = await request(createApp()).get('/dashboard').set('Cookie', cookie());

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
