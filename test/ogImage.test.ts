import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchOgImage, downloadImage } from '../src/ogImage';

vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

import dns from 'dns';

const mockedLookup = vi.mocked(dns.promises.lookup);

// Default: hostnames resolve to a public IP, so existing tests that don't
// care about the SSRF guard keep working without hitting real DNS.
function stubPublicDns() {
  mockedLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as never);
}

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
    mockedLookup.mockReset();
  });

  it('writes the image to destPath and returns the content-type on success', async () => {
    stubPublicDns();
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

  it('accepts a content-type with a charset suffix, case-insensitively', async () => {
    stubPublicDns();
    const bytes = new TextEncoder().encode('fake-image-bytes').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'IMAGE/PNG; charset=binary' : null) },
        arrayBuffer: () => Promise.resolve(bytes),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-charset-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBe('image/png');
    fs.unlinkSync(destPath);
  });

  it('returns null on a non-2xx response and does not write a file', async () => {
    stubPublicDns();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const destPath = path.join(os.tmpdir(), `ogimage-test-missing-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('rejects a disallowed content-type (e.g. text/html) and does not write a file', async () => {
    stubPublicDns();
    const bytes = new TextEncoder().encode('<html><body>gotcha</body></html>').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        arrayBuffer: () => Promise.resolve(bytes),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-badtype-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('rejects http: URLs (SSRF guard, scheme check) without calling fetch', async () => {
    stubPublicDns();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const destPath = path.join(os.tmpdir(), `ogimage-test-http-${Date.now()}`);

    const contentType = await downloadImage('http://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('rejects a URL that resolves to a private/loopback IP (SSRF guard)', async () => {
    mockedLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const destPath = path.join(os.tmpdir(), `ogimage-test-ssrf-${Date.now()}`);

    const contentType = await downloadImage('https://internal.example/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('rejects a URL whose DNS lookup fails', async () => {
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const destPath = path.join(os.tmpdir(), `ogimage-test-dnsfail-${Date.now()}`);

    const contentType = await downloadImage('https://nope.example/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a download whose Content-Length exceeds the 5MB cap', async () => {
    stubPublicDns();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'content-type') return 'image/png';
            if (name === 'content-length') return String(6 * 1024 * 1024);
            return null;
          },
        },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-toobig-header-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('rejects a download whose actual body exceeds the 5MB cap even without Content-Length', async () => {
    stubPublicDns();
    const oversized = new ArrayBuffer(5 * 1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === 'content-type' ? 'image/png' : null) },
        arrayBuffer: () => Promise.resolve(oversized),
      })
    );
    const destPath = path.join(os.tmpdir(), `ogimage-test-toobig-body-${Date.now()}`);

    const contentType = await downloadImage('https://example.com/hero.png', destPath);

    expect(contentType).toBeNull();
    expect(fs.existsSync(destPath)).toBe(false);
  });
});
