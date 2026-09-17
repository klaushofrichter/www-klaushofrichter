import dns from 'node:dns';
import dgram from 'node:dgram';
import * as cheerio from 'cheerio';
import makeMdns from 'multicast-dns';
import { Device, NameSource } from '../../src/survey/types';

const MAX_TEXT = 120;

// Everything here comes from whatever answered on the network, so it is capped
// and stripped before it can reach a saved survey or a browser.
export function cleanText(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  // C0 controls plus DEL and the C1 range: a device could stuff terminal
  // escapes or nulls into an advertised name.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

const SERVICE_LABELS: Record<string, string> = {
  _googlecast: 'Chromecast',
  _airplay: 'AirPlay',
  _raop: 'AirPlay',
  _ipp: 'Printer',
  _ipps: 'Printer',
  _printer: 'Printer',
  _pdl_datastream: 'Printer',
  _hap: 'HomeKit',
  _homekit: 'HomeKit',
  _ssh: 'SSH',
  _smb: 'File sharing',
  _afpovertcp: 'File sharing',
  _spotify_connect: 'Spotify',
  _sonos: 'Sonos',
  _hue: 'Hue bridge',
  _http: 'Web',
};

export function serviceLabel(serviceType: string): string | null {
  return SERVICE_LABELS[serviceType.split('.')[0]] ?? null;
}

export function parseUpnpDescription(xml: string): { name: string | null; model: string | null } {
  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    return {
      name: cleanText($('friendlyName').first().text()),
      model: cleanText($('modelName').first().text()),
    };
  } catch {
    return { name: null, model: null };
  }
}

export interface FoundNames {
  mdns?: string | null;
  ssdp?: string | null;
  dns?: string | null;
  services?: string[];
}

// mDNS first: a device's own advertised name is what its owner recognises.
// SSDP next, then whatever the router's DHCP table remembers.
export function mergeNames(device: Device, found: FoundNames): Device {
  const candidates: Array<[NameSource, string | null]> = [
    ['mdns', cleanText(found.mdns)],
    ['ssdp', cleanText(found.ssdp)],
    ['dns', cleanText(found.dns)],
  ];
  const chosen = candidates.find(([, name]) => name !== null);
  return {
    ...device,
    name: chosen ? chosen[1] : null,
    nameSource: chosen ? chosen[0] : null,
    services: Array.from(new Set(found.services ?? [])),
  };
}

export interface NameOptions {
  reverseDns(ip: string): Promise<string | null>;
  mdns(): Promise<Map<string, { name: string | null; services: string[] }>>;
  ssdp(): Promise<Map<string, { name: string | null; model: string | null }>>;
}

export async function resolveNames(devices: Device[], options: NameOptions): Promise<Device[]> {
  // One broken source must not cost the whole stage: a scan with fewer names
  // is still a useful scan.
  const [mdnsResult, ssdpResult] = await Promise.all([
    options.mdns().catch(() => new Map<string, { name: string | null; services: string[] }>()),
    options.ssdp().catch(() => new Map<string, { name: string | null; model: string | null }>()),
  ]);
  return Promise.all(
    devices.map(async (device) => {
      const reverse = await options.reverseDns(device.ip).catch(() => null);
      const mdns = mdnsResult.get(device.ip);
      const ssdp = ssdpResult.get(device.ip);
      return mergeNames(device, {
        mdns: mdns?.name ?? null,
        ssdp: ssdp?.name ?? null,
        dns: reverse,
        services: mdns?.services ?? [],
      });
    }),
  );
}

// --- real implementations, injected in production and replaced in tests ---

export function reverseDnsVia(server: string): (ip: string) => Promise<string | null> {
  const resolver = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers([server]);
  return async (ip) => {
    try {
      const names = await resolver.reverse(ip);
      return cleanText(names[0] ?? null);
    } catch {
      return null;
    }
  };
}

interface MdnsRecordLike {
  name: string;
  type: string;
  data?: unknown;
}
interface MdnsResponseLike {
  answers: MdnsRecordLike[];
  additionals?: MdnsRecordLike[];
}
type MdnsFound = Map<string, { name: string | null; services: string[] }>;

// A flooding or spoofing device must not be able to grow either collector's
// map without limit for the whole collection window; a home LAN that
// legitimately exceeds this has other problems.
export const MAX_RESPONDERS = 512;

// Factored out of the multicast listener so the aggregation logic — the part
// the controller ruling cares about — can be driven directly in tests
// without touching a real socket. `address` is the responder's own address
// (multicast-dns's `rinfo.address`), never derived from record contents, so
// a record is only ever attributed to the device that actually sent it.
export function applyMdnsResponse(found: MdnsFound, response: MdnsResponseLike, address: string): void {
  const entry = found.get(address) ?? { name: null, services: [] };
  for (const record of [...response.answers, ...(response.additionals ?? [])]) {
    if (record.type === 'A' && typeof record.data === 'string') {
      entry.name = entry.name ?? cleanText(record.name);
    }
    if (record.type === 'PTR' && typeof record.name === 'string') {
      const label = serviceLabel(record.name);
      if (label && !entry.services.includes(label)) {
        entry.services.push(label);
      }
    }
  }
  found.set(address, entry);
}

// `createMdns` defaults to the real `multicast-dns` factory and is swapped
// for a fake EventEmitter in tests, so the timer/error races below can be
// driven without a real multicast socket.
export function collectMdns(
  durationMs = 4000,
  createMdns: () => ReturnType<typeof makeMdns> = makeMdns,
): () => Promise<MdnsFound> {
  return () =>
    new Promise((resolve) => {
      const found: MdnsFound = new Map();
      const mdns = createMdns();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      // Idempotent: the error path and the timeout can both try to reach
      // here (in principle — clearing the timer below is what normally
      // stops that — but a socket has no such guarantee), and destroying an
      // already-destroyed multicast socket must not throw a second time.
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        try {
          mdns.destroy();
        } catch {
          /* already destroyed */
        }
        resolve(found);
      };
      mdns.on('response', (response, rinfo) => {
        // Cap by responder address: an address already being tracked can
        // still be updated (a second response filling in more of the same
        // device), but a new address is dropped once the cap is reached.
        if (!found.has(rinfo.address) && found.size >= MAX_RESPONDERS) {
          return;
        }
        applyMdnsResponse(found, response, rinfo.address);
      });
      // No multicast-capable interface, EACCES, etc.: an EventEmitter with
      // no 'error' listener throws, which would otherwise take the process
      // down from inside a stage whose whole point is to not do that.
      mdns.on('error', finish);
      mdns.query({ questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }] });
      timer = setTimeout(finish, durationMs);
    });
}

// `createSocket` defaults to the real dgram factory and is swapped for a
// fake EventEmitter in tests, mirroring collectMdns's injection.
export function collectSsdp(
  durationMs = 4000,
  fetchDescription = fetchUpnpDescription,
  createSocket: () => dgram.Socket = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }),
): () => Promise<Map<string, { name: string | null; model: string | null }>> {
  return () =>
    new Promise((resolve) => {
      const locations = new Map<string, string>();
      const socket = createSocket();
      const search = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n',
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      // Idempotent for the same reason as collectMdns's finish: the error
      // path used to close the socket and resolve without clearing the
      // pending timer, so the timer would later close an already-closed
      // dgram socket — which throws synchronously inside a timer callback,
      // outside any promise chain, and takes the process down.
      const finish = (value: Map<string, { name: string | null; model: string | null }>) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        resolve(value);
      };
      socket.on('message', (message, remote) => {
        const location = /^location:\s*(\S+)/im.exec(message.toString())?.[1];
        if (location && !locations.has(remote.address)) {
          if (locations.size >= MAX_RESPONDERS) {
            return;
          }
          locations.set(remote.address, location);
        }
      });
      socket.on('error', () => finish(new Map()));
      socket.bind(() => socket.send(search, 1900, '239.255.255.250'));
      timer = setTimeout(async () => {
        const found = new Map<string, { name: string | null; model: string | null }>();
        await Promise.all(
          Array.from(locations.entries()).map(async ([ip, location]) => {
            found.set(ip, await fetchDescription(location));
          }),
        );
        finish(found);
      }, durationMs);
    });
}

// The device on the other end of `location` is untrusted, so the body is
// read with a byte budget rather than buffered whole and sliced afterward —
// a device that keeps streaming past 64KB must not make this hold the
// connection (or the memory) open any longer than that.
const MAX_UPNP_BYTES = 64 * 1024;

export async function readUpnpBody(response: { body: ReadableStream<Uint8Array> | null; text(): Promise<string> }): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, MAX_UPNP_BYTES);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_UPNP_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    // Whether the body ended on its own or the budget was hit, the reader
    // (and the underlying connection) must not be left dangling.
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    .subarray(0, MAX_UPNP_BYTES)
    .toString('utf-8');
}

async function fetchUpnpDescription(location: string): Promise<{ name: string | null; model: string | null }> {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return { name: null, model: null };
    }
    return parseUpnpDescription(await readUpnpBody(response));
  } catch {
    return { name: null, model: null };
  }
}
