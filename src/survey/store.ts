import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';
import { NotesStore, SavedSurvey } from './types';

const LATEST = 'latest.json';
const NOTES = 'notes.json';

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
  for (const [mac, entry] of Object.entries(value as Record<string, unknown>)) {
    const e = entry as { text?: unknown; updatedAt?: unknown } | null;
    if (typeof mac !== 'string' || !e || typeof e.text !== 'string' || typeof e.updatedAt !== 'string') {
      throw new Error('Saved notes are malformed: an entry is missing text or updatedAt');
    }
  }
  return value as NotesStore;
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

export async function updateNotes<T>(
  mutator: (notes: NotesStore) => T,
  dir: string = surveyDir(),
): Promise<T> {
  const run = notesQueue.then(async () => {
    const notes = await readNotes(dir);
    const result = mutator(notes);
    await writeNotes(notes, dir);
    return result;
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
