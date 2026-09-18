import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Device, DevicePort, WebInfo } from '../../src/survey/types';
import { cleanText } from './names';

// A short, deliberate list. A full port scan takes minutes and rarely answers
// "what is this device?" better than these do.
export const PORTS: ReadonlyArray<{ port: number; service: string; web: boolean }> = [
  { port: 22, service: 'SSH', web: false },
  { port: 53, service: 'DNS', web: false },
  { port: 80, service: 'Web', web: true },
  { port: 443, service: 'Web (TLS)', web: true },
  { port: 445, service: 'Windows file sharing', web: false },
  { port: 554, service: 'Camera (RTSP)', web: false },
  { port: 631, service: 'Printer (IPP)', web: false },
  { port: 1883, service: 'MQTT', web: false },
  { port: 5000, service: 'Synology', web: true },
  { port: 5001, service: 'Synology (TLS)', web: true },
  { port: 8008, service: 'Chromecast', web: false },
  { port: 8009, service: 'Chromecast', web: false },
  { port: 8080, service: 'Web (alt)', web: true },
  { port: 8123, service: 'Home Assistant', web: true },
  { port: 8443, service: 'Web (alt TLS)', web: true },
  { port: 9100, service: 'Printer (raw)', web: false },
];

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) {
    return null;
  }
  const decoded = match[1].replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);
  return cleanText(decoded);
}

export type Connect = (ip: string, port: number, timeoutMs: number) => Promise<boolean>;
export type Get = (ip: string, port: number, timeoutMs: number) => Promise<WebInfo | null>;

export interface ProbeOptions {
  connect?: Connect;
  get?: Get;
  timeoutMs?: number;
  concurrency?: number;
}

export const tcpConnect: Connect = (ip, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });

// Home devices almost all present self-signed certificates. This reads a page
// title and nothing else, so accepting them costs nothing; no credential is
// ever sent to these hosts.
// The wall-clock deadline as its own function so tests can shorten it; the
// production default (used whenever the caller doesn't override it) stays
// generous because a real device dribbling bytes still deserves the full
// window before being given up on.
export function defaultHttpDeadlineMs(timeoutMs: number): number {
  return Math.max(timeoutMs, 2000) * 3;
}

export const httpGet = (ip: string, port: number, timeoutMs: number, deadlineMs?: number): Promise<WebInfo | null> =>
  new Promise((resolve) => {
    const tls = port === 443 || port === 8443 || port === 5001;
    const url = `${tls ? 'https' : 'http'}://${ip}:${port}/`;
    // Typed as https options because rejectUnauthorized only exists there;
    // http.get ignores the extra field.
    //
    // Accepted exception, recorded in .github/codeql-accepted.tsv: CodeQL flags
    // js/disabling-certificate-validation here, correctly in general and
    // deliberately in this case. These are home LAN devices, which essentially
    // all present self-signed certificates; the request sends no credential,
    // carries no cookie, and reads one thing - the <title> - which is rendered
    // as text. Validating would drop the title for a Synology on 5001 or a
    // router on 443 and gain nothing, since there is no secret to protect on
    // this connection. The worst a LAN attacker gets is a misleading label.
    // codeql[js/disabling-certificate-validation]
    const options: https.RequestOptions = {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { accept: 'text/html' },
    };
    let settled = false;
    let body = '';
    // Idle timeouts and the size cap both miss the case that matters here: a
    // device that sends headers and then dribbles bytes forever. Only a
    // wall-clock deadline bounds that.
    const finish = (value: WebInfo | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      request.destroy();
      resolve(value);
    };
    const deadline = setTimeout(() => finish(null), deadlineMs ?? defaultHttpDeadlineMs(timeoutMs));
    const request = (tls ? https : http).get(url, options, (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
        // A title lives in the head; 64KB is generous and bounds a device
        // that would otherwise stream forever.
        if (body.length > 64 * 1024) {
          finish({ url, title: extractTitle(body) });
        }
      });
      response.on('end', () => finish({ url, title: extractTitle(body) }));
      response.on('error', () => finish({ url, title: extractTitle(body) }));
    });
    request.on('timeout', () => finish(null));
    request.on('error', () => finish(null));
  });

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function probeDevices(devices: Device[], options: ProbeOptions = {}): Promise<Device[]> {
  const connect = options.connect ?? tcpConnect;
  const get = options.get ?? httpGet;
  const timeoutMs = options.timeoutMs ?? 500;
  const concurrency = options.concurrency ?? 32;

  return mapWithLimit(devices, 8, async (device) => {
    const open = await mapWithLimit(PORTS.slice(), concurrency, async (candidate) => {
      // One refusing host must not take the stage down with it.
      const isOpen = await connect(device.ip, candidate.port, timeoutMs).catch(() => false);
      return isOpen ? candidate : null;
    });
    const openCandidates = open.filter(
      (candidate): candidate is { port: number; service: string; web: boolean } => candidate !== null,
    );
    // Fetching every open web port sequentially cost up to seven 6s
    // deadlines (42s) per device. Firing them all at once bounds a device to
    // about one deadline (~6s worst case) while still finding a title behind
    // whichever port actually answers -- a device whose first open web port
    // is slow or broken (a router on 80 and 443, a device on 8080 that only
    // serves on 8123) must not lose its title and link just because it
    // wasn't the first one tried.
    const webResults = await Promise.all(
      openCandidates.map((candidate) =>
        candidate.web
          ? get(device.ip, candidate.port, Math.max(timeoutMs, 2000)).catch(() => null)
          : Promise.resolve(null),
      ),
    );
    // The first non-null result in port order, not whichever settles first,
    // so the choice is deterministic regardless of relative response times.
    const web = webResults.find((result) => result !== null) ?? null;
    const ports: DevicePort[] = openCandidates.map((candidate, index) => ({
      port: candidate.port,
      service: candidate.service,
      web: webResults[index],
    }));
    return { ...device, ports, web };
  });
}
