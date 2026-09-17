import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signSession } from '../src/session';
import { currentUser, requireAuthApi, requireAuthPage } from '../src/requireAuth';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/page', requireAuthPage, (_req, res) => {
    res.send('secret page');
  });
  app.get('/api', requireAuthApi, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/who', (req, res) => {
    res.json({ user: currentUser(req) });
  });
  return app;
}

function allowedCookie(): string {
  return `session=${signSession('allowed@example.com')}`;
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
    const response = await request(makeApp()).get('/page').set('Cookie', allowedCookie());

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
    const response = await request(makeApp()).get('/api').set('Cookie', allowedCookie());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

describe('currentUser', () => {
  const originalAllowList = process.env.ALLOWED_EMAILS;

  afterEach(() => {
    process.env.ALLOWED_EMAILS = originalAllowList;
  });

  it('returns the session for an allow-listed email', async () => {
    const response = await request(makeApp()).get('/who').set('Cookie', allowedCookie());

    expect(response.body.user).toEqual({ email: 'allowed@example.com' });
  });

  it('rejects a correctly signed session whose email was removed from the allow list', async () => {
    const cookie = allowedCookie();
    process.env.ALLOWED_EMAILS = 'someone-else@example.com';

    const response = await request(makeApp()).get('/who').set('Cookie', cookie);

    expect(response.body.user).toBeNull();
  });
});
