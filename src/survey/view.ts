import { Device, KnownDevicesStore, NotesStore, SavedSurvey, ScanResult, SurveyRow, SurveyRowStatus, SurveyView } from './types';

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
  return {
    ...device, status, ipNum: ipToNumber(device.ip), statusRank: STATUS_RANK[status], note: null, lastSeenAt: null,
  };
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

// Status of each device in the current list: 'new' if the saved survey does
// not have it, otherwise 'unchanged'. With no saved survey there is nothing to
// compare with, so nothing is new. 'gone' rows are not produced here; see
// goneRows.
export function compareToSaved(current: Device[], saved: Device[] | null): SurveyRow[] {
  if (!saved) {
    return current.map((device) => toRow(device, 'unchanged'));
  }
  const savedMacs = new Set(saved.map((device) => macKey(device.mac)));
  return current.map((device) => toRow(device, savedMacs.has(macKey(device.mac)) ? 'unchanged' : 'new'));
}

// A 'gone' row for every known device missing from the current list, whether
// that list is a saved survey or an unsaved scan. Known devices are the only
// source of 'gone' rows -- the saved survey's devices are all in the store
// already -- so a device can never appear twice, and one removed from the
// store stays off the page even while latest.json still lists it. Rows keep
// the last-seen IP even if another device holds it now: they are matched by
// MAC, never by address.
export function goneRows(current: Device[], known: KnownDevicesStore): SurveyRow[] {
  const currentMacs = new Set(current.map((device) => macKey(device.mac)));
  const rows: SurveyRow[] = [];
  for (const [mac, entry] of Object.entries(known)) {
    if (currentMacs.has(mac)) continue;
    const device: Device = {
      ip: entry.ip, mac, vendor: entry.vendor, privateMac: entry.privateMac, name: entry.name,
      nameSource: entry.nameSource, web: null, services: [], ports: [], rttMs: null,
    };
    rows.push({ ...toRow(device, 'gone'), lastSeenAt: entry.lastSeenAt });
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
  known: KnownDevicesStore = {},
): SurveyView {
  const rowsFor = (current: Device[], savedDevices: Device[] | null) =>
    attachNotes([...compareToSaved(current, savedDevices), ...goneRows(current, known)], notes);

  // A finished scan is unsaved (source 'scan') until a saved survey carries
  // its timestamp.
  if (finishedScan && (!saved || saved.scannedAt !== finishedScan.scannedAt)) {
    const rows = rowsFor(finishedScan.devices, saved ? saved.devices : null);
    return {
      source: 'scan',
      scannedAt: finishedScan.scannedAt,
      savedAt: null,
      hasSaved: saved !== null,
      rows,
      counts: countRows(rows),
    };
  }
  if (saved) {
    // Compared with itself, so every current row is 'unchanged'.
    const rows = rowsFor(saved.devices, saved.devices);
    return {
      source: 'saved',
      scannedAt: saved.scannedAt,
      savedAt: saved.savedAt,
      hasSaved: true,
      rows,
      counts: countRows(rows),
    };
  }
  const rows = rowsFor([], null);
  return {
    source: 'none', scannedAt: null, savedAt: null, hasSaved: false, rows,
    counts: countRows(rows),
  };
}
