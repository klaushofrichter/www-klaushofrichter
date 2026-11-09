import { describe, it, expect } from 'vitest';
import { hasStaticCard, staticCardSize, staticCardUrl, webpSize } from '../src/staticCards';

describe('hasStaticCard', () => {
  it('returns true for an id with a real static card asset', () => {
    expect(hasStaticCard('github')).toBe(true);
  });

  it('returns false for an unknown id', () => {
    expect(hasStaticCard('not-a-real-link')).toBe(false);
  });

  it('returns true for the instagetter card', () => {
    expect(hasStaticCard('instagetter')).toBe(true);
  });

  it('returns true for the art gallery card', () => {
    expect(hasStaticCard('art')).toBe(true);
  });

  it('returns true for the blog card', () => {
    expect(hasStaticCard('blog')).toBe(true);
  });

  it('returns true for the Skylar the Doberman card', () => {
    expect(hasStaticCard('skylardog')).toBe(true);
  });

  it('returns true for the status card once its asset exists', () => {
    expect(hasStaticCard('status')).toBe(true);
  });

  it('returns true for each protected-area card once its asset exists', () => {
    for (const id of ['headlamp', 'grafana', 'steps', 'ghpages', 'homeassistant', 'slack', 'squarespace', 'uptimerobot', 'hostinger', 'cloudflare', 'aws', 'bulbs', 'swiftsensors', 'casavi', 'trmnl']) {
      expect(hasStaticCard(id)).toBe(true);
    }
  });
});

describe('staticCardUrl', () => {
  it('returns the /assets/cards/ URL for an id', () => {
    expect(staticCardUrl('github')).toBe('/assets/cards/github.webp');
  });
});

describe('staticCardSize', () => {
  it('reads every committed card\'s size from its WebP header', () => {
    for (const id of ['github', 'tailscale', 'linkedin', 'art']) {
      const size = staticCardSize(id);
      expect(size?.width).toBe(800);
      expect(size?.height).toBeGreaterThan(300);
    }
  });

  it('returns null for a card that does not exist', () => {
    expect(staticCardSize('not-a-real-link')).toBeNull();
  });
});

describe('webpSize', () => {
  const riff = (chunk: string, body: number[]) => {
    const buf = Buffer.alloc(32);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    buf.write(chunk, 12, 'ascii');
    Buffer.from(body).copy(buf, 20);
    return buf;
  };

  it('reads a lossy (VP8) header', () => {
    // frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height
    expect(webpSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x20, 0x03, 0xa4, 0x01]))).toEqual({ width: 800, height: 420 });
  });

  it('reads a lossless (VP8L) header', () => {
    // signature 0x2f, then (width-1) in 14 bits and (height-1) in the next 14
    const bits = (800 - 1) | ((420 - 1) << 14);
    expect(webpSize(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]))).toEqual({ width: 800, height: 420 });
  });

  it('reads an extended (VP8X) header', () => {
    // flags (4 bytes), then (width-1) and (height-1) in 24 bits each
    expect(webpSize(riff('VP8X', [0, 0, 0, 0, 0x1f, 0x03, 0x00, 0xa3, 0x01, 0x00]))).toEqual({ width: 800, height: 420 });
  });

  it('returns null for something that is not a WebP', () => {
    expect(webpSize(Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(40), 'latin1'))).toBeNull();
  });
});
