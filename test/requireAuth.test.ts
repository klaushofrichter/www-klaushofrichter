import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { currentUser, requireAuthApi, requireAuthPage } from '../src/requireAuth';
import { sessionCookie } from './helpers';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/page', requireAuthPage, (_req, res) => {
    res.send('secret page');
  });
  app.get('/api', requireAuthApi, (_req, res) => {
    res.json({ ok: true });
  });
  app.post('/api', requireAuthApi, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/who', (req, res) => {
    res.json({ user: currentUser(req) });
  });
  return app;
}

describe('requireAuthPage', () => {
  it('redirects to / without a session cookie', async () => {
    const response = await request(makeApp()).get('/page');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.text).not.toContain('secret page');
  });

  it('redirects to / with a garbage session cookie', async () => {
    const response = await request(makeApp()).get('/page').set('Cookie', 'session=not-a-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('serves the page for a valid, allow-listed session', async () => {
    const response = await request(makeApp()).get('/page').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
    expect(response.text).toBe('secret page');
  });
});

describe('requireAuthApi', () => {
  it('answers 401 JSON without a session cookie', async () => {
    const response = await request(makeApp()).get('/api');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('passes a valid, allow-listed session through', async () => {
    const response = await request(makeApp()).get('/api').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

describe('requireAuthApi on state-changing requests', () => {
  it('accepts a same-origin POST', async () => {
    const response = await request(makeApp())
      .post('/api')
      .set('Cookie', sessionCookie())
      .set('Sec-Fetch-Site', 'same-origin');

    expect(response.status).toBe(200);
  });

  it('accepts a POST without Sec-Fetch-Site, which no cross-site page can send', async () => {
    const response = await request(makeApp()).post('/api').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
  });

  // same-site is the case SameSite=Lax lets through: a sibling subdomain.
  it.each(['same-site', 'cross-site', 'none'])('refuses a %s POST even with a valid session', async (site) => {
    const response = await request(makeApp())
      .post('/api')
      .set('Cookie', sessionCookie())
      .set('Sec-Fetch-Site', site);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'cross-origin' });
  });

  it('leaves GET alone whatever Sec-Fetch-Site says', async () => {
    const response = await request(makeApp())
      .get('/api')
      .set('Cookie', sessionCookie())
      .set('Sec-Fetch-Site', 'cross-site');

    expect(response.status).toBe(200);
  });
});

describe('currentUser', () => {
  const originalAllowList = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    process.env.ALLOWED_EMAILS = originalAllowList;
  });

  it('returns the session for an allow-listed email', async () => {
    const response = await request(makeApp()).get('/who').set('Cookie', sessionCookie());

    expect(response.body.user).toEqual({ email: 'allowed@example.com' });
  });

  it('rejects a correctly signed session whose email was removed from the allow list', async () => {
    const cookie = sessionCookie();
    process.env.ALLOWED_EMAILS = 'someone-else@example.com';

    const response = await request(makeApp()).get('/who').set('Cookie', cookie);

    expect(response.body.user).toBeNull();
  });
});
