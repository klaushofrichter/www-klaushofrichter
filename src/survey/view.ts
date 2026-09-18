import { Device, NotesStore, SavedSurvey, ScanResult, SurveyRow, SurveyRowStatus, SurveyView } from './types';

const STATUS_RANK: Record<SurveyRowStatus, number> = { new: 0, unchanged: 1, gone: 2 };

export function ipToNumber(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function toRow(device: Device, status: SurveyRowStatus): SurveyRow {
  // note is filled in by attachNotes once the full row set (including 'gone'
  // rows) exists; a bare toRow has none yet.
  return { ...device, status, ipNum: ipToNumber(device.ip), statusRank: STATUS_RANK[status], note: null };
}

// Keyed on MAC, not IP: DHCP can hand the same device a different address
// between scans, and an IP match would then report one device as both new and
// gone. Exported so the notes route can normalize a MAC the same way before
// looking it up or storing it.
export function macKey(mac: string): string {
  return mac.toLowerCase();
}

// Merges notes onto rows by MAC, including 'gone' rows: a device that
// disappears from a scan keeps its note so it reappears if the device does.
function attachNotes(rows: SurveyRow[], notes: NotesStore): SurveyRow[] {
  return rows.map((row) => ({ ...row, note: notes[macKey(row.mac)]?.text ?? null }));
}

export function compareToSaved(current: Device[], saved: Device[] | null): SurveyRow[] {
  if (!saved) {
    return current.map((device) => toRow(device, 'unchanged'));
  }
  const savedMacs = new Set(saved.map((device) => macKey(device.mac)));
  const currentMacs = new Set(current.map((device) => macKey(device.mac)));
  const rows = current.map((device) => toRow(device, savedMacs.has(macKey(device.mac)) ? 'unchanged' : 'new'));
  for (const device of saved) {
    if (!currentMacs.has(macKey(device.mac))) {
      rows.push(toRow(device, 'gone'));
    }
  }
  return rows;
}

function countRows(rows: SurveyRow[]): SurveyView['counts'] {
  return {
    devices: rows.filter((row) => row.status !== 'gone').length,
    new: rows.filter((row) => row.status === 'new').length,
    gone: rows.filter((row) => row.status === 'gone').length,
  };
}

export function buildSurveyView(
  finishedScan: ScanResult | null,
  saved: SavedSurvey | null,
  notes: NotesStore = {},
): SurveyView {
  // A finished scan is "unsaved" until a saved survey carries its timestamp.
  if (finishedScan && (!saved || saved.scannedAt !== finishedScan.scannedAt)) {
    const rows = attachNotes(compareToSaved(finishedScan.devices, saved ? saved.devices : null), notes);
    return {
      source: 'scan',
      scannedAt: finishedScan.scannedAt,
      savedAt: null,
      unsaved: true,
      rows,
      counts: countRows(rows),
    };
  }
  if (saved) {
    const rows = attachNotes(saved.devices.map((device) => toRow(device, 'unchanged')), notes);
    return {
      source: 'saved',
      scannedAt: saved.scannedAt,
      savedAt: saved.savedAt,
      unsaved: false,
      rows,
      counts: countRows(rows),
    };
  }
  return { source: 'none', scannedAt: null, savedAt: null, unsaved: false, rows: [], counts: { devices: 0, new: 0, gone: 0 } };
}
