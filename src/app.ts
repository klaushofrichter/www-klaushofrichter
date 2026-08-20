import express, { Express } from 'express';
import path from 'path';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();
  app.use(healthRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}
