import express, { Express } from 'express';
import path from 'path';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';

export function createApp(): Express {
  const app = express();
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(indexRouter);
  return app;
}
