import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { renderPage } from '../views/page';
import { refreshAllImages } from '../refreshImages';
import { currentUser, requireAuthApi } from '../requireAuth';

export const indexRouter = Router();

const REFRESH_COOLDOWN_MS = 60_000;
let lastRefresh = 0;

const indexRateLimit = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

indexRouter.get('/', indexRateLimit, (req: Request, res: Response) => {
  res.status(200).type('html').send(renderPage(currentUser(req) !== null));
});

// Signed-in only: the button is shown only to a signed-in visitor, and the
// daily cron already keeps the images current. Auth runs before the cooldown
// check, so an anonymous POST can neither trigger outbound fetches nor use up
// the owner's cooldown.
indexRouter.post('/refresh', requireAuthApi, async (_req: Request, res: Response) => {
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
