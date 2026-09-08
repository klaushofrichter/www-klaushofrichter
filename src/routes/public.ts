import { Router, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { PUBLIC_DIR, listPublicFiles } from '../publicFiles';
import { renderPublicIndex } from '../views/publicIndex';

export const publicRouter = Router();

const publicRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

publicRouter.use('/public', publicRateLimit);

// express.static does the path resolution, so a traversal attempt like
// /public/../.env never escapes PUBLIC_DIR - the containment check lives in
// send(), not in a regex here. index:false makes a request for the directory
// itself fall through to the listing route below instead of 404ing.
publicRouter.use(
  '/public',
  express.static(PUBLIC_DIR, {
    index: false,
    // Without this, a request for /public is answered with a 301 to /public/
    // before the listing route below ever runs. Both forms should render the
    // listing directly.
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: true,
    // The files ship inside the image, so a given URL's bytes only change when
    // a new image is deployed. An hour is short enough that a redeploy is
    // picked up quickly and long enough to spare repeat downloads.
    maxAge: '1h',
  }),
);

publicRouter.get('/public', (_req: Request, res: Response) => {
  res.status(200).type('html').send(renderPublicIndex(listPublicFiles()));
});
