import { describe, it, expect } from 'vitest';
import {
  applyMdnsResponse,
  cleanText,
  mergeNames,
  parseUpnpDescription,
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
