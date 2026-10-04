import { vi } from 'vitest';
import { SESSION_COOKIE, signSession } from '../src/session';
import { ScannerClient } from '../src/survey/scannerClient';
import { Device, ScanState } from '../src/survey/types';

// Allow-listed by test/setup.ts.
export const TEST_EMAIL = 'allowed@example.com';

// A Cookie header value for a signed-in, allow-listed visitor.
export function sessionCookie(email: string = TEST_EMAIL): string {
  return `${SESSION_COOKIE}=${signSession(email)}`;
}

// A device with nothing found beyond its address.
export function makeDevice(ip: string, mac = 'aa:bb:cc:dd:ee:01', name: string | null = null): Device {
  return {
    ip, mac, name, vendor: null, privateMac: false, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

// A scanner client that reports `state` for both calls.
export function fakeScannerClient(state: ScanState) {
  return {
    getScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
    startScan: vi.fn<() => Promise<ScanState>>().mockResolvedValue(state),
  } satisfies ScannerClient;
}
