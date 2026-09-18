import { IPV4 } from './ipv4';

// Everything the scanner is allowed to do is fixed here at startup. In
// particular the scan range: no request carries a target, so a stolen website
// session cannot turn this into a general-purpose scanner.
export interface ScannerConfig {
  port: number;
  bindAddress: string;
  token: string;
  cidr: string;
  iface: string;
  version: string;
}

// Built on the shared IPV4 check: shape-only would accept 999.999.999.999/99,
// which becomes an argument to the arp-scan process this config feeds
// (Task 3). No shell is involved, so this is not an injection risk either
// way, but "refuses to start on bad input" is a stated constraint and this
// is the value reaching that subprocess.
const CIDR = new RegExp(`^${IPV4.source.slice(1, -1)}\\/([0-9]|[12]\\d|3[0-2])$`);
// arp-scan is spawned without a shell, but a strict interface name keeps the
// value from being interesting if that ever changes.
const IFACE = /^[A-Za-z0-9._-]{1,32}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScannerConfig {
  const token = env.SCANNER_TOKEN ?? '';
  if (token.length < 8) {
    throw new Error('SCANNER_TOKEN must be set to at least 8 characters');
  }
  const cidr = env.SCAN_CIDR ?? '';
  if (!CIDR.test(cidr)) {
    throw new Error(`SCAN_CIDR must be a CIDR range such as 192.168.1.0/24, got ${JSON.stringify(cidr)}`);
  }
  const iface = env.SCAN_INTERFACE ?? '';
  if (!IFACE.test(iface)) {
    throw new Error(`SCAN_INTERFACE must be an interface name, got ${JSON.stringify(iface)}`);
  }
  const port = Number(env.SCANNER_PORT ?? 9450);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SCANNER_PORT must be a port number, got ${JSON.stringify(env.SCANNER_PORT)}`);
  }
  // The cluster bridge, not 0.0.0.0: on the host network a wildcard bind
  // would expose this NET_RAW-capable service to every device on the LAN.
  // Validated like the rest of this config, not trusted as a safe default,
  // since a typo or override here is the one mistake that would do that.
  const bindAddress = env.BIND_ADDRESS ?? '10.42.0.1';
  if (!IPV4.test(bindAddress)) {
    throw new Error(`BIND_ADDRESS must be a dotted IPv4 address, got ${JSON.stringify(bindAddress)}`);
  }
  if (bindAddress === '0.0.0.0') {
    throw new Error('BIND_ADDRESS must not be 0.0.0.0 - it would expose this NET_RAW service to the whole LAN');
  }
  return {
    token,
    cidr,
    iface,
    port,
    bindAddress,
    version: env.APP_VERSION ?? 'dev',
  };
}
