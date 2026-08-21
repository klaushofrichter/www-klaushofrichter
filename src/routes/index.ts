import { Router, Request, Response } from 'express';
import { renderPage } from '../views/page';
import { refreshAllImages } from '../refreshImages';
import { verifySession } from '../session';

export const indexRouter = Router();

const REFRESH_COOLDOWN_MS = 60_000;
let lastRefresh = 0;

indexRouter.get('/', (req: Request, res: Response) => {
  const token = req.cookies?.session;
  const session = typeof token === 'string' ? verifySession(token) : null;
  res.status(200).type('html').send(renderPage(session !== null));
});

indexRouter.post('/refresh', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
    res.status(429).json({ error: 'cooldown' });
    return;
  }
  lastRefresh = now;
  try {
    await refreshAllImages();
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Manual image refresh failed', err);
    lastRefresh = 0;
    res.status(500).json({ error: 'refresh failed' });
  }
});
