import { Request, Response, Router } from 'express';
import { requireAuthPage } from '../requireAuth';
import { renderDashboardPage } from '../views/dashboard';
import { SurveyDeps } from './survey';

export function createDashboardRouter(_deps: SurveyDeps): Router {
  const router = Router();

  router.get('/dashboard', requireAuthPage, (_req: Request, res: Response) => {
    res.status(200).type('html').send(renderDashboardPage());
  });

  return router;
}
