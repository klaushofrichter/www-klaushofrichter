import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { signSession } from '../src/session';
import { createSurveyRouter } from '../src/routes/survey';
import { createApp } from '../src/app';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../src/survey/scannerClient';
import { readSavedSurvey, writeSavedSurvey } from '../src/survey/store';
import { Device, ScanState } from '../src/survey/types';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const router: Device = {
  ip: '192.168.1.1', mac: '04:42:1a:14:e8:00', vendor: 'ASUSTek COMPUTER INC.', privateMac: false,
  name: 'RT-AX86U-14E8', nameSource: 'dns', web: null, services: [], ports: [], rttMs: 2,
};

const finished: ScanState = {
  state: 'finished',
  result: { scannedAt: '2026-09-17T11:59:00.000Z', cidr: '192.168.1.0/24', devices: [router] },
};

function fakeScanner(state: ScanState) {
  return {
    getScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
    startScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
  } satisfies ScannerClient;
}

function cookie(): string {
  return `session=${signSession('allowed@example.com')}`;
}

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
    const scanner = fakeScanner(finished);
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
    const response = await request(makeApp(fakeScanner({ state: 'idle' }))).get('/api/survey').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'idle' });
    expect(response.body.view.source).toBe('none');
  });

  it('still shows the saved survey when the scanner is unavailable', async () => {
    await writeSavedSurvey({ ...finished.result, savedAt: '2026-09-17T12:00:00.000Z', version: 'dev' }, dir);
    const scanner = fakeScanner({ state: 'idle' });
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).get('/api/survey').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.scan).toEqual({ state: 'unavailable' });
    expect(response.body.view.source).toBe('saved');
    expect(response.body.view.rows).toHaveLength(1);
  });

  it('starts a scan and returns the status', async () => {
    const running: ScanState = {
      state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: '2026-09-17T12:00:00.000Z',
    };
    const scanner = fakeScanner(running);

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(202);
    expect(scanner.startScan).toHaveBeenCalledTimes(1);
    expect(response.body.scan).toEqual({ state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4 });
  });

  it('answers 409 with the current status when a scan is already running', async () => {
    const scanner = fakeScanner({ state: 'running', stage: 'names', stageIndex: 2, stageCount: 4, startedAt: 'x' });
    scanner.startScan.mockRejectedValue(new ScannerBusyError());

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('busy');
    expect(response.body.status.scan.stage).toBe('names');
  });

  it('answers 503 when the scanner cannot be reached to start a scan', async () => {
    const scanner = fakeScanner({ state: 'idle' });
    scanner.startScan.mockRejectedValue(new ScannerUnavailableError('down'));
    scanner.getScan.mockRejectedValue(new ScannerUnavailableError('down'));

    const response = await request(makeApp(scanner)).post('/api/survey/scan').set('Cookie', cookie());

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('scanner-unavailable');
    expect(response.body.status.scan).toEqual({ state: 'unavailable' });
  });

  it('saves the scanner result with a timestamp and version', async () => {
    const response = await request(makeApp(fakeScanner(finished))).post('/api/survey/save').set('Cookie', cookie());

    expect(response.status).toBe(200);
    expect(response.body.view.source).toBe('saved');
    expect(response.body.view.unsaved).toBe(false);
    expect(await readSavedSurvey(dir)).toEqual({
      ...finished.result,
      savedAt: NOW.toISOString(),
      version: 'dev',
    });
  });

  it('saves what the scanner holds and ignores the request body', async () => {
    await request(makeApp(fakeScanner(finished)))
      .post('/api/survey/save')
      .set('Cookie', cookie())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ devices: [{ ip: '6.6.6.6', mac: 'de:ad:be:ef:00:00' }] }));

    expect((await readSavedSurvey(dir))?.devices).toEqual([router]);
  });

  it('refuses to save when the scanner has no finished scan', async () => {
    const scanner = fakeScanner({ state: 'running', stage: 'ports', stageIndex: 3, stageCount: 4, startedAt: 'x' });

    const response = await request(makeApp(scanner)).post('/api/survey/save').set('Cookie', cookie());

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'nothing-to-save' });
    expect(await readSavedSurvey(dir)).toBeNull();
  });

  it('answers 500 JSON when the survey cannot be written', async () => {
    const blocker = path.join(dir, 'a-file');
    await fs.writeFile(blocker, 'x');

    const response = await request(makeApp(fakeScanner(finished), path.join(blocker, 'surveys')))
      .post('/api/survey/save')
      .set('Cookie', cookie());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal' });
  });
});
