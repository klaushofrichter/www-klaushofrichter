import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  loadKnownDevices,
  MAX_KNOWN_DEVICES,
  readKnownDevices,
  readNotes,
  readSavedSurvey,
  recordScan,
  RejectNotesUpdate,
  removeKnownDevice,
  saveSurvey,
  updateNotes,
  writeKnownDevices,
  writeNotes,
  writeSavedSurvey,
} from '../src/survey/store';
import { Device, KnownDevicesStore, NotesStore, SavedSurvey } from '../src/survey/types';
import { makeDevice } from './helpers';

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

describe('known devices store', () => {
  let dir: string;
  const NOW = new Date('2026-11-03T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  function savedWith(devices: Device[], scannedAt: string): SavedSurvey {
    return { scannedAt, savedAt: scannedAt, cidr: '192.168.1.0/24', version: 'dev', devices };
  }

  function daysAgo(days: number): string {
    return new Date(NOW.getTime() - days * DAY).toISOString();
  }

  function entry(ip: string, lastSeenAt: string, privateMac = false) {
    return { ip, name: null, nameSource: null, vendor: null, privateMac, lastSeenAt };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'known-store-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads as null when the file does not exist yet', async () => {
    await expect(readKnownDevices(dir)).resolves.toBeNull();
  });

  it('round-trips the store', async () => {
    const known: KnownDevicesStore = { 'aa:bb:cc:dd:ee:ff': entry('192.168.1.2', daysAgo(1)) };

    await writeKnownDevices(known, dir);

    await expect(readKnownDevices(dir)).resolves.toEqual(known);
  });

  it.each([
    ['not JSON', '{ not json'],
    ['literal null', 'null'],
    ['an array', '[]'],
    ['an entry missing its ip', JSON.stringify({ 'aa:bb:cc:dd:ee:ff': { lastSeenAt: '2026-11-01T00:00:00Z', privateMac: false } })],
    ['an unparseable lastSeenAt', JSON.stringify({ 'aa:bb:cc:dd:ee:ff': { ...entry('1.2.3.4', 'x') } })],
    ['an uppercase key', JSON.stringify({ 'AA:BB:CC:DD:EE:FF': entry('1.2.3.4', '2026-11-01T00:00:00Z') })],
    ['a key that is not a MAC', JSON.stringify({ __proto__x: entry('1.2.3.4', '2026-11-01T00:00:00Z') })],
    ['an unknown nameSource', JSON.stringify({ 'aa:bb:cc:dd:ee:ff': { ...entry('1.2.3.4', '2026-11-01T00:00:00Z'), nameSource: 'x' } })],
  ])('throws on a corrupt file (%s) rather than reading it as empty', async (_label, content) => {
    await fs.writeFile(path.join(dir, 'known-devices.json'), content);

    await expect(readKnownDevices(dir)).rejects.toThrow();
    await expect(loadKnownDevices(dir)).rejects.toThrow();
  });

  it('refuses to save over a corrupt store, and leaves latest.json alone', async () => {
    await writeSavedSurvey(savedWith([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')], daysAgo(1)), dir);
    await fs.writeFile(path.join(dir, 'known-devices.json'), '{ not json');

    await expect(saveSurvey(savedWith([], daysAgo(0)), NOW, dir)).rejects.toThrow();

    expect((await readSavedSurvey(dir))?.devices).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, 'known-devices.json'), 'utf8')).toBe('{ not json');
  });

  it('loads a seed from latest.json, in memory only, until the file exists', async () => {
    const scannedAt = daysAgo(2);
    await writeSavedSurvey(savedWith([makeDevice('192.168.1.2', 'AA:AA:AA:AA:AA:01', 'printer')], scannedAt), dir);

    await expect(loadKnownDevices(dir)).resolves.toEqual({
      'aa:aa:aa:aa:aa:01': { ...entry('192.168.1.2', scannedAt), name: 'printer' },
    });
    await expect(readKnownDevices(dir)).resolves.toBeNull();
  });

  it('seeds from the latest.json being replaced, so devices only it had are kept', async () => {
    const oldScan = daysAgo(3);
    await writeSavedSurvey(savedWith([
      makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'),
      makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02'),
    ], oldScan), dir);
    // Notes are never a seed source.
    await writeNotes({ 'aa:aa:aa:aa:aa:99': { text: 'only a note', updatedAt: 'x' } }, dir);

    const newScan = daysAgo(0);
    await saveSurvey(savedWith([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')], newScan), NOW, dir);

    await expect(readKnownDevices(dir)).resolves.toEqual({
      'aa:aa:aa:aa:aa:01': entry('192.168.1.2', newScan),
      'aa:aa:aa:aa:aa:02': entry('192.168.1.3', oldScan),
    });
    expect((await readSavedSurvey(dir))?.scannedAt).toBe(newScan);
  });

  it('updates the last-seen IP, name and time of a device on each save', async () => {
    await saveSurvey(savedWith([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01', 'old')], daysAgo(5)), NOW, dir);
    await saveSurvey(savedWith([makeDevice('192.168.1.40', 'aa:aa:aa:aa:aa:01', 'new')], daysAgo(0)), NOW, dir);

    await expect(readKnownDevices(dir)).resolves.toEqual({
      'aa:aa:aa:aa:aa:01': { ...entry('192.168.1.40', daysAgo(0)), name: 'new' },
    });
  });

  it('prunes private-MAC entries unseen for over 30 days at save time, and keeps every other entry', async () => {
    await writeKnownDevices({
      'aa:aa:aa:aa:aa:01': entry('192.168.1.2', daysAgo(31), true),
      'aa:aa:aa:aa:aa:02': entry('192.168.1.3', daysAgo(29), true),
      'aa:aa:aa:aa:aa:03': entry('192.168.1.4', daysAgo(400), false),
    }, dir);

    await saveSurvey(savedWith([], daysAgo(0)), NOW, dir);

    expect(Object.keys((await readKnownDevices(dir))!).sort()).toEqual(['aa:aa:aa:aa:aa:02', 'aa:aa:aa:aa:aa:03']);
  });

  it('does not prune a private-MAC device that is in the scan being saved', () => {
    const known: KnownDevicesStore = { 'aa:aa:aa:aa:aa:01': entry('192.168.1.2', daysAgo(60), true) };
    const device = { ...makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'), privateMac: true };

    recordScan(known, savedWith([device], daysAgo(0)), NOW);

    expect(known['aa:aa:aa:aa:aa:01'].lastSeenAt).toBe(daysAgo(0));
  });

  it('caps the store by evicting the entries seen longest ago, never one in the current scan', () => {
    const known: KnownDevicesStore = {};
    for (let i = 0; i < MAX_KNOWN_DEVICES; i += 1) {
      const hi = Math.floor(i / 256).toString(16).padStart(2, '0');
      const lo = (i % 256).toString(16).padStart(2, '0');
      // i = 0 is the oldest.
      known[`aa:bb:cc:dd:${hi}:${lo}`] = entry('10.0.0.1', new Date(NOW.getTime() - (MAX_KNOWN_DEVICES - i) * 60_000).toISOString());
    }

    recordScan(known, savedWith([
      makeDevice('192.168.1.2', 'de:ad:be:ef:00:01'),
      makeDevice('192.168.1.3', 'de:ad:be:ef:00:02'),
    ], NOW.toISOString()), NOW);

    expect(Object.keys(known)).toHaveLength(MAX_KNOWN_DEVICES);
    expect(known['aa:bb:cc:dd:00:00']).toBeUndefined();
    expect(known['aa:bb:cc:dd:00:01']).toBeUndefined();
    expect(known['aa:bb:cc:dd:00:02']).toBeDefined();
    expect(known['de:ad:be:ef:00:01']).toBeDefined();
    expect(known['de:ad:be:ef:00:02']).toBeDefined();
  });

  it('skips a scanner MAC that is not a MAC address rather than storing it', () => {
    const known: KnownDevicesStore = {};

    recordScan(known, savedWith([makeDevice('192.168.1.2', '__proto__')], NOW.toISOString()), NOW);

    expect(Object.keys(known)).toEqual([]);
    expect(Object.getPrototypeOf(known)).toBe(Object.prototype);
  });

  it('removes a device and leaves its note alone', async () => {
    await saveSurvey(savedWith([
      makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'),
      makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02'),
    ], daysAgo(0)), NOW, dir);
    await writeNotes({ 'aa:aa:aa:aa:aa:02': { text: 'keep me', updatedAt: 'x' } }, dir);

    await removeKnownDevice('AA:AA:AA:AA:AA:02', dir);

    expect(Object.keys((await readKnownDevices(dir))!)).toEqual(['aa:aa:aa:aa:aa:01']);
    await expect(readNotes(dir)).resolves.toEqual({ 'aa:aa:aa:aa:aa:02': { text: 'keep me', updatedAt: 'x' } });
  });

  it('removing before the store exists seeds it first, so the removal sticks', async () => {
    await writeSavedSurvey(savedWith([
      makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'),
      makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02'),
    ], daysAgo(1)), dir);

    await removeKnownDevice('aa:aa:aa:aa:aa:02', dir);

    expect(Object.keys((await loadKnownDevices(dir)))).toEqual(['aa:aa:aa:aa:aa:01']);
  });

  it('serializes saves and removals so neither undoes the other', async () => {
    await saveSurvey(savedWith([
      makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01'),
      makeDevice('192.168.1.3', 'aa:aa:aa:aa:aa:02'),
      makeDevice('192.168.1.4', 'aa:aa:aa:aa:aa:03'),
    ], daysAgo(1)), NOW, dir);

    await Promise.all([
      removeKnownDevice('aa:aa:aa:aa:aa:02', dir),
      saveSurvey(savedWith([makeDevice('192.168.1.2', 'aa:aa:aa:aa:aa:01')], daysAgo(0)), NOW, dir),
      removeKnownDevice('aa:aa:aa:aa:aa:03', dir),
    ]);

    expect(Object.keys((await readKnownDevices(dir))!)).toEqual(['aa:aa:aa:aa:aa:01']);
    expect((await fs.readdir(dir)).sort()).toEqual(['known-devices.json', 'latest.json']);
  });
});
