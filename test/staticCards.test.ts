import { describe, it, expect } from 'vitest';
import { hasStaticCard, staticCardUrl } from '../src/staticCards';

describe('hasStaticCard', () => {
  it('returns true for an id with a real static card asset', () => {
    expect(hasStaticCard('github')).toBe(true);
  });

  it('returns false for an unknown id', () => {
    expect(hasStaticCard('not-a-real-link')).toBe(false);
  });
});

describe('staticCardUrl', () => {
  it('returns the /assets/cards/ URL for an id', () => {
    expect(staticCardUrl('github')).toBe('/assets/cards/github.png');
  });
});
