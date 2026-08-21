import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import rateLimit from 'express-rate-limit';
import { signSession } from '../session';

export const authRouter = Router();

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

const authCallbackRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

authRouter.get('/auth/google/login', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'openid email',
  });
  res.redirect(302, `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
});

authRouter.get(
  '/auth/google/callback',
  authCallbackRateLimit,
  async (req: Request, res: Response) => {
    const code = req.query.code;

    if (typeof code !== 'string' || code.length === 0) {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    let email: string | undefined;
    try {
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token ?? '',
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload?.email_verified ? payload.email : undefined;
    } catch {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    if (!email || !getAllowedEmails().includes(email)) {
      res.redirect(302, '/?auth_error=1');
      return;
    }

    res.cookie(SESSION_COOKIE, signSession(email), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.redirect(302, '/');
  }
);

authRouter.get('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  res.redirect(302, '/');
});
