import fs from 'fs';
import path from 'path';

const STATIC_CARDS_DIR = path.join(__dirname, '..', 'assets', 'cards');

// WebP, not PNG: the hand-curated screenshots are 1200x630 sources rendered
// into a 110px-tall slot, and shipping them as PNG made the page 4.4MB and
// held mobile LCP at 3.6s. See docs in README ("Card images").
export function hasStaticCard(id: string): boolean {
  return fs.existsSync(path.join(STATIC_CARDS_DIR, `${id}.webp`));
}

export function staticCardUrl(id: string): string {
  return `/assets/cards/${id}.webp`;
}

export interface Size {
  width: number;
  height: number;
}

/** Width and height of a WebP, read from its header (all three encodings:
 *  lossy VP8, lossless VP8L, extended VP8X). Null for anything else. */
export function webpSize(buf: Buffer): Size | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

const sizes = new Map<string, Size | null>();

/** The card picture's own size, for the img's width and height attributes:
 *  they give the browser the aspect ratio before the file arrives, so a lazy
 *  picture holds its place in every engine. Read once per card. */
export function staticCardSize(id: string): Size | null {
  if (!sizes.has(id)) {
    let size: Size | null = null;
    try {
      const fd = fs.openSync(path.join(STATIC_CARDS_DIR, `${id}.webp`), 'r');
      try {
        const head = Buffer.alloc(32);
        fs.readSync(fd, head, 0, 32, 0);
        size = webpSize(head);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      size = null;
    }
    sizes.set(id, size);
  }
  return sizes.get(id) ?? null;
}
