import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createSurveyRouter } from '../src/routes/survey';
import { createApp } from '../src/app';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../src/survey/scannerClient';
import { readKnownDevices, readNotes, readSavedSurvey, writeKnownDevices, writeNotes, writeSavedSurvey } from '../src/survey/store';
import { Device, ScanState } from '../src/survey/types';
import { fakeScannerClient, sessionCookie } from './helpers';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const router: Device = {
  ip: '192.168.1.1', mac: '04:42:1a:14:e8:00', vendor: 'ASUSTek COMPUTER INC.', privateMac: false,
  name: 'RT-AX86U-14E8', nameSource: 'dns', web: null, services: [], ports: [], rttMs: 2,
};

const finished: ScanState = {
  state: 'finished',
  result: { scannedAt: '2026-09-17T11:59:00.000Z', cidr: '192.168.1.0/24', devices: [router] },
};

describe('survey API', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-api-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function makeApp(scanner: ScannerClient, surveyDir = dir) {
    const app = express();
    app.use(cookieParser());
    app.use(createSurveyRouter({ scanner, surveyDir, now: () => NOW }));
    return app;
  }

  it('rejects every route without a session and never reaches the scanner', async () => {
    const scanner = fakeScannerClient(finished);
    const app = makeApp(scanner);

    expect((await request(app).get('/api/survey')).status).toBe(401);
    expect((await request(app).post('/api/survey/scan')).status).toBe(401);
    expect((await request(app).post('/api/survey/save')).status).toBe(401);
    expect(scanner.getScan).not.toHaveBeenCalled();
    expect(scanner.startScan).not.toHaveBeenCalled();
  });

  it('is mounted and guarded in the real app', async () => {
    const response = await request(createApp()).get('/api/survey');

    expect(response.status).toBe(401);
  });

  it('reports an idle scanner and no saved survey', async () => {
    const response = await request(makeApp(fakeScannerClient({ state: 'idle' }))).get('/api/survey').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'idle' });
    expect(response.body.view.source).toBe('none');
  });

  it('is not cacheable, so a network inventory cannot linger in the browser', async () => {
    const response = await request(makeApp(fakeScannerClient({ state: 'idle' }))).get('/api/survey').set('Cookie', sessionCookie());

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('still shows the saved survey when the scanner is unavailable', async () => {
    await writeSavedSurvey({ ...finished.result, savedAt: '2026-09-17T12:00:00.000Z', version: 'dev' }, dir);
    const scanner = fakeScannerClient({ state: 'idle' });
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).get('/api/survey').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'unavailable' });
    expect(response.body.view.source).toBe('saved');
    expect(response.body.view.rows).toHaveLength(1);
  });

  it('starts a scan and returns the status', async () => {
    const running: ScanState = {
      state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: '2026-09-17T12:00:00.000Z',
    };
    const scanner = fakeScannerClient(running);

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', sessionCookie());

    expect(response.status).toBe(202);
    expect(scanner.startScan).toHaveBeenCalledTimes(1);
    expect(response.body.scan).toEqual({ state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4 });
  });

  it('answers 409 with the current status when a scan is already running', async () => {
    const scanner = fakeScannerClient({ state: 'running', stage: 'names', stageIndex: 2, stageCount: 4, startedAt: 'x' });
    scanner.startScan.mockRejectedValue(new ScannerBusyError());

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', sessionCookie());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('busy');
    expect(response.body.status.scan.stage).toBe('names');
  });

  it('answers 503 when the scanner cannot be reached to start a scan', async () => {
    const scanner = fakeScannerClient({ state: 'idle' });
    scanner.startScan.mockRejectedValue(new ScannerUnavailableError('down'));
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', sessionCookie());

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('scanner-unavailable');
    expect(response.body.status.scan).toEqual({ state: 'unavailable' });
  });

  it('saves the scanner result with a timestamp and version', async () => {
    const response = await request(makeApp(fakeScannerClient(finished))).post('/api/survey/save').set('Cookie', sessionCookie());

    expect(response.status).toBe(200);
    expect(response.body.view.source).toBe('saved');
    expect(await readSavedSurvey(dir)).toEqual({
      ...finished.result,
      savedAt: NOW.toISOString(),
      version: 'dev',
    });
  });

  it('saves what the scanner holds and ignores the request body', async () => {
    await request(makeApp(fakeScannerClient(finished)))
      .post('/api/survey/save')
      .set('Cookie', sessionCookie())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ devices: [{ ip: '6.6.6.6', mac: 'de:ad:be:ef:00:00' }] }));

    expect((await readSavedSurvey(dir))?.devices).toEqual([router]);
  });

  it('refuses to save when the scanner has no finished scan', async () => {
    const scanner = fakeScannerClient({ state: 'running', stage: 'ports', stageIndex: 3, stageCount: 4, startedAt: 'x' });

    const response = await request(makeApp(scanner)).post('/api/survey/save').set('Cookie', sessionCookie());

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'nothing-to-save' });
    expect(await readSavedSurvey(dir)).toBeNull();
  });

  it('answers 500 JSON when the survey cannot be written', async () => {
    const blocker = path.join(dir, 'a-file');
    await fs.writeFile(blocker, 'x');

    const response = await request(makeApp(fakeScannerClient(finished), path.join(blocker, 'surveys')))
      .post('/api/survey/save')
      .set('Cookie', sessionCookie());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal' });
  });

  describe('POST /api/survey/notes', () => {
    it('requires a session', async () => {
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .send({ mac: router.mac, text: 'x' });

      expect(response.status).toBe(401);
    });

    it('saves a note and returns it merged into the survey status', async () => {
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: 'living room router' });

      expect(response.status).toBe(200);
      const row = response.body.view.rows.find((r: { mac: string }) => r.mac === router.mac);
      expect(row.note).toBe('living room router');
      expect((await readNotes(dir))[router.mac]).toEqual({ text: 'living room router', updatedAt: NOW.toISOString() });
    });

    it('stores the MAC lowercased regardless of how it was submitted', async () => {
      await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac.toUpperCase(), text: 'note' });

      expect(Object.keys(await readNotes(dir))).toEqual([router.mac]);
    });

    it('rejects a malformed MAC', async () => {
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: 'not-a-mac', text: 'x' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'bad-mac' });
      await expect(readNotes(dir)).resolves.toEqual({});
    });

    it('rejects a non-string text', async () => {
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: 42 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'bad-text' });
    });

    it('caps text at 500 characters', async () => {
      await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: 'x'.repeat(600) });

      expect((await readNotes(dir))[router.mac].text).toHaveLength(500);
    });

    it('strips control characters from the text', async () => {
      await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: 'a bc' });

      expect((await readNotes(dir))[router.mac].text).toBe('abc');
    });

    it('deletes the note when text is empty or whitespace-only', async () => {
      await writeNotes({ [router.mac]: { text: 'old note', updatedAt: 'x' } }, dir);

      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: '   ' });

      expect(response.status).toBe(200);
      await expect(readNotes(dir)).resolves.toEqual({});
      const row = response.body.view.rows.find((r: { mac: string }) => r.mac === router.mac);
      expect(row.note).toBeNull();
    });

    it('rejects a new MAC once the store already holds 1000 notes, but still allows updating an existing one', async () => {
      const full: Record<string, { text: string; updatedAt: string }> = {};
      for (let i = 0; i < 1000; i += 1) {
        const hi = Math.floor(i / 256).toString(16).padStart(2, '0');
        const lo = (i % 256).toString(16).padStart(2, '0');
        full[`aa:bb:cc:dd:${hi}:${lo}`] = { text: 'x', updatedAt: 'y' };
      }
      await writeNotes(full, dir);

      const rejected = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: router.mac, text: 'new device' });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual({ error: 'too-many-notes' });

      const existingMac = Object.keys(full)[0];
      const updated = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .send({ mac: existingMac, text: 'updated' });
      expect(updated.status).toBe(200);
      expect((await readNotes(dir))[existingMac].text).toBe('updated');
    });

    it('survives concurrent saves for different MACs with no lost update', async () => {
      const macs = ['de:ad:be:ef:00:01', 'de:ad:be:ef:00:02', 'de:ad:be:ef:00:03', 'de:ad:be:ef:00:04'];
      const app = makeApp(fakeScannerClient(finished));

      const responses = await Promise.all(
        macs.map((mac) => request(app)
          .post('/api/survey/notes')
          .set('Cookie', sessionCookie())
          .send({ mac, text: 'note for ' + mac })),
      );

      responses.forEach((response) => expect(response.status).toBe(200));
      const notes = await readNotes(dir);
      for (const mac of macs) {
        expect(notes[mac]).toEqual({ text: 'note for ' + mac, updatedAt: NOW.toISOString() });
      }
    });

    it('answers 400 bad-json for an unparseable body without logging its contents', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .set('Content-Type', 'application/json')
        .send('{ not json, super-secret-token-xyz');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'bad-json' });
      const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(logged).not.toContain('super-secret-token-xyz');
      errorSpy.mockRestore();
    });

    it('answers 413 too-large for a body over the notes route limit', async () => {
      const response = await request(makeApp(fakeScannerClient(finished)))
        .post('/api/survey/notes')
        .set('Cookie', sessionCookie())
        .set('Content-Type', 'application/json')
        .send({ mac: router.mac, text: 'x'.repeat(9000) });

      expect(response.status).toBe(413);
      expect(response.body).toEqual({ error: 'too-large' });
    });
  });

  describe('known devices', () => {
    const printer: Device = {
      ip: '192.168.1.10', mac: '00:1b:a9:44:55:66', vendor: 'Brother Industries, Ltd.', privateMac: false,
      name: 'Brother HL-L2350DW', nameSource: 'mdns', web: null, services: [], ports: [], rttMs: 12,
    };
    const withPrinter: ScanState = {
      state: 'finished',
      result: { scannedAt: '2026-09-17T11:00:00.000Z', cidr: '192.168.1.0/24', devices: [router, printer] },
    };

    function goneMacs(body: { view: { rows: Array<{ mac: string; status: string }> } }): string[] {
      return body.view.rows.filter((row) => row.status === 'gone').map((row) => row.mac);
    }

    it('keeps a device that went offline as gone after the save that no longer has it', async () => {
      await request(makeApp(fakeScannerClient(withPrinter))).post('/api/survey/save').set('Cookie', sessionCookie());

      const response = await request(makeApp(fakeScannerClient(finished))).post('/api/survey/save').set('Cookie', sessionCookie());

      expect(response.status).toBe(200);
      expect(response.body.view.source).toBe('saved');
      expect(goneMacs(response.body)).toEqual([printer.mac]);
      const gone = response.body.view.rows.find((row: { mac: string }) => row.mac === printer.mac);
      expect(gone).toMatchObject({ ip: printer.ip, name: printer.name, lastSeenAt: withPrinter.result.scannedAt });
      expect(response.body.view.counts).toEqual({ devices: 1, new: 0, gone: 1 });
      expect(Object.keys((await readKnownDevices(dir))!).sort()).toEqual([printer.mac, router.mac].sort());
    });

    it('seeds the known list from the existing latest.json on the first save, so nothing saved today is lost', async () => {
      await writeSavedSurvey({ ...withPrinter.result, savedAt: 'x', version: 'dev' }, dir);

      const response = await request(makeApp(fakeScannerClient(finished))).post('/api/survey/save').set('Cookie', sessionCookie());

      expect(goneMacs(response.body)).toEqual([printer.mac]);
      expect((await readKnownDevices(dir))![printer.mac].lastSeenAt).toBe(withPrinter.result.scannedAt);
    });

    it('shows one gone row per device on an unsaved scan, not one from the saved survey and one from the known list', async () => {
      await request(makeApp(fakeScannerClient(withPrinter))).post('/api/survey/save').set('Cookie', sessionCookie());

      const response = await request(makeApp(fakeScannerClient(finished))).get('/api/survey').set('Cookie', sessionCookie());

      expect(response.body.view.source).toBe('scan');
      expect(goneMacs(response.body)).toEqual([printer.mac]);
      expect(response.body.view.counts).toEqual({ devices: 1, new: 0, gone: 1 });
    });

    describe('POST /api/survey/known-devices/remove', () => {
      const remove = (app: express.Express, body: unknown) => request(app)
        .post('/api/survey/known-devices/remove')
        .set('Cookie', sessionCookie())
        .send(body as object);

      it('requires a session', async () => {
        const response = await request(makeApp(fakeScannerClient(finished)))
          .post('/api/survey/known-devices/remove')
          .send({ mac: printer.mac });

        expect(response.status).toBe(401);
      });

      it('refuses a cross-origin request even with a session', async () => {
        await writeKnownDevices({ [printer.mac]: { ...printer, lastSeenAt: '2026-09-17T11:00:00.000Z' } }, dir);

        const response = await request(makeApp(fakeScannerClient(finished)))
          .post('/api/survey/known-devices/remove')
          .set('Cookie', sessionCookie())
          .set('Sec-Fetch-Site', 'same-site')
          .send({ mac: printer.mac });

        expect(response.status).toBe(403);
        expect(Object.keys((await readKnownDevices(dir))!)).toEqual([printer.mac]);
      });

      it('rejects a malformed or missing MAC', async () => {
        const app = makeApp(fakeScannerClient(finished));

        for (const body of [{ mac: 'not-a-mac' }, { mac: '__proto__' }, {}, { mac: 42 }]) {
          const response = await remove(app, body);
          expect(response.status).toBe(400);
          expect(response.body).toEqual({ error: 'bad-mac' });
        }
        await expect(readKnownDevices(dir)).resolves.toBeNull();
      });

      it('answers 400 bad-json for an unparseable body', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await request(makeApp(fakeScannerClient(finished)))
          .post('/api/survey/known-devices/remove')
          .set('Cookie', sessionCookie())
          .set('Content-Type', 'application/json')
          .send('{ nope');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'bad-json' });
        vi.restoreAllMocks();
      });

      it('removes the device, normalizing the MAC, and keeps its note', async () => {
        await request(makeApp(fakeScannerClient(withPrinter))).post('/api/survey/save').set('Cookie', sessionCookie());
        await request(makeApp(fakeScannerClient(finished))).post('/api/survey/save').set('Cookie', sessionCookie());
        await writeNotes({ [printer.mac]: { text: 'upstairs', updatedAt: 'x' } }, dir);

        const response = await remove(makeApp(fakeScannerClient(finished)), { mac: printer.mac.toUpperCase() });

        expect(response.status).toBe(200);
        expect(goneMacs(response.body)).toEqual([]);
        expect(Object.keys((await readKnownDevices(dir))!)).toEqual([router.mac]);
        expect((await readNotes(dir))[printer.mac].text).toBe('upstairs');
      });

      it('stays removed while an unsaved scan shows and latest.json still lists the device', async () => {
        await request(makeApp(fakeScannerClient(withPrinter))).post('/api/survey/save').set('Cookie', sessionCookie());
        // The scanner now holds a newer, unsaved scan without the printer.
        const app = makeApp(fakeScannerClient(finished));
        expect(goneMacs((await request(app).get('/api/survey').set('Cookie', sessionCookie())).body)).toEqual([printer.mac]);

        await remove(app, { mac: printer.mac });

        const response = await request(app).get('/api/survey').set('Cookie', sessionCookie());
        expect(response.body.view.source).toBe('scan');
        expect(response.body.view.rows.map((row: { mac: string }) => row.mac)).toEqual([router.mac]);
        expect((await readSavedSurvey(dir))!.devices.map((device) => device.mac)).toContain(printer.mac);
      });

      it('brings a removed device back as a normal row when it answers a scan, and knows it again after the save', async () => {
        await request(makeApp(fakeScannerClient(withPrinter))).post('/api/survey/save').set('Cookie', sessionCookie());
        await request(makeApp(fakeScannerClient(finished))).post('/api/survey/save').set('Cookie', sessionCookie());
        await remove(makeApp(fakeScannerClient(finished)), { mac: printer.mac });

        const returned: ScanState = { state: 'finished', result: { ...withPrinter.result, scannedAt: '2026-09-17T13:00:00.000Z' } };
        const shown = await request(makeApp(fakeScannerClient(returned))).get('/api/survey').set('Cookie', sessionCookie());
        expect(shown.body.view.rows.find((row: { mac: string }) => row.mac === printer.mac).status).toBe('new');

        await request(makeApp(fakeScannerClient(returned))).post('/api/survey/save').set('Cookie', sessionCookie());
        expect(Object.keys((await readKnownDevices(dir))!).sort()).toEqual([printer.mac, router.mac].sort());
      });

      it('is idempotent for a MAC that is not known', async () => {
        const response = await remove(makeApp(fakeScannerClient(finished)), { mac: 'de:ad:be:ef:00:01' });

        expect(response.status).toBe(200);
        await expect(readKnownDevices(dir)).resolves.toEqual({});
      });

      it('answers 500 JSON when the known list is corrupt, and does not overwrite it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await fs.writeFile(path.join(dir, 'known-devices.json'), '{ corrupt');

        const response = await remove(makeApp(fakeScannerClient(finished)), { mac: printer.mac });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'internal' });
        expect(await fs.readFile(path.join(dir, 'known-devices.json'), 'utf8')).toBe('{ corrupt');
        vi.restoreAllMocks();
      });
    });
  });
});
