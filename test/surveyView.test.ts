import { describe, it, expect } from 'vitest';
import { buildSurveyView, compareToSaved, ipToNumber } from '../src/survey/view';
import { Device, SavedSurvey, ScanResult } from '../src/survey/types';

function device(ip: string, mac: string, name: string | null = null): Device {
  return {
    ip, mac, name, vendor: null, privateMac: false, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

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
    const rows = compareToSaved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')], null);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('marks new, unchanged and gone devices by MAC address', () => {
    const rows = compareToSaved(
      [device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.3', 'aa:aa:aa:aa:aa:02')],
      [device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.4', 'aa:aa:aa:aa:aa:03')],
    );

    expect(rows.map((r) => [r.mac, r.status])).toEqual([
      ['aa:aa:aa:aa:aa:01', 'unchanged'],
      ['aa:aa:aa:aa:aa:02', 'new'],
      ['aa:aa:aa:aa:aa:03', 'gone'],
    ]);
  });

  it('treats a device that moved to a new IP as unchanged', () => {
    const rows = compareToSaved(
      [device('192.168.1.50', 'aa:aa:aa:aa:aa:01')],
      [device('192.168.1.20', 'aa:aa:aa:aa:aa:01')],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('unchanged');
    expect(rows[0].ip).toBe('192.168.1.50');
  });

  it('matches MAC addresses case-insensitively', () => {
    const rows = compareToSaved([device('192.168.1.2', 'AA:BB:CC:DD:EE:FF')], [device('192.168.1.2', 'aa:bb:cc:dd:ee:ff')]);

    expect(rows.map((r) => r.status)).toEqual(['unchanged']);
  });

  it('precomputes the sort keys', () => {
    const [row] = compareToSaved([device('192.168.1.10', 'aa:aa:aa:aa:aa:01')], []);

    expect(row.ipNum).toBe(ipToNumber('192.168.1.10'));
    expect(row.statusRank).toBe(0);
  });
});

describe('buildSurveyView', () => {
  it('is empty with neither a scan nor a saved survey', () => {
    expect(buildSurveyView(null, null)).toEqual({
      source: 'none', scannedAt: null, savedAt: null, unsaved: false, hasSaved: false, rows: [],
      counts: { devices: 0, new: 0, gone: 0 },
    });
  });

  it('shows the saved survey when there is no newer scan', () => {
    const view = buildSurveyView(null, saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

    expect(view.source).toBe('saved');
    expect(view.unsaved).toBe(false);
    expect(view.savedAt).toBe('2026-09-17T10:01:00.000Z');
    expect(view.counts).toEqual({ devices: 1, new: 0, gone: 0 });
  });

  it('shows an unsaved scan compared against the saved survey', () => {
    const view = buildSurveyView(
      scan([device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.3', 'aa:aa:aa:aa:aa:02')]),
      saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.4', 'aa:aa:aa:aa:aa:03')]),
    );

    expect(view.source).toBe('scan');
    expect(view.unsaved).toBe(true);
    expect(view.scannedAt).toBe('2026-09-17T11:00:00.000Z');
    expect(view.counts).toEqual({ devices: 2, new: 1, gone: 1 });
    expect(view.hasSaved).toBe(true);
  });

  it('flags an unsaved scan as having no baseline when nothing has ever been saved', () => {
    const view = buildSurveyView(scan([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')]), null);

    expect(view.source).toBe('scan');
    expect(view.hasSaved).toBe(false);
  });

  it('shows the saved survey once the finished scan has been saved', () => {
    const devices = [device('192.168.1.2', 'aa:aa:aa:aa:aa:01')];
    const view = buildSurveyView(scan(devices, '2026-09-17T11:00:00.000Z'), saved(devices, '2026-09-17T11:00:00.000Z'));

    expect(view.source).toBe('saved');
    expect(view.unsaved).toBe(false);
  });

  it('defaults every row to no note when none is given', () => {
    const view = buildSurveyView(null, saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')]));

    expect(view.rows[0].note).toBeNull();
  });

  it('merges a note onto its device by MAC, case-insensitively', () => {
    const view = buildSurveyView(null, saved([device('192.168.1.2', 'AA:AA:AA:AA:AA:01')]), {
      'aa:aa:aa:aa:aa:01': { text: 'kitchen printer', updatedAt: '2026-09-17T12:00:00.000Z' },
    });

    expect(view.rows[0].note).toBe('kitchen printer');
  });

  it('keeps a note on a device that disappeared, so it comes back if the device does', () => {
    const view = buildSurveyView(
      scan([device('192.168.1.2', 'aa:aa:aa:aa:aa:01')]),
      saved([device('192.168.1.2', 'aa:aa:aa:aa:aa:01'), device('192.168.1.3', 'aa:aa:aa:aa:aa:02')]),
      { 'aa:aa:aa:aa:aa:02': { text: 'old laptop', updatedAt: '2026-09-17T12:00:00.000Z' } },
    );

    const gone = view.rows.find((row) => row.status === 'gone');
    expect(gone?.note).toBe('old laptop');
  });
});
