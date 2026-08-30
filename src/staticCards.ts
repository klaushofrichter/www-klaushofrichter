import fs from 'fs';
import path from 'path';

export const STATIC_CARDS_DIR = path.join(__dirname, '..', 'assets', 'cards');

// WebP, not PNG: the hand-curated screenshots are 1200x630 sources rendered
// into a 110px-tall slot, and shipping them as PNG made the page 4.4MB and
// held mobile LCP at 3.6s. See docs in README ("Card images").
export function hasStaticCard(id: string): boolean {
  return fs.existsSync(path.join(STATIC_CARDS_DIR, `${id}.webp`));
}

export function staticCardUrl(id: string): string {
  return `/assets/cards/${id}.webp`;
}
