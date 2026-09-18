import { EventEmitter } from 'node:events';
import type dgram from 'node:dgram';
import type makeMdns from 'multicast-dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMdnsResponse,
  cleanText,
  collectMdns,
  collectSsdp,
  fetchUpnpDescription,
  MAX_RESPONDERS,
  mergeNames,
  parseUpnpDescription,
  readUpnpBody,
  resolveNames,
  serviceLabel,
} from '../../scanner/src/names';
import { Device } from '../../src/survey/types';

function device(ip: string, mac: string): Device {
  return {
    ip, mac, vendor: null, privateMac: false, name: null, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

describe('cleanText', () => {
  it('trims and caps long values', () => {
    expect(cleanText('  Living Room TV  ')).toBe('Living Room TV');
    expect(cleanText('x'.repeat(400))?.length).toBe(120);
  });

  it('strips control characters a device could send', () => {
    expect(cleanText('Lab\u0000\u0007Printer')).toBe('LabPrinter');
    expect(cleanText('Front\u001bDoor')).toBe('FrontDoor');
  });

  it('returns null for nothing useful', () => {
    expect(cleanText('')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    // All-control-character input cleans down to nothing too.
    expect(cleanText('\u0000\u0001')).toBeNull();
  });
});

describe('serviceLabel', () => {
  it('maps known service types to readable labels', () => {
    expect(serviceLabel('_googlecast._tcp')).toBe('Chromecast');
    expect(serviceLabel('_airplay._tcp')).toBe('AirPlay');
    expect(serviceLabel('_ipp._tcp')).toBe('Printer');
    expect(serviceLabel('_hap._tcp')).toBe('HomeKit');
    expect(serviceLabel('_ssh._tcp')).toBe('SSH');
  });

  it('ignores service types it has no label for', () => {
    expect(serviceLabel('_weird._udp')).toBeNull();
  });
});

describe('parseUpnpDescription', () => {
  it('reads the friendly name and model', () => {
    const xml = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
      <friendlyName>Living Room TV</friendlyName><modelName>KD-55X80J</modelName></device></root>`;

    expect(parseUpnpDescription(xml)).toEqual({ name: 'Living Room TV', model: 'KD-55X80J' });
  });

  it('survives XML it cannot understand', () => {
    expect(parseUpnpDescription('not xml at all')).toEqual({ name: null, model: null });
  });
});

describe('mergeNames', () => {
  const base = device('192.168.1.50', 'aa:bb:cc:dd:ee:01');

  it('prefers mDNS over SSDP and DNS', () => {
    const merged = mergeNames(base, { mdns: 'homeassistant.local', ssdp: 'Home Assistant', dns: 'ha' });

    expect(merged.name).toBe('homeassistant.local');
    expect(merged.nameSource).toBe('mdns');
  });

  it('falls back to SSDP, then DNS', () => {
    expect(mergeNames(base, { ssdp: 'Living Room TV', dns: 'tv' }).nameSource).toBe('ssdp');
    expect(mergeNames(base, { dns: 'printer' }).nameSource).toBe('dns');
  });

  it('leaves a device with no name alone', () => {
    const merged = mergeNames(base, {});

    expect(merged.name).toBeNull();
    expect(merged.nameSource).toBeNull();
  });

  it('records services and drops duplicates', () => {
    expect(mergeNames(base, { services: ['Printer', 'Printer', 'AirPlay'] }).services).toEqual(['Printer', 'AirPlay']);
  });
});

describe('applyMdnsResponse', () => {
  // Controller ruling: the brief's original collectMdns attributed a
  // discovered service label to every device found so far. That is
  // confidently wrong — one Chromecast on the network would label every
  // device a Chromecast. Each record must be attributed to the address that
  // actually sent it (multicast-dns's rinfo.address), not to the whole map.
  it('attributes each responder its own service label, not every device found so far', () => {
    const found = new Map<string, { name: string | null; services: string[] }>();

    applyMdnsResponse(found, { answers: [{ name: '_googlecast._tcp.local', type: 'PTR' }] }, '192.168.1.10');
    applyMdnsResponse(found, { answers: [{ name: '_ipp._tcp.local', type: 'PTR' }] }, '192.168.1.20');

    expect(found.get('192.168.1.10')?.services).toEqual(['Chromecast']);
    expect(found.get('192.168.1.20')?.services).toEqual(['Printer']);
    // Neither responder picked up the other's label.
    expect(found.get('192.168.1.10')?.services).not.toContain('Printer');
    expect(found.get('192.168.1.20')?.services).not.toContain('Chromecast');
  });

  it('takes the hostname from an A record and keeps existing services', () => {
    const found = new Map<string, { name: string | null; services: string[] }>();

    applyMdnsResponse(found, { answers: [{ name: '_hap._tcp.local', type: 'PTR' }] }, '192.168.1.30');
    applyMdnsResponse(
      found,
      { answers: [{ name: 'homeassistant.local', type: 'A', data: '192.168.1.30' }] },
      '192.168.1.30',
    );

    expect(found.get('192.168.1.30')).toEqual({ name: 'homeassistant.local', services: ['HomeKit'] });
  });

  it('does not overwrite a name already recorded for that address', () => {
    const found = new Map<string, { name: string | null; services: string[] }>();

    applyMdnsResponse(found, { answers: [{ name: 'first.local', type: 'A', data: '192.168.1.40' }] }, '192.168.1.40');
    applyMdnsResponse(found, { answers: [{ name: 'second.local', type: 'A', data: '192.168.1.40' }] }, '192.168.1.40');

    expect(found.get('192.168.1.40')?.name).toBe('first.local');
  });
});

describe('resolveNames', () => {
  it('asks every source and merges the answers', async () => {
    const devices = [device('192.168.1.50', 'aa:bb:cc:dd:ee:01'), device('192.168.1.60', 'aa:bb:cc:dd:ee:02')];

    const named = await resolveNames(devices, {
      reverseDns: async (ip) => (ip === '192.168.1.50' ? 'ha' : null),
      mdns: async () => new Map([['192.168.1.50', { name: 'homeassistant.local', services: ['Home Assistant'] }]]),
      ssdp: async () => new Map([['192.168.1.60', { name: 'Living Room TV', model: 'KD-55X80J' }]]),
    });

    expect(named[0].name).toBe('homeassistant.local');
    expect(named[0].nameSource).toBe('mdns');
    expect(named[0].services).toEqual(['Home Assistant']);
    expect(named[1].name).toBe('Living Room TV');
    expect(named[1].nameSource).toBe('ssdp');
  });

  it('keeps going when a source fails outright', async () => {
    const devices = [device('192.168.1.50', 'aa:bb:cc:dd:ee:01')];

    const named = await resolveNames(devices, {
      reverseDns: async () => 'ha',
      mdns: async () => { throw new Error('no multicast here'); },
      ssdp: async () => { throw new Error('nor here'); },
    });

    expect(named[0].name).toBe('ha');
    expect(named[0].nameSource).toBe('dns');
  });
});

// Fix-round-1 findings: collectMdns/collectSsdp error handling, teardown
// idempotency, and the responder cap. These drive the real collectors with
// fake EventEmitter sockets injected via their factory parameters, so no
// real multicast or UDP socket is ever touched.

function fakeMdnsInstance(): EventEmitter & { query: () => void; destroy: () => void } {
  const emitter = new EventEmitter() as EventEmitter & { query: () => void; destroy: () => void };
  emitter.query = vi.fn();
  emitter.destroy = vi.fn();
  return emitter;
}

describe('collectMdns error and timer handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with whatever was collected instead of throwing when the mdns socket errors', async () => {
    const mdns = fakeMdnsInstance();
    const collect = collectMdns(4000, () => mdns as unknown as ReturnType<typeof makeMdns>);
    const promise = collect();

    expect(() => mdns.emit('error', new Error('EACCES'))).not.toThrow();

    await expect(promise).resolves.toEqual(new Map());
    expect(mdns.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not destroy twice or throw when the collection timer elapses after an error', async () => {
    vi.useFakeTimers();
    const mdns = fakeMdnsInstance();
    const collect = collectMdns(4000, () => mdns as unknown as ReturnType<typeof makeMdns>);
    const promise = collect();

    mdns.emit('error', new Error('EACCES'));

    // The bug this guards: the pending timer used to fire anyway and destroy
    // an already-destroyed mdns instance from inside the timer callback.
    await expect(vi.advanceTimersByTimeAsync(4000)).resolves.not.toThrow();
    await expect(promise).resolves.toEqual(new Map());
    expect(mdns.destroy).toHaveBeenCalledTimes(1);
  });

  it('caps the number of responders it will track', async () => {
    vi.useFakeTimers();
    const mdns = fakeMdnsInstance();
    const collect = collectMdns(1000, () => mdns as unknown as ReturnType<typeof makeMdns>);
    const promise = collect();

    for (let i = 0; i < MAX_RESPONDERS + 100; i += 1) {
      const address = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      mdns.emit(
        'response',
        { answers: [{ name: `host-${i}.local`, type: 'A', data: address }] },
        { address, port: 5353 },
      );
    }

    await vi.advanceTimersByTimeAsync(1000);
    const found = await promise;

    expect(found.size).toBe(MAX_RESPONDERS);
  });
});

function fakeSsdpSocket(): EventEmitter & { bind: (cb: () => void) => void; send: (...args: unknown[]) => void; close: () => void } {
  const emitter = new EventEmitter() as EventEmitter & {
    bind: (cb: () => void) => void;
    send: (...args: unknown[]) => void;
    close: () => void;
  };
  emitter.bind = (cb: () => void) => cb();
  emitter.send = vi.fn();
  emitter.close = vi.fn();
  return emitter;
}

describe('collectSsdp error and timer handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not throw when the collection timer elapses after an error already closed the socket', async () => {
    vi.useFakeTimers();
    const socket = fakeSsdpSocket();
    let closeCalls = 0;
    socket.close = vi.fn(() => {
      closeCalls += 1;
      // A second dgram close() throws synchronously; this is the crash the
      // fix guards against, reproduced here without a real socket.
      if (closeCalls > 1) {
        throw new Error('ERR_SOCKET_DGRAM_NOT_RUNNING');
      }
    });

    const collect = collectSsdp(4000, async () => ({ name: null, model: null }), () => socket as unknown as dgram.Socket);
    const promise = collect();

    socket.emit('error', new Error('EACCES'));

    await expect(vi.advanceTimersByTimeAsync(4000)).resolves.not.toThrow();
    await expect(promise).resolves.toEqual(new Map());
    expect(closeCalls).toBe(1);
  });

  it('caps the number of responders it will track', async () => {
    vi.useFakeTimers();
    const socket = fakeSsdpSocket();

    const collect = collectSsdp(1000, async () => ({ name: null, model: null }), () => socket as unknown as dgram.Socket);
    const promise = collect();

    for (let i = 0; i < MAX_RESPONDERS + 100; i += 1) {
      const address = `10.1.${Math.floor(i / 256)}.${i % 256}`;
      const message = Buffer.from(`HTTP/1.1 200 OK\r\nLOCATION: http://${address}:80/desc.xml\r\n\r\n`);
      socket.emit('message', message, { address });
    }

    await vi.advanceTimersByTimeAsync(1000);
    const found = await promise;

    expect(found.size).toBe(MAX_RESPONDERS);
  });
});

describe('readUpnpBody', () => {
  it('stops at the byte budget and cancels the reader instead of buffering the whole body', async () => {
    const chunk = new Uint8Array(20 * 1024).fill(65); // 20KB of 'A'
    let reads = 0;
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: async () => {
        reads += 1;
        return { done: false, value: chunk };
      },
      cancel,
    };
    const response = {
      body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
      text: async () => {
        throw new Error('should not buffer the whole body via text()');
      },
    };

    const text = await readUpnpBody(response);

    expect(text.length).toBe(64 * 1024);
    expect(cancel).toHaveBeenCalledTimes(1);
    // 4 reads of 20KB cross the 64KB budget; a device that never sends
    // `done` must not keep this reading forever.
    expect(reads).toBe(4);
  });

  it('falls back to text() when the response has no body stream', async () => {
    const response = { body: null, text: async () => 'x'.repeat(200 * 1024) };

    const text = await readUpnpBody(response);

    expect(text.length).toBe(64 * 1024);
  });
});

// Critical SSRF fix: `location` comes from an unauthenticated UDP datagram on
// a process that shares the node's network namespace. Every rejection below
// must happen before `fetch` is ever called - these assert both the return
// value and that no request left the process.
describe('fetchUpnpDescription', () => {
  const okXml = '<root><device><friendlyName>Living Room TV</friendlyName><modelName>KD-55X80J</modelName></device></root>';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a non-HTTP scheme without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchUpnpDescription('file:///etc/passwd', '192.168.1.10')).resolves.toEqual({ name: null, model: null });
    await expect(fetchUpnpDescription('gopher://192.168.1.10/desc.xml', '192.168.1.10')).resolves.toEqual({
      name: null,
      model: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a host that differs from the responder without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // The classic SSRF pivot this closes: a device that announces itself
    // from 192.168.1.10 but points LOCATION at the kubelet, the API server,
    // or any other cluster address must not be followed.
    await expect(fetchUpnpDescription('http://127.0.0.1:10250/desc.xml', '192.168.1.10')).resolves.toEqual({
      name: null,
      model: null,
    });
    await expect(fetchUpnpDescription('http://10.42.0.5:6443/desc.xml', '192.168.1.10')).resolves.toEqual({
      name: null,
      model: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a location that does not parse as a URL without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchUpnpDescription('not a url', '192.168.1.10')).resolves.toEqual({ name: null, model: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows no redirect and yields no description for a redirect response', async () => {
    // redirect: 'manual' turns a 3xx into an opaque, not-ok response rather
    // than letting fetch follow it - the second half of the fix, since a
    // permitted host could otherwise still bounce the request elsewhere.
    const fetchSpy = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      return { ok: false, status: 0, type: 'opaqueredirect', body: null, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchUpnpDescription('http://192.168.1.10/desc.xml', '192.168.1.10')).resolves.toEqual({
      name: null,
      model: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches and parses the description when the host matches the responder', async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      return { ok: true, body: null, text: async () => okXml };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchUpnpDescription('http://192.168.1.10:1900/desc.xml', '192.168.1.10')).resolves.toEqual({
      name: 'Living Room TV',
      model: 'KD-55X80J',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('collectSsdp resolves collected locations even when the socket errors', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('still fetches and returns descriptions collected before the error, instead of an empty map', async () => {
    const socket = fakeSsdpSocket();
    const fetchDescription = vi.fn(async (_location: string, ip: string) => ({ name: `device-${ip}`, model: null }));

    const collect = collectSsdp(4000, fetchDescription, () => socket as unknown as dgram.Socket);
    const promise = collect();

    socket.emit(
      'message',
      Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.30:80/desc.xml\r\n\r\n'),
      { address: '192.168.1.30' },
    );
    // The bug this guards: the socket erroring after some responses had
    // already come in used to discard those in favour of an empty map.
    socket.emit('error', new Error('EACCES'));

    const found = await promise;

    expect(fetchDescription).toHaveBeenCalledWith('http://192.168.1.30:80/desc.xml', '192.168.1.30');
    expect(found.get('192.168.1.30')).toEqual({ name: 'device-192.168.1.30', model: null });
  });
});
