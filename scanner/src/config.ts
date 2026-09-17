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

const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
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
  return {
    token,
    cidr,
    iface,
    port,
    // The cluster bridge, not 0.0.0.0: on the host network a wildcard bind
    // would expose this to every device on the LAN.
    bindAddress: env.BIND_ADDRESS ?? '10.42.0.1',
    version: env.APP_VERSION ?? 'dev',
  };
}
