// A stand-in for the real scanner: the real HTTP handler (scanner/src/server.ts)
// in front of a runner that replays fixture data instead of scanning. Used by
// the e2e suite in CI and for local development: `npm run fake-scanner`. It
// never touches the network beyond its own listening socket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHandler, ScanRunner } from '../scanner/src/server';
import { Device, SCAN_STAGES, ScanState } from '../src/survey/types';

const PORT = Number(process.env.FAKE_SCANNER_PORT ?? 9451);
const TOKEN = process.env.SCANNER_TOKEN ?? '';
const STAGE_MS = Number(process.env.FAKE_SCANNER_STAGE_MS ?? 250);
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

// Walks the stages on a timer, then finishes with the next fixture in turn.
const runner: ScanRunner = {
  getState: () => state,
  start() {
    if (state.state === 'running') {
      return false;
    }
    const devices = FIXTURES[scanCount % FIXTURES.length];
    scanCount += 1;
    const startedAt = new Date().toISOString();
    const stageCount = SCAN_STAGES.length;
    state = { state: 'running', stage: SCAN_STAGES[0], stageIndex: 1, stageCount, startedAt };
    timers = SCAN_STAGES.slice(1).map((stage, i) =>
      setTimeout(() => {
        state = { state: 'running', stage, stageIndex: i + 2, stageCount, startedAt };
      }, (i + 1) * STAGE_MS),
    );
    timers.push(
      setTimeout(() => {
        state = { state: 'finished', result: { scannedAt: new Date().toISOString(), cidr: '192.168.1.0/24', devices } };
      }, stageCount * STAGE_MS),
    );
    return true;
  },
};

const handler = createHandler(
  { token: TOKEN, version: 'dev', port: PORT, bindAddress: '127.0.0.1', cidr: '192.168.1.0/24', iface: 'fake' },
  runner,
);

const server = http.createServer((req, res) => {
  // Test-only: lets a spec start from fixture A regardless of earlier runs.
  // The real scanner has no such route. Bound to loopback, like the rest.
  if (req.method === 'POST' && req.url === '/__fake/reset') {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
    scanCount = 0;
    state = { state: 'idle' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }
  handler(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake scanner listening on 127.0.0.1:${PORT}`);
});
