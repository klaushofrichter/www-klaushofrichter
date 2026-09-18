import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ScannerConfig } from '../../scanner/src/config';

// runArpScan's own error translation is the only diagnostic the dashboard
// gets for a scanner with no public URL or log access, so it is covered
// directly against a mocked execFile rather than by eye. child_process is
// mocked (not the promisified wrapper) because that's the real boundary:
// promisify(execFile) rejects with whatever execFile's callback passes it.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { discover, isPrivateMac, parseArpScan, runArpScan, selfDevice } from '../../scanner/src/discovery';

function mockExecFileError(error: Record<string, unknown>) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: (err: unknown) => void) => {
      callback(error);
      return new EventEmitter();
    },
  );
}

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

  it('drops a row whose IP has an out-of-range octet, not just the wrong shape', () => {
    expect(parseArpScan('999.999.999.999\taa:bb:cc:dd:ee:ff\tAcme\n192.168.1.2\t11:22:33:44:55:66\tAcme\n')).toEqual([
      { ip: '192.168.1.2', mac: '11:22:33:44:55:66', vendor: 'Acme' },
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

    const devices = await discover(config, run, () => ({}) as ReturnType<typeof import('node:os').networkInterfaces>);

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

describe('runArpScan', () => {
  it('reports a missing binary by name, not a raw ENOENT', async () => {
    mockExecFileError({ code: 'ENOENT', message: 'spawn arp-scan ENOENT' });

    await expect(runArpScan(config)).rejects.toThrow('arp-scan is not installed in this image');
  });

  it('reports a timeout with the CIDR that was being scanned', async () => {
    mockExecFileError({ killed: true, signal: 'SIGTERM', message: 'command timed out' });

    await expect(runArpScan(config)).rejects.toThrow(`arp-scan timed out after 30s scanning ${config.cidr}`);
  });

  it('reports a non-zero exit with the interface and the first line of stderr', async () => {
    mockExecFileError({ code: 1, message: 'Command failed', stderr: 'arp-scan: eno1: No such device\nmore detail\n' });

    await expect(runArpScan(config)).rejects.toThrow('arp-scan failed on eno1 (exit 1): arp-scan: eno1: No such device');
  });

  it('falls back to the raw error message when stderr is empty', async () => {
    mockExecFileError({ code: 2, message: 'Command failed with exit code 2' });

    await expect(runArpScan(config)).rejects.toThrow('arp-scan failed on eno1 (exit 2): Command failed with exit code 2');
  });
});
