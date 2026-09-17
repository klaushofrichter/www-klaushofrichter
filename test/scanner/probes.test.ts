import { describe, it, expect, vi } from 'vitest';
import { extractTitle, PORTS, probeDevices } from '../../scanner/src/probes';
import { Device } from '../../src/survey/types';

function device(ip: string): Device {
  return {
    ip, mac: 'aa:bb:cc:dd:ee:01', vendor: null, privateMac: false, name: null, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

describe('PORTS', () => {
  it('covers the ports the design names, and no others', () => {
    expect(PORTS.map((p) => p.port)).toEqual(
      [22, 53, 80, 443, 445, 554, 631, 1883, 5000, 5001, 8008, 8009, 8080, 8123, 8443, 9100],
    );
  });

  it('marks the web ports', () => {
    const web = PORTS.filter((p) => p.web).map((p) => p.port);

    expect(web).toContain(80);
    expect(web).toContain(8123);
    expect(web).not.toContain(22);
  });
});

describe('extractTitle', () => {
  it('reads the title element', () => {
    expect(extractTitle('<html><head><title>Home Assistant</title></head></html>')).toBe('Home Assistant');
  });

  it('handles attributes, newlines and entities', () => {
    expect(extractTitle('<title lang="en">\n  Brother &amp; Sons\n</title>')).toBe('Brother & Sons');
  });

  it('returns null when there is no title', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull();
    expect(extractTitle('')).toBeNull();
  });

  it('caps an absurd title', () => {
    expect(extractTitle(`<title>${'x'.repeat(500)}</title>`)?.length).toBe(120);
  });
});

describe('probeDevices', () => {
  it('records open ports and the web page behind them', async () => {
    const connect = vi.fn(async (ip: string, port: number) => ip === '192.168.1.50' && (port === 22 || port === 8123));
    const get = vi.fn(async () => ({ url: 'http://192.168.1.50:8123', title: 'Home Assistant' }));

    const [probed] = await probeDevices([device('192.168.1.50')], { connect, get, timeoutMs: 10 });

    expect(probed.ports.map((p) => p.port)).toEqual([22, 8123]);
    expect(probed.ports[0]).toEqual({ port: 22, service: 'SSH', web: null });
    expect(probed.web).toEqual({ url: 'http://192.168.1.50:8123', title: 'Home Assistant' });
  });

  it('leaves a silent device with nothing rather than guessing', async () => {
    const [probed] = await probeDevices([device('192.168.1.120')], {
      connect: async () => false,
      get: async () => null,
      timeoutMs: 10,
    });

    expect(probed.ports).toEqual([]);
    expect(probed.web).toBeNull();
  });

  it('does not let one unreachable device fail the others', async () => {
    const connect = vi.fn(async (ip: string) => {
      if (ip === '192.168.1.9') throw new Error('EHOSTUNREACH');
      return true;
    });

    const probed = await probeDevices([device('192.168.1.9'), device('192.168.1.10')], {
      connect, get: async () => null, timeoutMs: 10,
    });

    expect(probed[0].ports).toEqual([]);
    expect(probed[1].ports.length).toBe(PORTS.length);
  });
});
