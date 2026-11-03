import { describe, it, expect } from 'vitest';
import { buildSurveyView, compareToSaved, goneRows, ipToNumber } from '../src/survey/view';
import { seedKnownDevices } from '../src/survey/store';
import { Device, KnownDevicesStore, SavedSurvey, ScanResult } from '../src/survey/types';
import { makeDevice } from './helpers';

function saved(devices: Device[], scannedAt = '2026-09-17T10:00:00.000Z'): SavedSurvey {
  return { scannedAt, savedAt: '2026-09-17T10:01:00.000Z', cidr: '192.168.1.0/24', version: 'dev', devices };
}

function scan(devices: Device[], scannedAt = '2026-09-17T11:00:00.000Z'): ScanResult {
  return { scannedAt, cidr: '192.168.1.0/24', devices };
}

describe('ipToNumber', () => {
  it('orders addresses numerically, not as text', () => {
    expect(ipToNumber('192.168.1.9')).toBeLessThan(ipToNumber('192.168.1.10'));
    expect(ipToNumber('192.168.1.10')).toBeLessThan(ipToNumber('192.168.1.100'));
  });

  it('sends malformed addresses to the end', () => {
    expect(ipToNumber('not-an-ip')).toBe(Number.MAX_SAFE_INTEGER);
    expect(ipToNumber('192.168.1.256')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('compareToSaved', () => {
  it('marks nothing as new when there is no saved survey to compare against', () => {
    const rows = compareToSaved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')], null);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('marks new and unchanged devices by MAC address, and leaves gone rows to the known-devices list', () => {
    const rows = compareToSaved(
      [makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02')],
      [makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.4', 'aa:aa:aa:aa:aa:03')],
    );

    expect(rows.map((r) => [r.mac, r.status])).toEqual([
      ['aa:aa:aa:aa:aa:01', 'unchanged'],
      ['aa:aa:aa:aa:aa:02', 'new'],
    ]);
  });

  it('treats a device that moved to a new IP as unchanged', () => {
    const rows = compareToSaved(
      [makeDevice('192.168.1.50', 'aa:aa:aa:aa:aa:01')],
      [makeDevice('192.168.1.20', 'aa:aa:aa:aa:aa:01')],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('unchanged');
    expect(rows[0].ip).toBe('192.168.1.50');
  });

  it('matches MAC addresses case-insensitively', () => {
    const rows = compareToSaved([makeDevice('192.168.1.2', 'AA:BB:CC:DD:EE:FF')], [makeDevice('192.168.1.2', 'aa:bb:cc:dd:ee:ff')]);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('precomputes the sort keys', () => {
    const [row] = compareToSaved([makeDevice('192.168.1.10', 'aa:aa:aa:aa:aa:01')], []);

    expect(row.ipNum).toBe(ipToNumber('192.168.1.10'));
    expect(row.statusRank).toBe(0);
  });
});

describe('buildSurveyView', () => {
  it('is empty with neither a scan nor a saved survey', () => {
    expect(buildSurveyView(null, null)).toEqual({
      source: 'none', scannedAt: null, savedAt: null, hasSaved: false, rows: [],
      counts: { devices: 0, new: 0, gone: 0 },
    });
  });

  it('shows the saved survey when there is no newer scan', () => {
    const view = buildSurveyView(null, saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

    expect(view.source).toBe('saved');
    expect(view.savedAt).toBe('2026-09-17T10:01:00.000Z');
    expect(view.counts).toEqual({ devices: 1, new: 0, gone: 0 });
  });

  it('shows an unsaved scan compared against the saved survey', () => {
    const savedSurvey = saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.4', 'aa:aa:aa:aa:aa:03')]);
    const view = buildSurveyView(
      scan([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02')]),
      savedSurvey,
      {},
      seedKnownDevices(savedSurvey),
    );

    expect(view.source).toBe('scan');
    expect(view.scannedAt).toBe('2026-09-17T11:00:00.000Z');
    expect(view.counts).toEqual({ devices: 2, new: 1, gone: 1 });
    expect(view.hasSaved).toBe(true);
  });

  it('flags an unsaved scan as having no baseline when nothing has ever been saved', () => {
    const view = buildSurveyView(scan([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]), null);

    expect(view.source).toBe('scan');
    expect(view.hasSaved).toBe(false);
  });

  it('shows the saved survey once the finished scan has been saved', () => {
    const devices = [makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')];
    const view = buildSurveyView(scan(devices, '2026-09-17T11:00:00.000Z'), saved(devices, '2026-09-17T11:00:00.000Z'));

    expect(view.source).toBe('saved');
  });

  it('defaults every row to no note when none is given', () => {
    const view = buildSurveyView(null, saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

    expect(view.rows[0].note).toBeNull();
  });

  it('merges a note onto its device by MAC, case-insensitively', () => {
    const view = buildSurveyView(null, saved([makeDevice('192.168.1.2', 'AA:AA:AA:AA:AA:01')]), {
      'aa:aa:aa:aa:aa:01': { text: 'kitchen printer', updatedAt: '2026-09-17T12:00:00.000Z' },
    });

    expect(view.rows[0].note).toBe('kitchen printer');
  });

  it('keeps a note on a device that disappeared, so it comes back if the device does', () => {
    const savedSurvey = saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02')]);
    const view = buildSurveyView(
      scan([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]),
      savedSurvey,
      { 'aa:aa:aa:aa:aa:02': { text: 'old laptop', updatedAt: '2026-09-17T12:00:00.000Z' } },
      seedKnownDevices(savedSurvey),
    );

    const gone = view.rows.find((row) => row.status === 'gone');
    expect(gone?.note).toBe('old laptop');
  });

  describe('known devices', () => {
    const LAST_SEEN = '2026-09-10T08:00:00.000Z';

    function known(...entries: Array<[string, string, string | null]>): KnownDevicesStore {
      const store: KnownDevicesStore = {};
      for (const [mac, ip, name] of entries) {
        store[mac] = { ip, name, nameSource: null, vendor: 'Acme', privateMac: false, lastSeenAt: LAST_SEEN };
      }
      return store;
    }

    it('adds a gone row, at its last-seen IP and time, for a known device missing from the saved survey', () => {
      const view = buildSurveyView(
        null,
        saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]),
        {},
        known(['aa:aa:aa:aa:aa:01', '192.168.1.2', null], ['aa:aa:aa:aa:aa:09', '192.168.1.77', 'old laptop']),
      );

      expect(view.source).toBe('saved');
      const gone = view.rows.filter((row) => row.status === 'gone');
      expect(gone).toHaveLength(1);
      expect(gone[0]).toMatchObject({
        mac: 'aa:aa:aa:aa:aa:09', ip: '192.168.1.77', name: 'old laptop', vendor: 'Acme',
        lastSeenAt: LAST_SEEN, statusRank: 2, web: null, ports: [], services: [],
      });
      expect(view.counts).toEqual({ devices: 1, new: 0, gone: 1 });
    });

    it('never lists a device twice, whether it is gone from the saved survey, the known list, or both', () => {
      const savedSurvey = saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02')]);
      const view = buildSurveyView(
        scan([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]),
        savedSurvey,
        {},
        { ...seedKnownDevices(savedSurvey), ...known(['aa:aa:aa:aa:aa:03', '192.168.1.4', null]) },
      );

      const macs = view.rows.map((row) => row.mac);
      expect(new Set(macs).size).toBe(macs.length);
      expect(view.rows.filter((row) => row.status === 'gone').map((row) => row.mac).sort())
        .toEqual(['aa:aa:aa:aa:aa:02', 'aa:aa:aa:aa:aa:03']);
      expect(view.counts).toEqual({ devices: 1, new: 0, gone: 2 });
    });

    it('does not show a removed device as gone, even while the saved survey still lists it', () => {
      const savedSurvey = saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02')]);
      const knownAfterRemoval = seedKnownDevices(savedSurvey);
      delete knownAfterRemoval['aa:aa:aa:aa:aa:02'];

      const view = buildSurveyView(scan([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]), savedSurvey, {}, knownAfterRemoval);

      expect(view.rows.map((row) => row.mac)).toEqual(['aa:aa:aa:aa:aa:01']);
      expect(view.counts.gone).toBe(0);
    });

    it('shows a returning device as a normal row, not as gone', () => {
      const view = buildSurveyView(
        scan([makeDevice('192.168.1.50', 'AA:AA:AA:AA:AA:09')]),
        saved([]),
        {},
        known(['aa:aa:aa:aa:aa:09', '192.168.1.77', 'old laptop']),
      );

      expect(view.rows.map((row) => [row.ip, row.status])).toEqual([['192.168.1.50', 'new']]);
    });

    it('keeps the last-seen IP on a gone row even when another device now has it', () => {
      const view = buildSurveyView(
        null,
        saved([makeDevice('192.168.1.77', 'aa:aa:aa:aa:aa:01')]),
        {},
        known(['aa:aa:aa:aa:aa:01', '192.168.1.77', null], ['aa:aa:aa:aa:aa:09', '192.168.1.77', null]),
      );

      expect(view.rows.map((row) => [row.mac, row.ip, row.status])).toEqual([
        ['aa:aa:aa:aa:aa:01', '192.168.1.77', 'unchanged'],
        ['aa:aa:aa:aa:aa:09', '192.168.1.77', 'gone'],
      ]);
    });

    it('keeps a note on a gone row from the known list', () => {
      const view = buildSurveyView(
        null,
        saved([]),
        { 'aa:aa:aa:aa:aa:09': { text: 'in the drawer', updatedAt: 'x' } },
        known(['aa:aa:aa:aa:aa:09', '192.168.1.77', null]),
      );

      expect(view.rows[0].note).toBe('in the drawer');
    });

    it('leaves lastSeenAt empty on rows that are present', () => {
      const rows = goneRows([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')], known(['aa:aa:aa:aa:aa:01', '192.168.1.2', null]));
      const view = buildSurveyView(null, saved([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

      expect(rows).toEqual([]);
      expect(view.rows[0].lastSeenAt).toBeNull();
    });
  });
});
