import { ScanState } from './types';

// The scanner is a separate service the website does not control, so its
// JSON is validated at this one boundary rather than trusted by every
// downstream consumer. Anything that doesn't match collapses to
// ScannerUnavailableError, same as an unreachable or misconfigured scanner.
function isScanState(value: unknown): value is ScanState {
  if (typeof value !== 'object' || value === null) return false;
  const state = (value as { state?: unknown }).state;
  if (state === 'idle' || state === 'running' || state === 'failed') return true;
  if (state === 'finished') {
    const result = (value as { result?: unknown }).result;
    if (typeof result !== 'object' || result === null) return false;
    return Array.isArray((result as { devices?: unknown }).devices);
  }
  return false;
}

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

export class ScannerBusyError extends Error {
  constructor() {
    super('A scan is already running');
    this.name = 'ScannerBusyError';
  }
}

export interface ScannerClient {
  getScan(): Promise<ScanState>;
  startScan(): Promise<ScanState>;
}

export interface ScannerClientOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createScannerClient(options: ScannerClientOptions = {}): ScannerClient {
  const baseUrl = options.baseUrl ?? process.env.SCANNER_URL ?? '';
  const token = options.token ?? process.env.SCANNER_TOKEN ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  // Every failure except "busy" collapses to ScannerUnavailableError: the page
  // treats an unconfigured, unreachable or misbehaving scanner the same way,
  // and keeps showing the saved survey.
  async function call(method: 'GET' | 'POST'): Promise<ScanState> {
    if (!baseUrl || !token) {
      throw new ScannerUnavailableError('Scanner is not configured');
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL('/scan', baseUrl), {
        method,
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ScannerUnavailableError(`Scanner request failed: ${(err as Error).message}`);
    }
    if (response.status === 409) {
      throw new ScannerBusyError();
    }
    if (!response.ok) {
      throw new ScannerUnavailableError(`Scanner answered HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ScannerUnavailableError('Scanner returned an unreadable response');
    }
    if (!isScanState(body)) {
      throw new ScannerUnavailableError('Scanner returned a malformed response');
    }
    return body;
  }

  return {
    getScan: () => call('GET'),
    startScan: () => call('POST'),
  };
}
