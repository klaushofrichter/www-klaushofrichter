import { promises as fs } from 'fs';
import path from 'path';
import { SavedSurvey } from './types';

const LATEST = 'latest.json';

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

// dist/survey/store.js -> /app/data/surveys in the image, where the www-data
// PVC is mounted. SURVEY_DIR overrides it for tests, CI and local runs.
export function surveyDir(): string {
  return process.env.SURVEY_DIR ?? path.join(__dirname, '..', '..', 'data', 'surveys');
}

export async function readSavedSurvey(dir: string = surveyDir()): Promise<SavedSurvey | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, LATEST), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  // A corrupt file throws instead of reading as "nothing saved": treating it
  // as empty would let the next save silently overwrite whatever is left.
  return assertSavedSurvey(JSON.parse(raw));
}

// Written to a temporary file in the same directory and renamed into place.
// rename() within one filesystem is atomic, so a crash mid-save leaves either
// the old survey or the new one, never half of each.
export async function writeSavedSurvey(survey: SavedSurvey, dir: string = surveyDir()): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, LATEST);
  const temp = path.join(dir, `.${LATEST}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(survey, null, 2), 'utf8');
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}
