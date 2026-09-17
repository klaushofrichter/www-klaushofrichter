import { NextFunction, Request, Response } from 'express';
import { getAllowedEmails } from './allowedEmails';
import { SESSION_COOKIE, SessionPayload, verifySession } from './session';

// The single definition of "signed in". The homepage, the Dashboard button and
// every guarded route all ask this, so what a page shows and what its routes
// accept cannot drift apart.
export function currentUser(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') {
    return null;
  }
  const session = verifySession(token);
  if (!session) {
    return null;
  }
  return getAllowedEmails().includes(session.email) ? session : null;
}

export function requireAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (!currentUser(req)) {
    res.redirect(302, '/');
    return;
  }
  next();
}

// JSON, not a redirect: a fetch() following a redirect to the homepage would
// get HTML back and fail somewhere far from the actual cause.
export function requireAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (!currentUser(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
