import express, { Express } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { createSurveyRouter, SurveyDeps } from './routes/survey';
import { createScannerClient } from './survey/scannerClient';

export interface AppOptions {
  // Injected by tests; production builds the real client from SCANNER_URL and
  // SCANNER_TOKEN.
  surveyDeps?: SurveyDeps;
}

export function createApp(options: AppOptions = {}): Express {
  const surveyDeps = options.surveyDeps ?? { scanner: createScannerClient() };
  const app = express();
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(publicRouter);
  app.use(createSurveyRouter(surveyDeps));
  app.use(indexRouter);
  return app;
}
