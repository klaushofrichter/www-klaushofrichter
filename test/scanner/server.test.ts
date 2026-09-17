import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createServer } from '../../scanner/src/server';
import { ScannerConfig } from '../../scanner/src/config';
import { ScanState } from '../../src/survey/types';

const config: ScannerConfig = {
  token: 'a-token', cidr: '192.168.1.0/24', iface: 'lo0',
  bindAddress: '127.0.0.1', port: 0, version: 'test',
};

describe('scanner HTTP contract', () => {
  let server: http.Server;
  let base: string;
  let state: ScanState;
  let starts: number;

  beforeEach(async () => {
    state = { state: 'idle' };
    starts = 0;
    server = createServer(config, {
      getState: () => state,
      start: () => {
        if (state.state === 'running') return false;
        starts += 1;
        state = { state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: 'now' };
        return true;
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const auth = { authorization: 'Bearer a-token' };

  it('serves health without a token', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'www-scanner', version: 'test' });
  });

  it('refuses /scan without a token', async () => {
    expect((await fetch(`${base}/scan`)).status).toBe(401);
    expect((await fetch(`${base}/scan`, { method: 'POST' })).status).toBe(401);
    expect(starts).toBe(0);
  });

  it('refuses a wrong token, including one of a different length', async () => {
    expect((await fetch(`${base}/scan`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/scan`, { headers: { authorization: 'Bearer a-token-plus' } })).status).toBe(401);
  });

  it('returns the current state', async () => {
    const response = await fetch(`${base}/scan`, { headers: auth });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'idle' });
  });

  it('starts a scan and reports busy for a second request', async () => {
    const first = await fetch(`${base}/scan`, { method: 'POST', headers: auth });
    expect(first.status).toBe(202);

    const second = await fetch(`${base}/scan`, { method: 'POST', headers: auth });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'busy' });
    expect(starts).toBe(1);
  });

  it('404s an unknown path', async () => {
    expect((await fetch(`${base}/anything`, { headers: auth })).status).toBe(404);
  });
});
