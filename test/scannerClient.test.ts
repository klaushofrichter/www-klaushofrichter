import { describe, it, expect, vi } from 'vitest';
import {
  createScannerClient,
  ScannerBusyError,
  ScannerUnavailableError,
} from '../src/survey/scannerClient';
import { ScanState } from '../src/survey/types';

const idle: ScanState = { state: 'idle' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createScannerClient', () => {
  it('reports unavailable without calling out when the scanner is not configured', async () => {
    const fetchImpl = vi.fn();
    const client = createScannerClient({ baseUrl: '', token: '', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GETs /scan with the bearer token and returns the state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, idle));
    const client = createScannerClient({ baseUrl: 'http://scanner.test:9450', token: 't0ken', fetchImpl });

    await expect(client.getScan()).resolves.toEqual(idle);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://scanner.test:9450/scan');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ authorization: 'Bearer t0ken' });
  });

  it('POSTs /scan to start a scan', async () => {
    const running: ScanState = {
      state: 'running', stage: 'discovery', stageIndex: 1, stageCount: 4, startedAt: '2026-09-17T12:00:00.000Z',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(202, running));
    const client = createScannerClient({ baseUrl: 'http://scanner.test:9450', token: 't0ken', fetchImpl });

    await expect(client.startScan()).resolves.toEqual(running);
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });

  it('maps 409 to ScannerBusyError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'busy' }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.startScan()).rejects.toBeInstanceOf(ScannerBusyError);
  });

  it('maps other HTTP errors to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('maps a network failure to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('maps an unparseable body to ScannerUnavailableError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});
