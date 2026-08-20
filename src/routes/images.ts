import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { imagePath, getImageContentType } from '../refreshImages';

export const imagesRouter = Router();

const VALID_ID = /^[a-z0-9-]+$/;

const imagesRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// getImageContentType(id) only ever returns a value for ids that
// refreshAllImages() itself set, using the controlled ids from links.ts -
// so an unknown/malicious :id param always misses here and 404s before
// any filesystem path is touched. The VALID_ID allowlist below is an
// explicit sanitizer on top of that same invariant, satisfying static
// analysis (CodeQL js/path-injection) that can't see the map-membership
// guarantee on its own.
imagesRouter.get('/images/:id', imagesRateLimit, (req: Request, res: Response) => {
  const id = path.basename(req.params.id);
  if (!VALID_ID.test(id)) {
    res.status(404).end();
    return;
  }
  const contentType = getImageContentType(id);
  const filePath = imagePath(id);
  if (!contentType || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.status(200).type(contentType).sendFile(filePath);
});
