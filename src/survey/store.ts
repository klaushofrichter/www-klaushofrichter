import { promises as fs } from 'fs';
import path from 'path';
import { NotesStore, SavedSurvey } from './types';

const LATEST = 'latest.json';
const NOTES = 'notes.json';

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

// Shared by both stores: read a JSON file, or null if it doesn't exist yet.
// Parsing/shape validation is the caller's job, so each store keeps its own
// "what does corrupt mean" decision.
async function readJsonFile(dir: string, filename: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, filename), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  return JSON.parse(raw);
}

// Shared by both stores: written to a temporary file in the same directory
// and renamed into place. rename() within one filesystem is atomic, so a
// crash mid-write leaves either the old file or the new one, never half of
// each.
async function writeJsonFileAtomic(dir: string, filename: string, data: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, filename);
  const temp = path.join(dir, `.${filename}.${process.pid}.${Date.now()}.tmp`);
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
  return raw === null ? null : assertSavedSurvey(raw);
}

export async function writeSavedSurvey(survey: SavedSurvey, dir: string = surveyDir()): Promise<void> {
  await writeJsonFileAtomic(dir, LATEST, survey);
}

// Notes are facts about a device (identified by MAC), not about a scan
// snapshot, so they live in their own file and are never touched by a scan
// save. A missing file reads as "no notes"; see assertNotesStore for why a
// corrupt one must throw instead.
export async function readNotes(dir: string = surveyDir()): Promise<NotesStore> {
  const raw = await readJsonFile(dir, NOTES);
  return raw === null ? {} : assertNotesStore(raw);
}

export async function writeNotes(notes: NotesStore, dir: string = surveyDir()): Promise<void> {
  await writeJsonFileAtomic(dir, NOTES, notes);
}
