import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getTokenMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    getToken: getTokenMock,
    verifyIdToken: verifyIdTokenMock,
  })),
}));

import { createApp } from '../src/app';

describe('GET /auth/google/login', () => {
  it('redirects to the Google OAuth consent screen', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/google/login');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(response.headers.location).toContain('client_id=test-client-id');
    expect(response.headers.location).toContain('scope=openid+email');
  });
});

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('redirects to /?auth_error=1 with no code', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/google/callback');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('redirects to /?auth_error=1 when the token exchange fails', async () => {
    getTokenMock.mockRejectedValue(new Error('exchange failed'));

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sets a session cookie and redirects to / for an allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']?.[0]).toContain('session=');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
  });

  it('redirects to /?auth_error=1 with no cookie for a non-allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'stranger@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('redirects to /?auth_error=1 when the email is unverified, even if allowlisted', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: false }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=1');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('GET /auth/google/callback rate limiting', () => {
  it('rate-limits repeated requests', async () => {
    const app = createApp();
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).get('/auth/google/callback');
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('GET /auth/logout', () => {
  it('clears the session cookie and redirects to /', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    const setCookieHeader = response.headers['set-cookie']?.[0];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('session=;');
  });

  it('redirects to / and clears the cookie even with no existing session', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });
});
