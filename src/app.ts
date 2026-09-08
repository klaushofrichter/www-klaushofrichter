import express, { Express } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';

export function createApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(publicRouter);
  app.use(indexRouter);
  return app;
}
