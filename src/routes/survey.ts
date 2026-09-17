import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuthApi } from '../requireAuth';
import { ScannerBusyError, ScannerClient, ScannerUnavailableError } from '../survey/scannerClient';
import { readSavedSurvey, writeSavedSurvey } from '../survey/store';
import { ScanProgress, ScanState, SurveyStatus } from '../survey/types';
import { buildSurveyView } from '../survey/view';
import { appVersion } from '../version';

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
  return { scan: progress, view: buildSurveyView(finished, saved) };
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
  router.use('/api/survey', requireAuthApi, surveyRateLimit);

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

  // JSON rather than Express's default HTML error page, which the browser
  // script could not read.
  router.use('/api/survey', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Survey API error', err);
    res.status(500).json({ error: 'internal' });
  });

  return router;
}
