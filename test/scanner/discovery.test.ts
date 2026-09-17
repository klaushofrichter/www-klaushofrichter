import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discover, isPrivateMac, parseArpScan, selfDevice } from '../../scanner/src/discovery';
import { ScannerConfig } from '../../scanner/src/config';

const output = fs.readFileSync(path.join(__dirname, 'fixtures', 'arp-scan-output.txt'), 'utf8');

const config: ScannerConfig = {
  token: 't', cidr: '192.168.1.0/24', iface: 'eno1',
  bindAddress: '127.0.0.1', port: 9450, version: 'test',
};

describe('parseArpScan', () => {
  it('reads ip, mac and vendor from each line', () => {
    const rows = parseArpScan(output);

    expect(rows[0]).toEqual({ ip: '192.168.1.1', mac: '04:42:1a:14:e8:00', vendor: 'ASUSTek COMPUTER INC.' });
    expect(rows[1].vendor).toBe('Brother Industries, LTD.');
  });

  it('drops duplicate replies from the same MAC', () => {
    expect(parseArpScan(output)).toHaveLength(4);
  });

  it('treats (Unknown) as no vendor', () => {
    expect(parseArpScan(output)[3].vendor).toBeNull();
  });

  it('ignores blank lines and anything that is not three columns', () => {
    expect(parseArpScan('\nInterface: eno1, type: EN10MB\n192.168.1.2\taa:bb:cc:dd:ee:ff\tAcme\n\n')).toEqual([
      { ip: '192.168.1.2', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Acme' },
    ]);
  });
});

describe('isPrivateMac', () => {
  it('detects the locally-administered bit', () => {
    expect(isPrivateMac('6a:1f:22:33:44:55')).toBe(true);
    expect(isPrivateMac('02:00:00:00:00:01')).toBe(true);
  });

  it('treats a manufacturer-assigned address as not private', () => {
    expect(isPrivateMac('04:42:1a:14:e8:00')).toBe(false);
    expect(isPrivateMac('dc:a6:32:77:88:99')).toBe(false);
  });

  it('does not crash on a malformed address', () => {
    expect(isPrivateMac('nonsense')).toBe(false);
  });
});

describe('selfDevice', () => {
  it('builds a device from the scanning interface', () => {
    const device = selfDevice('eno1', () => ({
      eno1: [
        { address: 'fe80::1', family: 'IPv6', mac: '18:66:da:aa:bb:cc', internal: false, netmask: '', cidr: null, scopeid: 0 },
        { address: '192.168.1.103', family: 'IPv4', mac: '18:66:da:aa:bb:cc', internal: false, netmask: '255.255.255.0', cidr: '192.168.1.103/24' },
      ],
    }) as ReturnType<typeof import('node:os').networkInterfaces>);

    expect(device?.ip).toBe('192.168.1.103');
    expect(device?.mac).toBe('18:66:da:aa:bb:cc');
  });

  it('returns null when the interface is not there', () => {
    expect(selfDevice('eno1', () => ({}))).toBeNull();
  });
});

describe('discover', () => {
  it('returns one device per reply, marking private MACs', async () => {
    const run = vi.fn().mockResolvedValue(output);

    const devices = await discover(config, run);

    expect(run).toHaveBeenCalledWith(config);
    expect(devices).toHaveLength(4);
    expect(devices[0].vendor).toBe('ASUSTek COMPUTER INC.');
    expect(devices[3].privateMac).toBe(true);
    expect(devices[3].vendor).toBeNull();
    for (const device of devices) {
      expect(device.ip).toMatch(/^192\.168\.1\./);
      expect(device.mac).toMatch(/^[0-9a-f:]{17}$/);
      expect(device.ports).toEqual([]);
      expect(device.services).toEqual([]);
      expect(device.name).toBeNull();
    }
  });

  it('adds the scanning host, which never answers its own scan', async () => {
    const run = vi.fn().mockResolvedValue('192.168.1.1\t04:42:1a:14:e8:00\tASUSTek COMPUTER INC.\n');
    const self = { ip: '192.168.1.103', mac: '18:66:da:aa:bb:cc' };

    const devices = await discover(config, run, () => ({
      eno1: [{ address: self.ip, family: 'IPv4', mac: self.mac, internal: false, netmask: '', cidr: null }],
    }) as ReturnType<typeof import('node:os').networkInterfaces>);

    expect(devices.map((d) => d.ip)).toContain('192.168.1.103');
  });
});
