import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchOgImage, downloadImage } from '../src/ogImage';

describe('fetchOgImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the og:image URL when the tag is present', async () => {
    const html = '<html><head><meta property="og:image" content="https://example.com/hero.jpg" /></head></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) })
    );

    const result = await fetchOgImage('https://example.com');

    expect(result).toBe('https://example.com/hero.jpg');
  });

  it('returns null when there is no og:image tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('<html><head></head></html>') })
    );

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }));

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await fetchOgImage('https://example.com');

    expect(result).toBeNull();
  });
});

describe('downloadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the image to destPath and returns the content-type on success', async () => {
    const bytes = new TextEncoder().encode('fake-image-bytes').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/png' : null) },
        arrayBuffer: () => Promise.resolve(bytes),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBe('image/png');
    expect(fs.readFileSync(destPath, 'utf8')).toBe('fake-image-bytes');
    fs.unlinkSync(destPath);
  });

  it('returns null on a non-2xx response and does not write a file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const destPath = path.join(os.tmpdir(), `ogimage-test-missing-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });
});
