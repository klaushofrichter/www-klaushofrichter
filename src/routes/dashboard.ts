import { Request, Response, Router } from 'express';
import { noStore, requireAuthPage } from '../requireAuth';
import { renderDashboardPage } from '../views/dashboard';
import { renderIpSurveyPage } from '../views/ipSurvey';
import { loadSurveyStatus, SurveyDeps } from './survey';

export function createDashboardRouter(deps: SurveyDeps): Router {
  const router = Router();
  // Guarded by path, once: every page under /dashboard is signed-in only and
  // never cached, including any added later. Mounted without a path, a bare
  // router.use(noStore) also reached the public homepage behind this router.
  router.use('/dashboard', noStore, requireAuthPage);

  router.get('/dashboard', (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderDashboardPage());
  });

  // The current status is embedded in the page, so it renders complete on the
  // first response and only polls while a scan is running.
  router.get('/dashboard/ip-survey', async (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderIpSurveyPage(await loadSurveyStatus(deps)));
  });

  return router;
}
