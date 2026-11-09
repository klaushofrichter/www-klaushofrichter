import express, { Express, Request, Response } from 'express';
import compression from 'compression';
import path from 'path';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { imagesRouter } from './routes/images';
import { indexRouter } from './routes/index';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { createDashboardRouter } from './routes/dashboard';
import { createSurveyRouter, SurveyDeps } from './routes/survey';
import { createScannerClient } from './survey/scannerClient';
import { renderNotFound } from './views/notFound';

export interface AppOptions {
  // Injected by tests; production builds the real client from SCANNER_URL and
  // SCANNER_TOKEN.
  surveyDeps?: SurveyDeps;
}

export function createApp(options: AppOptions = {}): Express {
  const surveyDeps = options.surveyDeps ?? { scanner: createScannerClient() };
  const app = express();
  // Pages and JSON go out gzipped (the home page is 17 KB raw, about 4 KB
  // compressed); compression skips already-compressed types like WebP.
  app.use(compression());
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(imagesRouter);
  app.use(authRouter);
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use(publicRouter);
  app.use(createSurveyRouter(surveyDeps));
  app.use(createDashboardRouter(surveyDeps));
  app.use(indexRouter);
  // Last: anything no route above answered.
  app.use((_req: Request, res: Response) => {
    res.status(404).type('html').send(renderNotFound());
  });
  return app;
}
