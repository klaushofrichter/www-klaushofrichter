import jwt from 'jsonwebtoken';

// Signs a session the way the server does (src/session.ts), so signed-in
// specs need no Google login. COOKIE_SECRET and ALLOWED_EMAILS must match the
// server under test; CI sets both on the same step.
export function sessionCookie(baseURL: string) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('COOKIE_SECRET must be set to the server\'s value for signed-in e2e specs');
  }
  const email = (process.env.ALLOWED_EMAILS ?? '').split(',')[0].trim();
  if (!email) {
    throw new Error('ALLOWED_EMAILS must be set to the server\'s value for signed-in e2e specs');
  }
  return {
    name: 'session',
    value: jwt.sign({ email }, secret, { expiresIn: '10m' }),
    domain: new URL(baseURL).hostname,
    path: '/',
    httpOnly: true,
    // The server marks its own cookie Secure; this one is for http://localhost.
    secure: false,
    sameSite: 'Lax' as const,
  };
}
