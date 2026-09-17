// A stand-in for the real scanner, implementing the same HTTP contract
// (src/survey/types.ts) from fixture data. Used by the e2e suite in CI and for
// local development: `npm run fake-scanner`. It never touches the network
// beyond its own listening socket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Device, ScanStage, ScanState } from '../src/survey/types';

const PORT = Number(process.env.FAKE_SCANNER_PORT ?? 9451);
const TOKEN = process.env.SCANNER_TOKEN ?? '';
const STAGE_MS = Number(process.env.FAKE_SCANNER_STAGE_MS ?? 250);
const STAGES: ScanStage[] = ['discovery', 'names', 'ports', 'web'];
const FIXTURES: Device[][] = ['scan-a.json', 'scan-b.json'].map(
  (file) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8')) as Device[],
);

if (!TOKEN) {
  console.error('SCANNER_TOKEN must be set (the same value the website uses)');
  process.exit(1);
}

let scanCount = 0;
let state: ScanState = { state: 'idle' };
let timers: NodeJS.Timeout[] = [];

function startScan(): void {
  const devices = FIXTURES[scanCount % FIXTURES.length];
  scanCount += 1;
  const startedAt = new Date().toISOString();
  state = { state: 'running', stage: STAGES[0], stageIndex: 1, stageCount: STAGES.length, startedAt };
  timers = STAGES.slice(1).map((stage, i) =>
    setTimeout(() => {
      state = { state: 'running', stage, stageIndex: i + 2, stageCount: STAGES.length, startedAt };
    }, (i + 1) * STAGE_MS),
  );
  timers.push(
    setTimeout(() => {
      state = { state: 'finished', result: { scannedAt: new Date().toISOString(), cidr: '192.168.1.0/24', devices } };
    }, STAGES.length * STAGE_MS),
  );
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake-scanner');
  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { status: 'ok', service: 'www-scanner-fake', version: 'dev' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  if (url.pathname === '/scan' && req.method === 'GET') {
    send(res, 200, state);
    return;
  }
  if (url.pathname === '/scan' && req.method === 'POST') {
    if (state.state === 'running') {
      send(res, 409, { error: 'busy' });
      return;
    }
    startScan();
    send(res, 202, state);
    return;
  }
  // Test-only: lets a spec start from fixture A regardless of earlier runs.
  // The real scanner has no such route.
  if (url.pathname === '/__fake/reset' && req.method === 'POST') {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
    scanCount = 0;
    state = { state: 'idle' };
    send(res, 200, state);
    return;
  }
  send(res, 404, { error: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake scanner listening on 127.0.0.1:${PORT}`);
});
