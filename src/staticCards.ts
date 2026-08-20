import fs from 'fs';
import path from 'path';

export const STATIC_CARDS_DIR = path.join(__dirname, '..', 'assets', 'cards');

export function hasStaticCard(id: string): boolean {
  return fs.existsSync(path.join(STATIC_CARDS_DIR, `${id}.png`));
}

export function staticCardUrl(id: string): string {
  return `/assets/cards/${id}.png`;
}
