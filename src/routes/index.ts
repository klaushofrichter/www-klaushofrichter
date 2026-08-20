import { Router, Request, Response } from 'express';
import { renderPage } from '../views/page';
import { refreshAllImages } from '../refreshImages';

export const indexRouter = Router();

const REFRESH_COOLDOWN_MS = 60_000;
let lastRefresh = 0;

indexRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).type('html').send(renderPage());
});

indexRouter.post('/refresh', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
    res.status(429).json({ error: 'cooldown' });
    return;
  }
  lastRefresh = now;
  await refreshAllImages();
  res.status(200).json({ status: 'ok' });
});
