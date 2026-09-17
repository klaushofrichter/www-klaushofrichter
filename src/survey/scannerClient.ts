import { ScanState } from './types';

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
    try {
      return (await response.json()) as ScanState;
    } catch {
      throw new ScannerUnavailableError('Scanner returned an unreadable response');
    }
  }

  return {
    getScan: () => call('GET'),
    startScan: () => call('POST'),
  };
}
