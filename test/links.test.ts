import { describe, it, expect } from 'vitest';
import { links } from '../src/links';

describe('links', () => {
  it('includes a public status card', () => {
    const status = links.find((link) => link.id === 'status');

    expect(status).toBeDefined();
    // The UptimeRobot status page behind this URL has no login of its own,
    // so gating the card only hid a page anyone could already reach.
    expect(status?.requiresAuth).toBeFalsy();
    expect(status?.url).toBe('https://status.klaushofrichter.net');
  });

  it('does not mark the existing public cards as auth-gated', () => {
    const publicIds = ['linkedin', 'github', 'status', 'portfolio2017', 'instagram', 'threepuppies', 'medium', 'skylar', 'instagetter', 'art', 'blog', 'skylardog'];

    for (const id of publicIds) {
      const link = links.find((l) => l.id === id);
      expect(link?.requiresAuth).toBeFalsy();
    }
  });

  it('marks the protected-area cards as auth-gated', () => {
    const protectedIds = ['headlamp', 'grafana', 'steps', 'ghpages', 'homeassistant', 'slack', 'squarespace', 'uptimerobot', 'hostinger', 'cloudflare', 'aws', 'bulbs', 'swiftsensors', 'casavi'];

    for (const id of protectedIds) {
      const link = links.find((l) => l.id === id);
      expect(link).toBeDefined();
      expect(link?.requiresAuth).toBe(true);
    }
  });
});
