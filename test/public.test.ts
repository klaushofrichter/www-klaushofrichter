import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { listPublicFiles, formatSize } from '../src/publicFiles';

describe('listPublicFiles', () => {
  it('lists the files committed under public/', () => {
    const files = listPublicFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.name)).toContain('Waveshare+1.28+case.stl');
    for (const file of files) {
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it('sorts by name', () => {
    const names = listPublicFiles().map((file) => file.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('formatSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('GET /public', () => {
  it('renders a listing that links every file', async () => {
    const response = await request(createApp()).get('/public');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    for (const file of listPublicFiles()) {
      expect(response.text).toContain(`/public/${encodeURIComponent(file.name)}`);
    }
  });

  it('escapes the filename in the link so a URL-special character cannot break out', async () => {
    const response = await request(createApp()).get('/public');

    // '+' is legal in a path but means something else in a query string, so
    // the href must carry it encoded rather than raw.
    expect(response.text).toContain('Waveshare%2B1.28%2Bcase.stl');
  });

  it('serves the same listing for the trailing-slash form', async () => {
    const response = await request(createApp()).get('/public/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Public files');
  });
});

describe('GET /public/:file', () => {
  it('downloads a file that exists', async () => {
    const [file] = listPublicFiles();

    const response = await request(createApp()).get(`/public/${encodeURIComponent(file!.name)}`);

    expect(response.status).toBe(200);
    expect(Number(response.headers['content-length'])).toBe(file!.size);
  });

  it('404s an unknown file', async () => {
    const response = await request(createApp()).get('/public/not-a-real-file.txt');

    expect(response.status).toBe(404);
  });

  it('does not serve a file outside the public folder', async () => {
    const response = await request(createApp()).get('/public/../package.json');

    expect(response.status).not.toBe(200);
  });
});
