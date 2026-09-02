import { describe, it, expect } from 'vitest';
import { hasStaticCard, staticCardUrl } from '../src/staticCards';

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
    for (const id of ['headlamp', 'grafana', 'steps', 'ghpages', 'homeassistant', 'slack', 'squarespace', 'uptimerobot', 'hostinger', 'cloudflare', 'aws', 'bulbs']) {
      expect(hasStaticCard(id)).toBe(true);
    }
  });
});

describe('staticCardUrl', () => {
  it('returns the /assets/cards/ URL for an id', () => {
    expect(staticCardUrl('github')).toBe('/assets/cards/github.webp');
  });
});
