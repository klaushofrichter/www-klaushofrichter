import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readNotes, readSavedSurvey, RejectNotesUpdate, updateNotes, writeNotes, writeSavedSurvey } from '../src/survey/store';
import { NotesStore, SavedSurvey } from '../src/survey/types';

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

  it('throws when the saved file has no devices array', async () => {
    await fs.writeFile(
      path.join(dir, 'latest.json'),
      JSON.stringify({ scannedAt: 'x', savedAt: 'y', cidr: 'z', version: 'dev' }),
    );

    await expect(readSavedSurvey(dir)).rejects.toThrow(/devices/);
  });

  it('throws when a saved device is missing its mac', async () => {
    await fs.writeFile(
      path.join(dir, 'latest.json'),
      JSON.stringify({ scannedAt: 'x', savedAt: 'y', cidr: 'z', version: 'dev', devices: [{ ip: '192.168.1.2' }] }),
    );

    await expect(readSavedSurvey(dir)).rejects.toThrow(/devices/);
  });

  it('throws on a file containing literal null rather than reading it as nothing saved', async () => {
    await fs.writeFile(path.join(dir, 'latest.json'), 'null');

    await expect(readSavedSurvey(dir)).rejects.toThrow();
  });

  it('writes concurrent saves under distinct temp names, leaving no leftovers', async () => {
    await Promise.all([
      writeSavedSurvey(survey('2026-09-17T12:00:00.000Z'), dir),
      writeSavedSurvey(survey('2026-09-17T12:00:01.000Z'), dir),
      writeSavedSurvey(survey('2026-09-17T12:00:02.000Z'), dir),
    ]);

    expect(await fs.readdir(dir)).toEqual(['latest.json']);
    await expect(readSavedSurvey(dir)).resolves.not.toBeNull();
  });
});

describe('notes store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-store-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads as empty when nothing has been saved, not as an error', async () => {
    await expect(readNotes(dir)).resolves.toEqual({});
  });

  it('round-trips notes keyed by MAC', async () => {
    const notes: NotesStore = { 'aa:bb:cc:dd:ee:ff': { text: 'kitchen printer', updatedAt: '2026-09-17T12:00:00.000Z' } };

    await writeNotes(notes, dir);

    await expect(readNotes(dir)).resolves.toEqual(notes);
  });

  it('creates the directory if it does not exist', async () => {
    const nested = path.join(dir, 'a', 'b');

    await writeNotes({ 'aa:bb:cc:dd:ee:ff': { text: 'x', updatedAt: 'y' } }, nested);

    await expect(readNotes(nested)).resolves.not.toEqual({});
  });

  it('replaces the previous notes file and leaves no temporary files, alongside a survey file', async () => {
    await writeNotes({ 'aa:bb:cc:dd:ee:01': { text: 'first', updatedAt: 'a' } }, dir);
    await writeNotes({ 'aa:bb:cc:dd:ee:02': { text: 'second', updatedAt: 'b' } }, dir);

    await expect(readNotes(dir)).resolves.toEqual({ 'aa:bb:cc:dd:ee:02': { text: 'second', updatedAt: 'b' } });
    expect(await fs.readdir(dir)).toEqual(['notes.json']);
  });

  it('cleans up its temporary file when the final rename fails', async () => {
    await fs.mkdir(path.join(dir, 'notes.json'));
    await fs.writeFile(path.join(dir, 'notes.json', 'blocker'), 'x');

    await expect(writeNotes({ 'aa:bb:cc:dd:ee:ff': { text: 'x', updatedAt: 'y' } }, dir)).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['notes.json']);
  });

  it('throws on a corrupt file rather than pretending nothing was saved', async () => {
    await fs.writeFile(path.join(dir, 'notes.json'), '{ not json');

    await expect(readNotes(dir)).rejects.toThrow();
  });

  it('throws when an entry is missing text or updatedAt', async () => {
    await fs.writeFile(path.join(dir, 'notes.json'), JSON.stringify({ 'aa:bb:cc:dd:ee:ff': { text: 'x' } }));

    await expect(readNotes(dir)).rejects.toThrow(/text or updatedAt/);
  });

  it('throws when the file is an array rather than a map', async () => {
    await fs.writeFile(path.join(dir, 'notes.json'), JSON.stringify([{ text: 'x', updatedAt: 'y' }]));

    await expect(readNotes(dir)).rejects.toThrow();
  });

  it('throws on a file containing literal null rather than reading it as no notes', async () => {
    await fs.writeFile(path.join(dir, 'notes.json'), 'null');

    await expect(readNotes(dir)).rejects.toThrow();
  });

  describe('updateNotes', () => {
    it('serializes concurrent read-modify-write updates so no update is lost', async () => {
      await writeNotes({}, dir);
      const macs = Array.from({ length: 10 }, (_, i) => `aa:bb:cc:dd:ee:${i.toString(16).padStart(2, '0')}`);

      await Promise.all(
        macs.map((mac) => updateNotes((notes) => {
          notes[mac] = { text: mac, updatedAt: 'now' };
        }, dir)),
      );

      const notes = await readNotes(dir);
      for (const mac of macs) {
        expect(notes[mac]).toEqual({ text: mac, updatedAt: 'now' });
      }
    });

    it('leaves the store untouched when the mutator rejects the update, but still runs later updates', async () => {
      await writeNotes({ 'aa:bb:cc:dd:ee:ff': { text: 'kept', updatedAt: 'y' } }, dir);

      const rejected = updateNotes(() => {
        throw new RejectNotesUpdate('nope');
      }, dir);
      const accepted = updateNotes((notes) => {
        notes['aa:bb:cc:dd:ee:00'] = { text: 'new', updatedAt: 'z' };
      }, dir);

      await expect(rejected).rejects.toThrow(RejectNotesUpdate);
      await accepted;

      await expect(readNotes(dir)).resolves.toEqual({
        'aa:bb:cc:dd:ee:ff': { text: 'kept', updatedAt: 'y' },
        'aa:bb:cc:dd:ee:00': { text: 'new', updatedAt: 'z' },
      });
    });
  });
});
