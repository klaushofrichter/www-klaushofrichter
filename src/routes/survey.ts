import express, { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { noStore, requireAuthApi } from '../requireAuth';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../survey/scannerClient';
import { readNotes, readSavedSurvey, RejectNotesUpdate, updateNotes, writeSavedSurvey } from '../survey/store';
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

export async function loadSurveyStatus(deps: SurveyDeps): Promise<SurveyStatus> {
  const saved = await readSavedSurvey(deps.surveyDir);
  const notes = await readNotes(deps.surveyDir);
  let scan: ScanState | null = null;
  let progress: ScanProgress;
  try {
    scan = await deps.scanner.getScan();
    progress = toProgress(scan);
  } catch (err) {
    if (!(err instanceof ScannerUnavailableError)) {
      throw err;
    }
    progress = { state: 'unavailable' };
  }
  const finished = scan && scan.state === 'finished' ? scan.result : null;
  return { scan: progress, view: buildSurveyView(finished, saved, notes) };
}

export function createSurveyRouter(deps: SurveyDeps): Router {
  const router = Router();
  const surveyRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Auth first, so unauthenticated requests are rejected before they count
  // against anyone's budget. POSTs need no CSRF token here: the session cookie
  // is SameSite=Lax, so a cross-site POST arrives without it and gets a 401.
  router.use('/api/survey', noStore, requireAuthApi, surveyRateLimit);

  router.get('/api/survey', async (_req: Request, res: Response) => {
    res.status(200).json(await loadSurveyStatus(deps));
  });

  router.post('/api/survey/scan', async (_req: Request, res: Response) => {
    try {
      await deps.scanner.startScan();
    } catch (err) {
      if (err instanceof ScannerBusyError) {
        res.status(409).json({ error: 'busy', status: await loadSurveyStatus(deps) });
        return;
      }
      if (err instanceof ScannerUnavailableError) {
        res.status(503).json({ error: 'scanner-unavailable', status: await loadSurveyStatus(deps) });
        return;
      }
      throw err;
    }
    res.status(202).json(await loadSurveyStatus(deps));
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
    const now = deps.now ? deps.now() : new Date();
    await writeSavedSurvey({ ...scan.result, savedAt: now.toISOString(), version: appVersion() }, deps.surveyDir);
    res.status(200).json(await loadSurveyStatus(deps));
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
    const now = deps.now ? deps.now() : new Date();

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
        notes[macLower] = { text, updatedAt: now.toISOString() };
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

  interface BodyParserError extends Error {
    type?: string;
  }

  function isBodyParserError(err: unknown): err is BodyParserError {
    return err instanceof Error && typeof (err as BodyParserError).type === 'string';
  }

  // JSON rather than Express's default HTML error page, which the browser
  // script could not read. A malformed or oversized body reaches here as a
  // body-parser error (express.json() is only mounted on the notes route),
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
