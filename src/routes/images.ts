import { Router, Request, Response } from 'express';
import fs from 'fs';
import { imagePath, getImageContentType } from '../refreshImages';

export const imagesRouter = Router();

// getImageContentType(id) only ever returns a value for ids that
// refreshAllImages() itself set, using the controlled ids from links.ts -
// so an unknown/malicious :id param always misses here and 404s before
// any filesystem path is touched. No separate path-traversal check needed.
imagesRouter.get('/images/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const contentType = getImageContentType(id);
  const filePath = imagePath(id);
  if (!contentType || !fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.status(200).type(contentType).sendFile(filePath);
});
