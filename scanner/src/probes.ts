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
    const done = (open: boolean) => {
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
export const httpGet: Get = (ip, port, timeoutMs) =>
  new Promise((resolve) => {
    const tls = port === 443 || port === 8443 || port === 5001;
    const url = `${tls ? 'https' : 'http'}://${ip}:${port}/`;
    // Typed as https options because rejectUnauthorized only exists there;
    // http.get ignores the extra field.
    const options: https.RequestOptions = {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { accept: 'text/html' },
    };
    const request = (tls ? https : http).get(url, options, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          // A title lives in the head; 64KB is generous and bounds a device
          // that would otherwise stream forever.
          if (body.length > 64 * 1024) {
            request.destroy();
          }
        });
      response.on('end', () => resolve({ url, title: extractTitle(body) }));
      response.on('error', () => resolve({ url, title: extractTitle(body) }));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
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
    const ports: DevicePort[] = [];
    let web: WebInfo | null = null;
    for (const candidate of open) {
      if (!candidate) {
        continue;
      }
      let portWeb: WebInfo | null = null;
      if (candidate.web) {
        portWeb = await get(device.ip, candidate.port, Math.max(timeoutMs, 2000)).catch(() => null);
        // The first responding web port becomes the device's link.
        web = web ?? portWeb;
      }
      ports.push({ port: candidate.port, service: candidate.service, web: portWeb });
    }
    return { ...device, ports, web };
  });
}
