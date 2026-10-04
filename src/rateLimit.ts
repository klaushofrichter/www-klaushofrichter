import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

// One place for the options every limiter shares, so a policy change (a JSON
// 429 handler, a key generator for a proxy) is made once.
export function perWindow(limit: number, windowMs = 60_000): RateLimitRequestHandler {
  return rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false });
}
