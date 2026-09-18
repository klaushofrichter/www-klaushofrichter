import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../scanner/src/config';

const valid = {
  SCANNER_TOKEN: 'a-token-value',
  SCAN_CIDR: '192.168.1.0/24',
  SCAN_INTERFACE: 'eno1',
  BIND_ADDRESS: '10.42.0.1',
  SCANNER_PORT: '9450',
  APP_VERSION: '2026.09.18.1',
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    expect(loadConfig(valid)).toEqual({
      token: 'a-token-value', cidr: '192.168.1.0/24', iface: 'eno1',
      bindAddress: '10.42.0.1', port: 9450, version: '2026.09.18.1',
    });
  });

  it('defaults the port, bind address and version', () => {
    const config = loadConfig({ SCANNER_TOKEN: 'a-token-value', SCAN_CIDR: '192.168.1.0/24', SCAN_INTERFACE: 'eno1' });

    expect(config.port).toBe(9450);
    expect(config.bindAddress).toBe('10.42.0.1');
    expect(config.version).toBe('dev');
  });

  it('refuses to start without a token', () => {
    expect(() => loadConfig({ SCAN_CIDR: '192.168.1.0/24', SCAN_INTERFACE: 'eno1' })).toThrow(/SCANNER_TOKEN/);
  });

  it('refuses a token short enough to be a placeholder', () => {
    expect(() => loadConfig({ ...valid, SCANNER_TOKEN: 'short' })).toThrow(/SCANNER_TOKEN/);
  });

  it('refuses a CIDR that is not a CIDR', () => {
    expect(() => loadConfig({ ...valid, SCAN_CIDR: '192.168.1.1' })).toThrow(/SCAN_CIDR/);
    expect(() => loadConfig({ ...valid, SCAN_CIDR: 'all-of-them' })).toThrow(/SCAN_CIDR/);
  });

  it('refuses out-of-range octets or prefix lengths, since the value reaches a spawned process', () => {
    expect(() => loadConfig({ ...valid, SCAN_CIDR: '999.999.999.999/99' })).toThrow(/SCAN_CIDR/);
    expect(() => loadConfig({ ...valid, SCAN_CIDR: '192.168.1.0/33' })).toThrow(/SCAN_CIDR/);
  });

  it('still accepts valid CIDRs at both ends of the octet and prefix range', () => {
    expect(loadConfig({ ...valid, SCAN_CIDR: '192.168.1.0/24' }).cidr).toBe('192.168.1.0/24');
    expect(loadConfig({ ...valid, SCAN_CIDR: '10.0.0.0/8' }).cidr).toBe('10.0.0.0/8');
  });

  it('refuses an interface name that could reach a shell', () => {
    expect(() => loadConfig({ ...valid, SCAN_INTERFACE: 'eno1; rm -rf /' })).toThrow(/SCAN_INTERFACE/);
  });

  it('refuses a bindAddress that is not a dotted IPv4 address', () => {
    expect(() => loadConfig({ ...valid, BIND_ADDRESS: 'not-an-ip' })).toThrow(/BIND_ADDRESS/);
    expect(() => loadConfig({ ...valid, BIND_ADDRESS: '999.999.999.999' })).toThrow(/BIND_ADDRESS/);
    expect(() => loadConfig({ ...valid, BIND_ADDRESS: '::1' })).toThrow(/BIND_ADDRESS/);
  });

  // The one setting that keeps this NET_RAW-capable service off the LAN: a
  // wildcard bind on the host network would expose it to every device that
  // can reach the bridge, so it is rejected explicitly rather than merely
  // failing the shape check by chance.
  it('refuses 0.0.0.0 explicitly, since it would expose this NET_RAW service to the LAN', () => {
    expect(() => loadConfig({ ...valid, BIND_ADDRESS: '0.0.0.0' })).toThrow(/0\.0\.0\.0/);
  });
});
