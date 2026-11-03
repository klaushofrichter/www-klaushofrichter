import express, { NextFunction, Request, Response, Router } from 'express';
import { perWindow } from '../rateLimit';
import { noStore, requireAuthApi } from '../requireAuth';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../survey/scannerClient';
import {
  readKnownDevices,
  readNotes,
  readSavedSurvey,
  RejectNotesUpdate,
  removeKnownDevice,
  saveSurvey,
  seedKnownDevices,
  updateNotes,
} from '../survey/store';
import { ScanProgress, ScanState, SurveyStatus } from '../survey/types';
import { buildSurveyView, macKey } from '../survey/view';
import { appVersion } from '../version';

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const MAX_NOTE_LENGTH = 500;
const MAX_NOTES = 1000;
// C0 controls, DEL, and C1 controls -- matches what a hand-typed note could
// never legitimately contain.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

export interface SurveyDeps {
  scanner: ScannerClient;
  surveyDir?: string;
  now?: () => Date;
}

function toProgress(scan: ScanState): ScanProgress {
  switch (scan.state) {
    case 'idle':
      return { state: 'idle' };
    case 'running':
      return { state: 'running', stage: scan.stage, stageIndex: scan.stageIndex, stageCount: scan.stageCount };
    case 'finished':
      return { state: 'finished', scannedAt: scan.result.scannedAt };
    case 'failed':
      return { state: 'failed', error: scan.error };
  }
}

async function fetchScan(scanner: ScannerClient): Promise<ScanState | 'unavailable'> {
  try {
    return await scanner.getScan();
  } catch (err) {
    if (!(err instanceof ScannerUnavailableError)) {
      throw err;
    }
    return 'unavailable';
  }
}

// `known` is a scan state the caller already holds (or knows to be
// unavailable), so a route that has just talked to the scanner does not ask it
// again -- with the scanner down, that second call would double the wait.
export async function loadSurveyStatus(
  deps: SurveyDeps,
  known?: ScanState | 'unavailable',
): Promise<SurveyStatus> {
  const [saved, notes, knownFile, scan] = await Promise.all([
    readSavedSurvey(deps.surveyDir),
    readNotes(deps.surveyDir),
    readKnownDevices(deps.surveyDir),
    known ?? fetchScan(deps.scanner),
  ]);
  // Until the first save creates known-devices.json, the saved survey stands
  // in for it -- the same seed that save will write (see loadKnownDevices).
  const knownDevices = knownFile ?? seedKnownDevices(saved);
  if (scan === 'unavailable') {
    return { scan: { state: 'unavailable' }, view: buildSurveyView(null, saved, notes, knownDevices) };
  }
  const finished = scan.state === 'finished' ? scan.result : null;
  return { scan: toProgress(scan), view: buildSurveyView(finished, saved, notes, knownDevices) };
}

export function createSurveyRouter(deps: SurveyDeps): Router {
  const router = Router();
  const surveyRateLimit = perWindow(120);
  const now = deps.now ?? (() => new Date());

  // Auth first, so unauthenticated requests are rejected before they count
  // against anyone's budget. POSTs need no CSRF token here: the session cookie
  // is SameSite=Lax, so a cross-site POST arrives without it and gets a 401,
  // and requireAuthApi refuses a same-site but cross-origin POST (a sibling
  // subdomain) with a 403.
  router.use('/api/survey', noStore, requireAuthApi, surveyRateLimit);

  router.get('/api/survey', async (_req: Request, res: Response) => {
    res.status(200).json(await loadSurveyStatus(deps));
  });

  router.post('/api/survey/scan', async (_req: Request, res: Response) => {
    let started: ScanState;
    try {
      started = await deps.scanner.startScan();
    } catch (err) {
      if (err instanceof ScannerBusyError) {
        res.status(409).json({ error: 'busy', status: await loadSurveyStatus(deps) });
        return;
      }
      if (err instanceof ScannerUnavailableError) {
        res.status(503).json({ error: 'scanner-unavailable', status: await loadSurveyStatus(deps, 'unavailable') });
        return;
      }
      throw err;
    }
    res.status(202).json(await loadSurveyStatus(deps, started));
  });

  router.post('/api/survey/save', async (_req: Request, res: Response) => {
    let scan: ScanState;
    try {
      scan = await deps.scanner.getScan();
    } catch (err) {
      if (err instanceof ScannerUnavailableError) {
        res.status(503).json({ error: 'scanner-unavailable' });
        return;
      }
      throw err;
    }
    // Saved from what the scanner holds, never from the request body: a
    // crafted POST cannot plant devices in the saved survey.
    if (scan.state !== 'finished') {
      res.status(409).json({ error: 'nothing-to-save' });
      return;
    }
    // Also records the scan in known-devices.json, so devices missing from it
    // are kept as 'gone' rather than forgotten.
    const savedAt = now();
    await saveSurvey({ ...scan.result, savedAt: savedAt.toISOString(), version: appVersion() }, savedAt, deps.surveyDir);
    res.status(200).json(await loadSurveyStatus(deps, scan));
  });

  // express.json() is mounted on this one route only, never on the app or
  // the whole router: /api/survey/save relies on the app having no body
  // parser at all so it provably cannot read a crafted request body, and
  // that guarantee must not become accidental collateral of adding this
  // route.
  router.post('/api/survey/notes', express.json({ limit: '8kb' }), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { mac?: unknown; text?: unknown };
    const mac = typeof body.mac === 'string' ? body.mac : '';
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'bad-mac' });
      return;
    }
    if (typeof body.text !== 'string') {
      res.status(400).json({ error: 'bad-text' });
      return;
    }
    const macLower = macKey(mac);
    const text = body.text.replace(CONTROL_CHARS_RE, '').slice(0, MAX_NOTE_LENGTH);

    // The read-modify-write happens inside updateNotes's queue, not here, so
    // that two requests in flight (notes save on blur, and tabbing across
    // rows fires exactly that) can never both read the same on-disk state
    // and clobber each other on write.
    try {
      await updateNotes((notes) => {
        if (text.trim() === '') {
          // Empty or whitespace-only text deletes rather than storing a
          // blank note, so there's no "empty note" state to render or clean
          // up later.
          delete notes[macLower];
          return;
        }
        if (!(macLower in notes) && Object.keys(notes).length >= MAX_NOTES) {
          throw new RejectNotesUpdate('too-many-notes');
        }
        notes[macLower] = { text, updatedAt: now().toISOString() };
      }, deps.surveyDir);
    } catch (err) {
      if (err instanceof RejectNotesUpdate) {
        res.status(400).json({ error: 'too-many-notes' });
        return;
      }
      throw err;
    }
    res.status(200).json(await loadSurveyStatus(deps));
  });

  // Removes a device from the known-devices list (the 'gone' badge's dialog).
  // Same guards as the notes route: requireAuthApi and the rate limit come
  // from the router.use above, which also refuses a cross-origin POST, and
  // express.json() is mounted on this route alone for the same reason as
  // there. The note is not touched. If the device answers a later scan it is
  // listed again, and is known again once that scan is saved.
  router.post('/api/survey/known-devices/remove', express.json({ limit: '1kb' }), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { mac?: unknown };
    const mac = typeof body.mac === 'string' ? body.mac : '';
    if (!MAC_RE.test(mac)) {
      res.status(400).json({ error: 'bad-mac' });
      return;
    }
    await removeKnownDevice(macKey(mac), deps.surveyDir);
    res.status(200).json(await loadSurveyStatus(deps));
  });

  interface BodyParserError extends Error {
    type?: string;
  }

  function isBodyParserError(err: unknown): err is BodyParserError {
    return err instanceof Error && typeof (err as BodyParserError).type === 'string';
  }

  // JSON rather than Express's default HTML error page, which the browser
  // script could not read. A malformed or oversized body reaches here as a
  // body-parser error (express.json() is only mounted on the notes and remove routes),
  // and must not be reported as a generic 500 -- the browser then shows
  // "internal", which reads like a server bug rather than a bad request.
  router.use('/api/survey', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isBodyParserError(err)) {
      if (err.type === 'entity.too.large') {
        res.status(413).json({ error: 'too-large' });
        return;
      }
      if (err.type === 'entity.parse.failed' || err.type === 'charset.unsupported') {
        res.status(400).json({ error: 'bad-json' });
        return;
      }
    }
    // A body-parser SyntaxError carries the raw request body as err.body;
    // logging the error object whole would put unparsed request payloads in
    // the logs, so only the message is logged here.
    console.error('Survey API error', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal' });
  });

  return router;
}
