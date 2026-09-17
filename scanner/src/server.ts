import crypto from 'node:crypto';
import http from 'node:http';
import { ScanState } from '../../src/survey/types';
import { ScannerConfig } from './config';

export interface ScanRunner {
  getState(): ScanState;
  // false when a scan is already running.
  start(): boolean;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Constant-time, and length-safe: timingSafeEqual throws on a length mismatch,
// so compare digests rather than the raw values.
function tokenMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createServer(config: ScannerConfig, runner: ScanRunner): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://scanner');

    if (req.method === 'GET' && url.pathname === '/health') {
      // Unauthenticated on purpose: the deploy's smoke test reads it, and it
      // discloses nothing but liveness and the build it is running.
      send(res, 200, { status: 'ok', service: 'www-scanner', version: config.version });
      return;
    }

    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !tokenMatches(presented, config.token)) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (url.pathname === '/scan' && req.method === 'GET') {
      send(res, 200, runner.getState());
      return;
    }
    if (url.pathname === '/scan' && req.method === 'POST') {
      if (!runner.start()) {
        send(res, 409, { error: 'busy' });
        return;
      }
      send(res, 202, runner.getState());
      return;
    }
    send(res, 404, { error: 'not-found' });
  });
}
