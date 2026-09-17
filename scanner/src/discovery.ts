import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { Device } from '../../src/survey/types';
import { ScannerConfig } from './config';

const execFileAsync = promisify(execFile);

// arp-scan --plain prints "ip<TAB>mac<TAB>vendor" and nothing else. Every
// device on the segment must answer ARP to be usable on it, so this finds
// hosts that drop pings and have no open ports.
export function parseArpScan(stdout: string): Array<{ ip: string; mac: string; vendor: string | null }> {
  const seen = new Set<string>();
  const rows: Array<{ ip: string; mac: string; vendor: string | null }> = [];
  for (const line of stdout.split('\n')) {
    const columns = line.split('\t');
    if (columns.length < 3) {
      continue;
    }
    const ip = columns[0].trim();
    const mac = columns[1].trim().toLowerCase();
    const vendor = columns[2].trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      continue;
    }
    // A host can answer twice; the second reply carries nothing new.
    if (seen.has(mac)) {
      continue;
    }
    seen.add(mac);
    rows.push({ ip, mac, vendor: vendor && vendor !== '(Unknown)' ? vendor : null });
  }
  return rows;
}

// Phones set this bit when they use a per-network random address, which is why
// their manufacturer cannot be looked up: there is no manufacturer.
export function isPrivateMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isNaN(first) ? false : (first & 0x02) === 0x02;
}

function toDevice(row: { ip: string; mac: string; vendor: string | null }): Device {
  const privateMac = isPrivateMac(row.mac);
  return {
    ip: row.ip,
    mac: row.mac,
    // A randomized address has no owner to look up, so an OUI hit would be a
    // coincidence rather than information.
    vendor: privateMac ? null : row.vendor,
    privateMac,
    name: null,
    nameSource: null,
    web: null,
    services: [],
    ports: [],
    rttMs: null,
  };
}

export function selfDevice(
  iface: string,
  interfaces: typeof os.networkInterfaces = os.networkInterfaces,
): Device | null {
  const addresses = interfaces()[iface];
  const ipv4 = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
  if (!ipv4 || !ipv4.mac) {
    return null;
  }
  return toDevice({ ip: ipv4.address, mac: ipv4.mac.toLowerCase(), vendor: null });
}

async function runArpScan(config: ScannerConfig): Promise<string> {
  // execFile, not exec: no shell, so the configured values are arguments
  // rather than something a shell could reinterpret.
  const { stdout } = await execFileAsync(
    'arp-scan',
    ['--interface', config.iface, '--plain', '--retry=2', '--timeout=200', config.cidr],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

export async function discover(
  config: ScannerConfig,
  run: (config: ScannerConfig) => Promise<string> = runArpScan,
  interfaces: typeof os.networkInterfaces = os.networkInterfaces,
): Promise<Device[]> {
  const devices = parseArpScan(await run(config)).map(toDevice);
  const self = selfDevice(config.iface, interfaces);
  // The scanning host does not answer its own ARP requests, so without this
  // the node running the scanner is the one device missing from the survey.
  if (self && !devices.some((device) => device.mac === self.mac)) {
    devices.push(self);
  }
  return devices;
}
