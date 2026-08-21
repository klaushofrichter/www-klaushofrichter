import { describe, it, expect } from 'vitest';
import { links } from '../src/links';

describe('links', () => {
  it('includes an auth-gated status card', () => {
    const status = links.find((link) => link.id === 'status');

    expect(status).toBeDefined();
    expect(status?.requiresAuth).toBe(true);
    expect(status?.url).toBe('https://status.klaushofrichter.net');
  });

  it('does not mark the existing public cards as auth-gated', () => {
    const publicIds = ['linkedin', 'github', 'portfolio2017', 'instagram', 'threepuppies', 'medium', 'skylar'];

    for (const id of publicIds) {
      const link = links.find((l) => l.id === id);
      expect(link?.requiresAuth).toBeFalsy();
    }
  });

  it('marks the protected-area cards as auth-gated', () => {
    const protectedIds = ['headlamp', 'grafana', 'steps', 'ghpages', 'homeassistant'];

    for (const id of protectedIds) {
      const link = links.find((l) => l.id === id);
      expect(link).toBeDefined();
      expect(link?.requiresAuth).toBe(true);
    }
  });
});
