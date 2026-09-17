import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readSavedSurvey, writeSavedSurvey } from '../src/survey/store';
import { SavedSurvey } from '../src/survey/types';

function survey(scannedAt: string): SavedSurvey {
  return {
    scannedAt,
    savedAt: '2026-09-17T12:05:00.000Z',
    cidr: '192.168.1.0/24',
    version: 'dev',
    devices: [],
  };
}

describe('survey store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-store-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null when nothing has been saved', async () => {
    await expect(readSavedSurvey(dir)).resolves.toBeNull();
  });

  it('round-trips a saved survey', async () => {
    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir);

    await expect(readSavedSurvey(dir)).resolves.toEqual(survey('2026-09-17T12:00:00.000Z'));
  });

  it('creates the directory if it does not exist', async () => {
    const nested = path.join(dir, 'a', 'b');

    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), nested);

    await expect(readSavedSurvey(nested)).resolves.not.toBeNull();
  });

  it('replaces the previous survey and leaves no temporary files', async () => {
    await writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir);
    await writeSavedSurvey(survey('2026-09-17T13:00:00.000Z'), dir);

    expect((await readSavedSurvey(dir))?.scannedAt).toBe('2026-09-17T13:00:00.000Z');
    expect(await fs.readdir(dir)).toEqual(['latest.json']);
  });

  it('cleans up its temporary file when the final rename fails', async () => {
    // A non-empty directory where latest.json should be makes rename() fail.
    await fs.mkdir(path.join(dir, 'latest.json'));
    await fs.writeFile(path.join(dir, 'latest.json', 'blocker'), 'x');

    await expect(writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['latest.json']);
  });

  it('throws on a corrupt file rather than pretending nothing was saved', async () => {
    await fs.writeFile(path.join(dir, 'latest.json'), '{ not json');

    await expect(readSavedSurvey(dir)).rejects.toThrow();
  });
});
