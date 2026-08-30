import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/refreshImages', () => ({
  refreshAllImages: vi.fn().mockResolvedValue(undefined),
  scheduleDailyRefresh: vi.fn(),
  hasImage: vi.fn().mockReturnValue(false),
  imagePath: vi.fn((id: string) => `/tmp/${id}`),
  getImageContentType: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../src/staticCards', () => ({
  hasStaticCard: vi.fn().mockReturnValue(false),
  staticCardUrl: vi.fn((id: string) => `/assets/cards/${id}.webp`),
}));

import { refreshAllImages } from '../src/refreshImages';
import { createApp } from '../src/app';
import { signSession } from '../src/session';

const mockedRefreshAllImages = vi.mocked(refreshAllImages);

describe('GET /', () => {
  it('renders the about section, all 7 card titles, and the footer', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Klaus Hofrichter');
    expect(response.text).toContain('LinkedIn');
    expect(response.text).toContain('GitHub');
    expect(response.text).toContain('Portfolio 2017');
    expect(response.text).toContain('Instagram');
    expect(response.text).toContain('Three Puppies');
    expect(response.text).toContain('Medium');
    expect(response.text).toContain('Skylar Technology');
    expect(response.text).toContain('Contact: klaus@klaushofrichter.net');
    expect(response.text).toContain('og:image');
    expect(response.text).toContain('og:title');
    expect(response.text).toContain('apple-touch-icon');
    expect(response.text).toContain('favicon-32x32.png');
  });

  it('does not render the status card or a Logout link with no session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.text).not.toContain('>Status<');
    expect(response.text).toContain('href="/auth/google/login">Login</a>');
  });

  it('renders the status card and a Logout link with a valid session cookie', async () => {
    const app = createApp();
    const token = signSession('allowed@example.com');
    const response = await request(app).get('/').set('Cookie', `session=${token}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('>Status<');
    expect(response.text).toContain('href="/auth/logout">Logout</a>');
  });

  it('renders logged out when the session cookie is garbage', async () => {
    const app = createApp();
    const response = await request(app).get('/').set('Cookie', 'session=not-a-real-token');

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('>Status<');
  });
});

describe('POST /refresh', () => {
  beforeEach(() => {
    mockedRefreshAllImages.mockClear();
  });

  it('triggers a refresh and returns 200 on the first call', async () => {
    const app = createApp();
    const response = await request(app).post('/refresh');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(mockedRefreshAllImages).toHaveBeenCalledTimes(1);
  });

  it('returns 429 and does not refresh again within the cooldown', async () => {
    const app = createApp();
    await request(app).post('/refresh');
    mockedRefreshAllImages.mockClear();

    const response = await request(app).post('/refresh');

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'cooldown' });
    expect(mockedRefreshAllImages).not.toHaveBeenCalled();
  });
});
