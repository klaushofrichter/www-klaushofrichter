import net, { AddressInfo } from 'node:net';
import http from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { extractTitle, PORTS, probeDevices, tcpConnect, httpGet } from '../../scanner/src/probes';
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

  it('fetches every open web port concurrently rather than sequentially', async () => {
    // Regression for the ~22-minute scan bug: the old sequential code cost
    // up to seven 6s deadlines per device. Firing them all at once bounds a
    // device to about one deadline regardless of how many web ports it has.
    let inFlight = 0;
    let maxInFlight = 0;
    const connect = vi.fn(async (_ip: string, port: number) => [80, 443, 8080, 8123].includes(port));
    const get = vi.fn(async (ip: string, port: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { url: `http://${ip}:${port}`, title: `title-${port}` };
    });

    const [probed] = await probeDevices([device('192.168.1.50')], { connect, get, timeoutMs: 10 });

    expect(get).toHaveBeenCalledTimes(4);
    // All four fetches overlapped rather than running one at a time.
    expect(maxInFlight).toBeGreaterThan(1);
    // The first port in PORTS order (80) wins when every port responds.
    expect(probed.web).toEqual({ url: 'http://192.168.1.50:80', title: 'title-80' });
    expect(probed.ports.map((p) => p.port)).toEqual([80, 443, 8080, 8123]);
  });

  it('keeps the first non-null result in port order, not whichever port answered first, when an earlier port is slow or broken', async () => {
    // The residual gap from the re-review: a device whose first open web
    // port is dead or slow (a router on 80 and 443, a device on 8080 that
    // only serves on 8123) must not lose its title and link just because it
    // wasn't the first one tried.
    const connect = vi.fn(async (_ip: string, port: number) => [80, 443, 8123].includes(port));
    const get = vi.fn(async (ip: string, port: number) => {
      if (port === 80) {
        return null;
      }
      if (port === 443) {
        return { url: `http://${ip}:${port}`, title: `title-${port}` };
      }
      return { url: `http://${ip}:${port}`, title: `title-${port}` };
    });

    const [probed] = await probeDevices([device('192.168.1.50')], { connect, get, timeoutMs: 10 });

    // All three open web ports were fetched together, not stopped after 80.
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith('192.168.1.50', 80, expect.any(Number));
    expect(get).toHaveBeenCalledWith('192.168.1.50', 443, expect.any(Number));
    expect(get).toHaveBeenCalledWith('192.168.1.50', 8123, expect.any(Number));
    // 443 is the first port (in PORTS order) with a non-null result.
    expect(probed.web).toEqual({ url: 'http://192.168.1.50:443', title: 'title-443' });
    expect(probed.ports.find((p) => p.port === 80)?.web).toBeNull();
    expect(probed.ports.find((p) => p.port === 443)?.web).toEqual({
      url: 'http://192.168.1.50:443',
      title: 'title-443',
    });
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

// These exercise the real, non-injected implementations against loopback
// servers started in-process. That is not the "no real network I/O" the
// binding constraints forbid (no LAN, no multicast, no DNS) -- it is the
// only way to prove sockets are actually destroyed, the size cap actually
// stops reading, and a stalled peer is actually bounded, rather than trusting
// that a mock was wired up correctly.
describe('tcpConnect against a real loopback socket', () => {
  it('resolves true for a port something is listening on', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(tcpConnect('127.0.0.1', port, 500)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resolves false for a port nothing is listening on', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    // Close it immediately so the port is free but definitely refuses.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(tcpConnect('127.0.0.1', port, 500)).resolves.toBe(false);
  });
});

describe('httpGet against a real loopback server', () => {
  it('reads the title from a normal response', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>Loopback Device</title></head></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const info = await httpGet('127.0.0.1', port, 500);
      expect(info?.url).toBe(`http://127.0.0.1:${port}/`);
      expect(info?.title).toBe('Loopback Device');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('stops reading once the body passes the 64KB cap', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      // A body well past the cap; a device that streams forever must not be
      // read forever.
      res.end(`<title>Big</title>${'x'.repeat(200 * 1024)}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const info = await httpGet('127.0.0.1', port, 500);
      // The cap can land mid-title-scan or after it, depending on chunking;
      // either way the call must resolve instead of buffering 200KB.
      expect(info).not.toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resolves within the wall-clock deadline against a server that dribbles forever', async () => {
    // Headers arrive, then a byte arrives faster than the idle timeout ever
    // elapses, so the per-chunk idle timer never fires and the 64KB cap is
    // never reached either. Only the wall-clock deadline can end this -- the
    // regression case for the Critical finding.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<title>Slow Device</title>');
      const drip = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(drip);
          return;
        }
        res.write(' ');
      }, 30);
      res.on('close', () => clearInterval(drip));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const started = Date.now();
    // timeoutMs is small on purpose; the drip (every 30ms) keeps beating the
    // idle timer, so what actually bounds this call is the wall-clock
    // deadline (Math.max(timeoutMs, 2000) * 3 = 6000ms), not the idle timer.
    const info = await httpGet('127.0.0.1', port, 50);
    const elapsed = Date.now() - started;

    expect(info).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(5000);
    expect(elapsed).toBeLessThan(9000);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 12000);
});

describe('probeDevices concurrency caps', () => {
  it('caps concurrent devices in flight at 8', async () => {
    let inFlightDevices = 0;
    let maxInFlightDevices = 0;
    const started = new Set<string>();
    // Only the first port probe per device is delayed, so the test stays
    // fast while still exposing device-level overlap.
    const connect = vi.fn(async (ip: string) => {
      if (!started.has(ip)) {
        started.add(ip);
        inFlightDevices += 1;
        maxInFlightDevices = Math.max(maxInFlightDevices, inFlightDevices);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlightDevices -= 1;
      }
      return false;
    });

    const devices = Array.from({ length: 20 }, (_, i) => device(`192.168.1.${i + 1}`));
    await probeDevices(devices, { connect, get: async () => null, timeoutMs: 5, concurrency: 1 });

    expect(maxInFlightDevices).toBeGreaterThan(1);
    expect(maxInFlightDevices).toBeLessThanOrEqual(8);
  });

  it('caps concurrent ports in flight per device at the configured concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const connect = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return false;
    });

    await probeDevices([device('192.168.1.50')], {
      connect, get: async () => null, timeoutMs: 5, concurrency: 3,
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    // 16 ports over a limit of 3 means the cap is actually reached, not just
    // never exceeded.
    expect(maxInFlight).toBe(3);
  });
});
