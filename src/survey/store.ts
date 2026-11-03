import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';
import { KnownDevice, KnownDevicesStore, NotesStore, SavedSurvey, ScanResult } from './types';

const LATEST = 'latest.json';
const NOTES = 'notes.json';
const KNOWN_DEVICES = 'known-devices.json';

// A value distinct from anything JSON.parse can produce (including the
// literal `null`), so "no file yet" and "file contains null" can't collide.
const NOT_FOUND = Symbol('survey-store:not-found');

// Reached through a different door than the scanner client, but the same gap:
// a device without ip/mac throws in compareToSaved on every later request
// once it's on disk, so corrupt or malformed saves must fail loudly here too.
function assertSavedSurvey(value: unknown): SavedSurvey {
  const survey = value as SavedSurvey | null;
  if (!survey || !Array.isArray(survey.devices)) {
    throw new Error('Saved survey is malformed: devices is not an array');
  }
  for (const device of survey.devices) {
    if (typeof device?.ip !== 'string' || typeof device?.mac !== 'string') {
      throw new Error('Saved survey is malformed: devices contains an entry missing ip or mac');
    }
  }
  return survey;
}

// A corrupt notes.json must throw rather than read as "no notes": treating it
// as empty would let the very next save silently destroy every note that
// survived on disk.
function assertNotesStore(value: unknown): NotesStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Saved notes are malformed: not an object');
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const e = entry as { text?: unknown; updatedAt?: unknown } | null;
    if (!e || typeof e.text !== 'string' || typeof e.updatedAt !== 'string') {
      throw new Error('Saved notes are malformed: an entry is missing text or updatedAt');
    }
  }
  return value as NotesStore;
}

const KNOWN_MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const NAME_SOURCES = new Set(['mdns', 'ssdp', 'dns']);

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

// Same reasoning as notes: a corrupt known-devices.json must throw, never
// read as "no known devices", or the next save would rebuild it from that
// one scan and every offline device would be forgotten for good. Keys must
// already be lowercase MACs (macKey), since a mixed-case duplicate would show
// one device as two rows.
function assertKnownDevicesStore(value: unknown): KnownDevicesStore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Known devices are malformed: not an object');
  }
  for (const [mac, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_MAC_RE.test(mac)) {
      throw new Error('Known devices are malformed: a key is not a lowercase MAC address');
    }
    const e = entry as Partial<Record<keyof KnownDevice, unknown>> | null;
    if (
      !e
      || typeof e.ip !== 'string'
      || !isStringOrNull(e.name)
      || !(e.nameSource === null || (typeof e.nameSource === 'string' && NAME_SOURCES.has(e.nameSource)))
      || !isStringOrNull(e.vendor)
      || typeof e.privateMac !== 'boolean'
      || typeof e.lastSeenAt !== 'string'
      || Number.isNaN(Date.parse(e.lastSeenAt))
    ) {
      throw new Error('Known devices are malformed: an entry has a missing or invalid field');
    }
  }
  return value as KnownDevicesStore;
}

// dist/survey/store.js -> /app/data/surveys in the image, where the www-data
// PVC is mounted. SURVEY_DIR overrides it for tests, CI and local runs.
export function surveyDir(): string {
  return process.env.SURVEY_DIR ?? path.join(__dirname, '..', '..', 'data', 'surveys');
}

// Shared by both stores: read a JSON file, or NOT_FOUND if it doesn't exist
// yet. Parsing/shape validation is the caller's job, so each store keeps its
// own "what does corrupt mean" decision -- including a file that parses fine
// but holds the literal `null`, which must reach that validation rather than
// being mistaken for a missing file.
async function readJsonFile(dir: string, filename: string): Promise<unknown | typeof NOT_FOUND> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, filename), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NOT_FOUND;
    }
    throw err;
  }
  return JSON.parse(raw);
}

// A counter plus randomness, on top of pid and a millisecond timestamp: two
// saves in the same process can land in the same millisecond (notes save on
// blur, and tabbing across rows in a fast UI really does fire two POSTs
// close together), and a colliding temp path would let one writeFile's bytes
// land inside the other's, corrupting whatever gets renamed into place.
let tempNameCounter = 0;

// Shared by both stores: written to a temporary file in the same directory
// and renamed into place. rename() within one filesystem is atomic, so a
// crash mid-write leaves either the old file or the new one, never half of
// each.
async function writeJsonFileAtomic(dir: string, filename: string, data: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, filename);
  tempNameCounter += 1;
  const unique = `${process.pid}.${Date.now()}.${tempNameCounter}.${crypto.randomBytes(6).toString('hex')}`;
  const temp = path.join(dir, `.${filename}.${unique}.tmp`);
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

export async function readSavedSurvey(dir: string = surveyDir()): Promise<SavedSurvey | null> {
  const raw = await readJsonFile(dir, LATEST);
  // A corrupt file throws instead of reading as "nothing saved": treating it
  // as empty would let the next save silently overwrite whatever is left.
  // That includes a file containing the literal `null` -- it parses fine but
  // must fall through to the shape check below, which rejects it, rather
  // than being treated the same as no file at all.
  return raw === NOT_FOUND ? null : assertSavedSurvey(raw);
}

export async function writeSavedSurvey(survey: SavedSurvey, dir: string = surveyDir()): Promise<void> {
  await writeJsonFileAtomic(dir, LATEST, survey);
}

// Notes are facts about a device (identified by MAC), not about a scan
// snapshot, so they live in their own file and are never touched by a scan
// save. A missing file reads as "no notes"; see assertNotesStore for why a
// corrupt one -- including a literal `null` -- must throw instead.
export async function readNotes(dir: string = surveyDir()): Promise<NotesStore> {
  const raw = await readJsonFile(dir, NOTES);
  return raw === NOT_FOUND ? {} : assertNotesStore(raw);
}

export async function writeNotes(notes: NotesStore, dir: string = surveyDir()): Promise<void> {
  await writeJsonFileAtomic(dir, NOTES, notes);
}

// Thrown by an updateNotes mutator to abort the update without writing --
// used by the route for "reject this note, don't persist it" (e.g. the
// store is already at its cap) so the queue below still serializes the
// read-modify-write without ever performing this particular write.
export class RejectNotesUpdate extends Error {}

// Notes save on blur, so tabbing across several rows fires overlapping
// POSTs. Without serialization this is a classic read-modify-write race:
// two requests can both read the same on-disk notes, apply their own
// change, and write back -- the second write wins and the first request's
// note silently vanishes. Chaining every update through one promise means
// each read-modify-write runs to completion before the next one starts.
// There is a single replica, so an in-process queue is enough; it would not
// serialize across replicas.
let notesQueue: Promise<unknown> = Promise.resolve();

export async function updateNotes(
  mutator: (notes: NotesStore) => void,
  dir: string = surveyDir(),
): Promise<void> {
  const run = notesQueue.then(async () => {
    const notes = await readNotes(dir);
    mutator(notes);
    await writeNotes(notes, dir);
  });
  // Keep the queue alive even when this update rejects (a malformed store,
  // or the mutator throwing RejectNotesUpdate): a later queued update must
  // still run. The rejection itself still propagates to this call's caller
  // via `run`.
  notesQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Known devices -- see KnownDevice in types.ts.

export const MAX_KNOWN_DEVICES = 1000;
// Rotating (private) addresses mint a new "device" every so often, so they
// are dropped automatically once unseen for this long. Every other entry stays
// until it is removed by hand.
export const PRIVATE_MAC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Lowercased here rather than imported from view.ts so the store does not
// depend on the view; it must match macKey there.
function knownKey(mac: string): string {
  return mac.toLowerCase();
}

function knownEntry(device: ScanResult['devices'][number], lastSeenAt: string): KnownDevice {
  return {
    ip: device.ip,
    name: device.name,
    nameSource: device.nameSource,
    vendor: device.vendor,
    privateMac: device.privateMac,
    lastSeenAt,
  };
}

// Builds the store from a saved survey, for an installation that has a
// latest.json from before known-devices.json existed. Only the saved survey
// is used: notes and backups say nothing reliable about what was online.
export function seedKnownDevices(saved: SavedSurvey | null): KnownDevicesStore {
  const known: KnownDevicesStore = {};
  if (saved) {
    for (const device of saved.devices) {
      const mac = knownKey(device.mac);
      if (KNOWN_MAC_RE.test(mac)) known[mac] = knownEntry(device, saved.scannedAt);
    }
  }
  return known;
}

// Applies a saved scan to the store, in place: every device in it is
// (re)recorded with the scan's time, private-MAC entries unseen for over 30
// days are pruned, and if the store is still over the cap the entries seen
// longest ago are evicted. A device in this scan is never evicted.
export function recordScan(known: KnownDevicesStore, scan: ScanResult, now: Date): void {
  const current = new Set<string>();
  for (const device of scan.devices) {
    const mac = knownKey(device.mac);
    // A scanner-reported MAC that is not one is skipped rather than stored:
    // the read-side check would otherwise reject the whole file on the next
    // request, and a key like "__proto__" must never be assigned.
    if (!KNOWN_MAC_RE.test(mac)) continue;
    current.add(mac);
    known[mac] = knownEntry(device, scan.scannedAt);
  }
  const cutoff = now.getTime() - PRIVATE_MAC_RETENTION_MS;
  for (const [mac, entry] of Object.entries(known)) {
    if (!current.has(mac) && entry.privateMac && Date.parse(entry.lastSeenAt) < cutoff) {
      delete known[mac];
    }
  }
  const excess = Object.keys(known).length - MAX_KNOWN_DEVICES;
  if (excess > 0) {
    Object.entries(known)
      .filter(([mac]) => !current.has(mac))
      .sort(([, a], [, b]) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt))
      .slice(0, excess)
      .forEach(([mac]) => delete known[mac]);
  }
}

// null when the file does not exist yet; a corrupt file throws.
export async function readKnownDevices(dir: string = surveyDir()): Promise<KnownDevicesStore | null> {
  const raw = await readJsonFile(dir, KNOWN_DEVICES);
  return raw === NOT_FOUND ? null : assertKnownDevicesStore(raw);
}

export async function writeKnownDevices(known: KnownDevicesStore, dir: string = surveyDir()): Promise<void> {
  await writeJsonFileAtomic(dir, KNOWN_DEVICES, known);
}

// What the page should treat as known: the stored file, or -- until the first
// save after this feature shipped creates it -- the same seed that save will
// write, so offline devices from the saved survey are not hidden meanwhile.
export async function loadKnownDevices(
  dir: string = surveyDir(),
  saved?: SavedSurvey | null,
): Promise<KnownDevicesStore> {
  const known = await readKnownDevices(dir);
  if (known) {
    return known;
  }
  return seedKnownDevices(saved === undefined ? await readSavedSurvey(dir) : saved);
}

// Saves and removals both read-modify-write known-devices.json, and a save
// also replaces latest.json, which a missing known-devices.json is seeded
// from. One in-process queue (single replica, as with notes) runs them one at
// a time, so a removal cannot be undone by a save that read the store before
// it, and a seed always comes from the latest.json that is about to be
// replaced, never from the new one.
let knownQueue: Promise<unknown> = Promise.resolve();

function enqueueKnown<T>(task: () => Promise<T>): Promise<T> {
  const run = knownQueue.then(task);
  knownQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Records the scan in known-devices.json first, then replaces latest.json.
// In that order, a failure between the two leaves the old latest.json beside
// a store that already knows the new scan -- harmless -- whereas the other
// order could seed a missing store from the new scan and lose the devices
// that only the old one had.
export async function saveSurvey(survey: SavedSurvey, now: Date, dir: string = surveyDir()): Promise<void> {
  return enqueueKnown(async () => {
    const known = await loadKnownDevices(dir);
    recordScan(known, survey, now);
    await writeKnownDevices(known, dir);
    await writeSavedSurvey(survey, dir);
  });
}

// Removes one device from the list. Its note is deliberately left alone:
// notes are typed by hand and cannot be regenerated, and it reappears if the
// device comes back. Removing a MAC that is not known is not an error, so a
// double click or a second tab is harmless.
export async function removeKnownDevice(mac: string, dir: string = surveyDir()): Promise<void> {
  return enqueueKnown(async () => {
    const known = await loadKnownDevices(dir);
    delete known[knownKey(mac)];
    await writeKnownDevices(known, dir);
  });
}
