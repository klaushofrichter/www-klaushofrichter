import { SESSION_COOKIE, signSession } from '../src/session';

// Signs a session with the server's own signSession, so signed-in specs need
// no Google login and cannot drift from the real session format.
// COOKIE_SECRET and ALLOWED_EMAILS must match the server under test; CI sets
// both on the same step.
export function sessionCookie(baseURL: string) {
  if (!process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET must be set to the server\'s value for signed-in e2e specs');
  }
  const email = (process.env.ALLOWED_EMAILS ?? '').split(',')[0].trim();
  if (!email) {
    throw new Error('ALLOWED_EMAILS must be set to the server\'s value for signed-in e2e specs');
  }
  return {
    name: SESSION_COOKIE,
    value: signSession(email),
    domain: new URL(baseURL).hostname,
    path: '/',
    httpOnly: true,
    // The server marks its own cookie Secure; this one is for http://localhost.
    secure: false,
    sameSite: 'Lax' as const,
  };
}
