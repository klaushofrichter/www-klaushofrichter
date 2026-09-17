# IP Survey Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the privileged scanner service that discovers every device on the home LAN and serves it over the contract the website already consumes, then deploy it and run the first real scan.

**Architecture:** A second image from this repo (`scanner/`), running as a plain Kubernetes Deployment on the node's host network with only `NET_RAW`. It listens on the cluster bridge address (`10.42.0.1:9450`) — unreachable from the LAN — and requires a bearer token. A scan runs four stages (discovery, names, ports, web) into the `ScanResult` shape defined in `src/survey/types.ts`; the website polls `GET /scan` while it runs.

**Tech Stack:** Node 26 on `node:26-alpine` plus Alpine's `arp-scan`; TypeScript 7 (`nodenext`, CommonJS); `node:dgram`/`node:net`/`node:https`/`node:dns` for probing; `multicast-dns` for Bonjour; `cheerio` (already a dependency) for UPnP XML; vitest for tests.

**Spec:** `docs/superpowers/specs/2026-09-17-ip-survey-design.md`
**Predecessor:** `docs/superpowers/plans/2026-09-17-dashboard-ip-survey-website.md` (shipped as `v2026.09.17.1`)

## Global Constraints

- The scan range comes from configuration only (`SCAN_CIDR`), never from a request. No endpoint accepts a target.
- Every route except `GET /health` requires `Authorization: Bearer $SCANNER_TOKEN`. Compare with `crypto.timingSafeEqual`, not `===`.
- The server binds `BIND_ADDRESS` (`10.42.0.1` in production), never `0.0.0.0`. A LAN device must not be able to open a connection to it.
- One scan at a time. A second `POST /scan` while running returns `409 {"error":"busy"}`.
- The response shape is exactly `ScanState` from `src/survey/types.ts` — the website's `isScanState` guard rejects anything else, and that guard is the contract test.
- Every device in a finished result has a non-empty `ip` and `mac`. Discovery drops anything without both.
- Every outbound probe has a timeout. A scan must finish or fail; it must never hang.
- Text taken from devices (mDNS names, UPnP friendly names, HTML titles) is capped at 120 characters and stripped of control characters before it enters a result.
- The scanner never writes to disk. Saving is the website's job.
- Comments explain *why*, not *what*. TDD throughout.
- `npm run build`, `npm run build:scanner` and `npm test` pass before every commit.

## File map

| File | Responsibility |
|---|---|
| `src/survey/scannerClient.ts` (modify) | Validate device elements (Task 1) |
| `src/survey/store.ts` (modify) | Validate the file read back from disk (Task 1) |
| `scanner/src/config.ts` (new) | Environment → typed config, validated at startup |
| `scanner/src/discovery.ts` (new) | `arp-scan` invocation + parsing, self entry, private-MAC detection |
| `scanner/src/names.ts` (new) | Reverse DNS, mDNS, SSDP; merge by priority |
| `scanner/src/probes.ts` (new) | TCP port probe and HTTP title probe |
| `scanner/src/scan.ts` (new) | Stage orchestration → `ScanResult`, progress state |
| `scanner/src/server.ts` (new) | HTTP contract, token auth, single-flight |
| `scanner/Dockerfile` (new) | Scanner image |
| `tsconfig.scanner.json` (new) | Builds `scanner/src` + the shared types into `dist-scanner/` |
| `test/scanner/*.test.ts` (new) | Unit tests |
| `.github/workflows/deploy-production.yml` (modify) | Two images, scanner first, health smoke test |
| `kube-setup` manifests | Deployment, Secret, runner Role, website env |

---

### Task 1: Close the device-validation gap

The website persists whatever the scanner calls a device. A device object without `mac` is saved and then throws in `compareToSaved` on every later request — `GET /api/survey` and `/dashboard/ip-survey` return 500 permanently, recoverable only by deleting `latest.json` from the PVC. This is the prerequisite recorded at the end of the predecessor plan, and it must land before a real scanner can feed the page.

**Files:**
- Modify: `src/survey/scannerClient.ts`, `src/survey/store.ts`
- Test: `test/scannerClient.test.ts`, `test/surveyStore.test.ts`

**Interfaces:**
- Consumes: `ScanState`, `Device`, `SavedSurvey` from `src/survey/types.ts`
- Produces: no new exports — `isScanState` gets stricter, and `readSavedSurvey` validates what it reads.

- [ ] **Step 1: Write the failing tests**

Add to `test/scannerClient.test.ts`:

```ts
  it('rejects a finished scan whose devices are not all well formed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        state: 'finished',
        result: { scannedAt: '2026-09-17T12:00:00.000Z', cidr: '192.168.1.0/24', devices: [{ ip: '192.168.1.2' }] },
      }),
    );
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('rejects a device whose mac is not a string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        state: 'finished',
        result: {
          scannedAt: '2026-09-17T12:00:00.000Z',
          cidr: '192.168.1.0/24',
          devices: [{ ip: '192.168.1.2', mac: 42 }],
        },
      }),
    );
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('accepts a finished scan whose devices carry ip and mac', async () => {
    const result = {
      scannedAt: '2026-09-17T12:00:00.000Z',
      cidr: '192.168.1.0/24',
      devices: [{ ip: '192.168.1.2', mac: 'aa:bb:cc:dd:ee:ff' }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { state: 'finished', result }));
    const client = createScannerClient({ baseUrl: 'http://scanner.test', token: 't', fetchImpl });

    await expect(client.getScan()).resolves.toEqual({ state: 'finished', result });
  });
```

Add to `test/surveyStore.test.ts`:

```ts
  it('throws when the saved file has no devices array', async () => {
    await fs.writeFile(
      path.join(dir, 'latest.json'),
      JSON.stringify({ scannedAt: 'x', savedAt: 'y', cidr: 'z', version: 'dev' }),
    );

    await expect(readSavedSurvey(dir)).rejects.toThrow(/devices/);
  });

  it('throws when a saved device is missing its mac', async () => {
    await fs.writeFile(
      path.join(dir, 'latest.json'),
      JSON.stringify({ scannedAt: 'x', savedAt: 'y', cidr: 'z', version: 'dev', devices: [{ ip: '192.168.1.2' }] }),
    );

    await expect(readSavedSurvey(dir)).rejects.toThrow(/devices/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/scannerClient.test.ts test/surveyStore.test.ts`
Expected: the three new client tests fail (malformed devices are currently accepted); the two store tests fail (no validation today).

- [ ] **Step 3: Implement**

In `src/survey/scannerClient.ts`, add above `isScanState` and call it from the `finished` branch:

```ts
// Only ip and mac are required: everything else is presentational, but these
// two are read unguarded downstream - compareToSaved keys on mac, and a device
// without one throws on every later request once it has been saved.
function isDevice(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const device = value as { ip?: unknown; mac?: unknown };
  return typeof device.ip === 'string' && device.ip.length > 0
    && typeof device.mac === 'string' && device.mac.length > 0;
}
```

In the `finished` case of `isScanState`, replace the `Array.isArray(...)` check so it also requires `devices.every(isDevice)`.

In `src/survey/store.ts`, validate what comes back off disk — the same shape, reached through a different door:

```ts
function assertSavedSurvey(value: unknown): SavedSurvey {
  const survey = value as SavedSurvey | null;
  if (!survey || !Array.isArray(survey.devices)) {
    throw new Error('Saved survey is malformed: devices is not an array');
  }
  for (const device of survey.devices) {
    if (typeof device?.ip !== 'string' || typeof device?.mac !== 'string') {
      throw new Error('Saved survey is malformed: a device is missing ip or mac');
    }
  }
  return survey;
}
```

and return `assertSavedSurvey(JSON.parse(raw))` from `readSavedSurvey`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && npm test`
Expected: all pass, including the 138 existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/survey/scannerClient.ts src/survey/store.ts test/scannerClient.test.ts test/surveyStore.test.ts
git commit -m "Validate devices at both trust boundaries"
```

---

### Task 2: Scanner configuration and HTTP contract

**Files:**
- Create: `scanner/src/config.ts`, `scanner/src/server.ts`, `tsconfig.scanner.json`, `test/scanner/config.test.ts`, `test/scanner/server.test.ts`
- Modify: `package.json` (add `build:scanner` and `scanner` scripts)

**Interfaces:**
- Produces (`scanner/src/config.ts`):
  - `interface ScannerConfig { port: number; bindAddress: string; token: string; cidr: string; iface: string; version: string }`
  - `loadConfig(env?: NodeJS.ProcessEnv): ScannerConfig` — throws on a missing or malformed value
- Produces (`scanner/src/server.ts`):
  - `interface ScanRunner { getState(): ScanState; start(): boolean }` — `start` returns `false` when a scan is already running
  - `createServer(config: ScannerConfig, runner: ScanRunner): http.Server`
- Contract: `GET /health` → `200 {status:'ok',service:'www-scanner',version}` unauthenticated; `GET /scan` → `200 ScanState`; `POST /scan` → `202 ScanState` or `409 {error:'busy'}`; anything else → `404`; missing/wrong token on `/scan` → `401`.

- [ ] **Step 1: Write the failing tests**

Create `test/scanner/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../scanner/src/config';

const valid = {
  SCANNER_TOKEN: 'a-token',
  SCAN_CIDR: '192.168.1.0/24',
  SCAN_INTERFACE: 'eno1',
  BIND_ADDRESS: '10.42.0.1',
  SCANNER_PORT: '9450',
  APP_VERSION: '2026.09.18.1',
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    expect(loadConfig(valid)).toEqual({
      token: 'a-token', cidr: '192.168.1.0/24', iface: 'eno1',
      bindAddress: '10.42.0.1', port: 9450, version: '2026.09.18.1',
    });
  });

  it('defaults the port, bind address and version', () => {
    const config = loadConfig({ SCANNER_TOKEN: 't', SCAN_CIDR: '192.168.1.0/24', SCAN_INTERFACE: 'eno1' });

    expect(config.port).toBe(9450);
    expect(config.bindAddress).toBe('10.42.0.1');
    expect(config.version).toBe('dev');
  });

  it('refuses to start without a token', () => {
    expect(() => loadConfig({ SCAN_CIDR: '192.168.1.0/24', SCAN_INTERFACE: 'eno1' })).toThrow(/SCANNER_TOKEN/);
  });

  it('refuses a CIDR that is not a CIDR', () => {
    expect(() => loadConfig({ ...valid, SCAN_CIDR: '192.168.1.1' })).toThrow(/SCAN_CIDR/);
    expect(() => loadConfig({ ...valid, SCAN_CIDR: 'all-of-them' })).toThrow(/SCAN_CIDR/);
  });

  it('refuses an interface name that could reach a shell', () => {
    expect(() => loadConfig({ ...valid, SCAN_INTERFACE: 'eno1; rm -rf /' })).toThrow(/SCAN_INTERFACE/);
  });
});
```

Create `test/scanner/server.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/scanner`
Expected: FAIL — `scanner/src/config` and `scanner/src/server` do not exist.

- [ ] **Step 3: Implement the config**

Create `scanner/src/config.ts`:

```ts
// Everything the scanner is allowed to do is fixed here at startup. In
// particular the scan range: no request carries a target, so a stolen website
// session cannot turn this into a general-purpose scanner.
export interface ScannerConfig {
  port: number;
  bindAddress: string;
  token: string;
  cidr: string;
  iface: string;
  version: string;
}

const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
// arp-scan is spawned without a shell, but a strict interface name keeps the
// value from being interesting if that ever changes.
const IFACE = /^[A-Za-z0-9._-]{1,32}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScannerConfig {
  const token = env.SCANNER_TOKEN ?? '';
  if (token.length < 8) {
    throw new Error('SCANNER_TOKEN must be set to at least 8 characters');
  }
  const cidr = env.SCAN_CIDR ?? '';
  if (!CIDR.test(cidr)) {
    throw new Error(`SCAN_CIDR must be a CIDR range such as 192.168.1.0/24, got ${JSON.stringify(cidr)}`);
  }
  const iface = env.SCAN_INTERFACE ?? '';
  if (!IFACE.test(iface)) {
    throw new Error(`SCAN_INTERFACE must be an interface name, got ${JSON.stringify(iface)}`);
  }
  const port = Number(env.SCANNER_PORT ?? 9450);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SCANNER_PORT must be a port number, got ${JSON.stringify(env.SCANNER_PORT)}`);
  }
  return {
    token,
    cidr,
    iface,
    port,
    // The cluster bridge, not 0.0.0.0: on the host network a wildcard bind
    // would expose this to every device on the LAN.
    bindAddress: env.BIND_ADDRESS ?? '10.42.0.1',
    version: env.APP_VERSION ?? 'dev',
  };
}
```

- [ ] **Step 4: Implement the server**

Create `scanner/src/server.ts`:

```ts
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
```

- [ ] **Step 5: Add the build**

Create `tsconfig.scanner.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist-scanner",
    "rootDir": "."
  },
  "include": ["scanner/src/**/*.ts", "src/survey/types.ts"]
}
```

In `package.json` `scripts`, add after `"build"`:

```json
    "build:scanner": "tsc -p tsconfig.scanner.json",
    "scanner": "tsx scanner/src/main.ts",
```

Add `dist-scanner/` to `.gitignore` and to `.dockerignore`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/scanner && npm run build && npm run build:scanner && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scanner/src/config.ts scanner/src/server.ts tsconfig.scanner.json package.json .gitignore .dockerignore test/scanner
git commit -m "Add the scanner's configuration and HTTP contract"
```

---

### Task 3: Discovery — arp-scan

**Files:**
- Create: `scanner/src/discovery.ts`, `test/scanner/discovery.test.ts`, `test/scanner/fixtures/arp-scan-output.txt`

**Interfaces:**
- Consumes: `ScannerConfig` (Task 2), `Device` from `src/survey/types.ts`
- Produces:
  - `parseArpScan(stdout: string): Array<{ ip: string; mac: string; vendor: string | null }>`
  - `isPrivateMac(mac: string): boolean`
  - `discover(config: ScannerConfig, run?: (config: ScannerConfig) => Promise<string>): Promise<Device[]>` — `run` is injectable so tests never spawn anything
  - `selfDevice(iface: string, interfaces?: typeof os.networkInterfaces): Device | null`

- [ ] **Step 1: Write the failing test**

Create `test/scanner/fixtures/arp-scan-output.txt` — real `arp-scan --plain` output has three tab-separated columns:

```
192.168.1.1	04:42:1a:14:e8:00	ASUSTek COMPUTER INC.
192.168.1.10	00:1b:a9:44:55:66	Brother Industries, LTD.
192.168.1.50	dc:a6:32:77:88:99	Raspberry Pi Trading Ltd
192.168.1.120	6a:1f:22:33:44:55	(Unknown)
192.168.1.1	04:42:1a:14:e8:00	ASUSTek COMPUTER INC.
```

Create `test/scanner/discovery.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { discover, isPrivateMac, parseArpScan, selfDevice } from '../../scanner/src/discovery';
import { ScannerConfig } from '../../scanner/src/config';

const output = fs.readFileSync(path.join(__dirname, 'fixtures', 'arp-scan-output.txt'), 'utf8');

const config: ScannerConfig = {
  token: 't', cidr: '192.168.1.0/24', iface: 'eno1',
  bindAddress: '127.0.0.1', port: 9450, version: 'test',
};

describe('parseArpScan', () => {
  it('reads ip, mac and vendor from each line', () => {
    const rows = parseArpScan(output);

    expect(rows[0]).toEqual({ ip: '192.168.1.1', mac: '04:42:1a:14:e8:00', vendor: 'ASUSTek COMPUTER INC.' });
    expect(rows[1].vendor).toBe('Brother Industries, LTD.');
  });

  it('drops duplicate replies from the same MAC', () => {
    expect(parseArpScan(output)).toHaveLength(4);
  });

  it('treats (Unknown) as no vendor', () => {
    expect(parseArpScan(output)[3].vendor).toBeNull();
  });

  it('ignores blank lines and anything that is not three columns', () => {
    expect(parseArpScan('\nInterface: eno1, type: EN10MB\n192.168.1.2\taa:bb:cc:dd:ee:ff\tAcme\n\n')).toEqual([
      { ip: '192.168.1.2', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Acme' },
    ]);
  });
});

describe('isPrivateMac', () => {
  it('detects the locally-administered bit', () => {
    expect(isPrivateMac('6a:1f:22:33:44:55')).toBe(true);
    expect(isPrivateMac('02:00:00:00:00:01')).toBe(true);
  });

  it('treats a manufacturer-assigned address as not private', () => {
    expect(isPrivateMac('04:42:1a:14:e8:00')).toBe(false);
    expect(isPrivateMac('dc:a6:32:77:88:99')).toBe(false);
  });

  it('does not crash on a malformed address', () => {
    expect(isPrivateMac('nonsense')).toBe(false);
  });
});

describe('selfDevice', () => {
  it('builds a device from the scanning interface', () => {
    const device = selfDevice('eno1', () => ({
      eno1: [
        { address: 'fe80::1', family: 'IPv6', mac: '18:66:da:aa:bb:cc', internal: false, netmask: '', cidr: null, scopeid: 0 },
        { address: '192.168.1.103', family: 'IPv4', mac: '18:66:da:aa:bb:cc', internal: false, netmask: '255.255.255.0', cidr: '192.168.1.103/24' },
      ],
    }) as ReturnType<typeof import('node:os').networkInterfaces>);

    expect(device?.ip).toBe('192.168.1.103');
    expect(device?.mac).toBe('18:66:da:aa:bb:cc');
  });

  it('returns null when the interface is not there', () => {
    expect(selfDevice('eno1', () => ({}))).toBeNull();
  });
});

describe('discover', () => {
  it('returns one device per reply, marking private MACs', async () => {
    const run = vi.fn().mockResolvedValue(output);

    const devices = await discover(config, run);

    expect(run).toHaveBeenCalledWith(config);
    expect(devices).toHaveLength(4);
    expect(devices[0].vendor).toBe('ASUSTek COMPUTER INC.');
    expect(devices[3].privateMac).toBe(true);
    expect(devices[3].vendor).toBeNull();
    for (const device of devices) {
      expect(device.ip).toMatch(/^192\.168\.1\./);
      expect(device.mac).toMatch(/^[0-9a-f:]{17}$/);
      expect(device.ports).toEqual([]);
      expect(device.services).toEqual([]);
      expect(device.name).toBeNull();
    }
  });

  it('adds the scanning host, which never answers its own scan', async () => {
    const run = vi.fn().mockResolvedValue('192.168.1.1\t04:42:1a:14:e8:00\tASUSTek COMPUTER INC.\n');
    const self = { ip: '192.168.1.103', mac: '18:66:da:aa:bb:cc' };

    const devices = await discover(config, run, () => ({
      eno1: [{ address: self.ip, family: 'IPv4', mac: self.mac, internal: false, netmask: '', cidr: null }],
    }) as ReturnType<typeof import('node:os').networkInterfaces>);

    expect(devices.map((d) => d.ip)).toContain('192.168.1.103');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scanner/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scanner/src/discovery.ts`:

```ts
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { Device } from '../../src/survey/types';
import { ScannerConfig } from './config';

const execFileAsync = promisify(execFile);

// arp-scan --plain prints "ip<TAB>mac<TAB>vendor" and nothing else. Every
// device on the segment must answer ARP to be usable on it, so this finds
// hosts that drop pings and have no open ports.
export function parseArpScan(stdout: string): Array<{ ip: string; mac: string; vendor: string | null }> {
  const seen = new Set<string>();
  const rows: Array<{ ip: string; mac: string; vendor: string | null }> = [];
  for (const line of stdout.split('\n')) {
    const columns = line.split('\t');
    if (columns.length < 3) {
      continue;
    }
    const ip = columns[0].trim();
    const mac = columns[1].trim().toLowerCase();
    const vendor = columns[2].trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      continue;
    }
    // A host can answer twice; the second reply carries nothing new.
    if (seen.has(mac)) {
      continue;
    }
    seen.add(mac);
    rows.push({ ip, mac, vendor: vendor && vendor !== '(Unknown)' ? vendor : null });
  }
  return rows;
}

// Phones set this bit when they use a per-network random address, which is why
// their manufacturer cannot be looked up: there is no manufacturer.
export function isPrivateMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isNaN(first) ? false : (first & 0x02) === 0x02;
}

function toDevice(row: { ip: string; mac: string; vendor: string | null }): Device {
  const privateMac = isPrivateMac(row.mac);
  return {
    ip: row.ip,
    mac: row.mac,
    // A randomized address has no owner to look up, so an OUI hit would be a
    // coincidence rather than information.
    vendor: privateMac ? null : row.vendor,
    privateMac,
    name: null,
    nameSource: null,
    web: null,
    services: [],
    ports: [],
    rttMs: null,
  };
}

export function selfDevice(
  iface: string,
  interfaces: typeof os.networkInterfaces = os.networkInterfaces,
): Device | null {
  const addresses = interfaces()[iface];
  const ipv4 = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
  if (!ipv4 || !ipv4.mac) {
    return null;
  }
  return toDevice({ ip: ipv4.address, mac: ipv4.mac.toLowerCase(), vendor: null });
}

async function runArpScan(config: ScannerConfig): Promise<string> {
  // execFile, not exec: no shell, so the configured values are arguments
  // rather than something a shell could reinterpret.
  const { stdout } = await execFileAsync(
    'arp-scan',
    ['--interface', config.iface, '--plain', '--retry=2', '--timeout=200', config.cidr],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

export async function discover(
  config: ScannerConfig,
  run: (config: ScannerConfig) => Promise<string> = runArpScan,
  interfaces: typeof os.networkInterfaces = os.networkInterfaces,
): Promise<Device[]> {
  const devices = parseArpScan(await run(config)).map(toDevice);
  const self = selfDevice(config.iface, interfaces);
  // The scanning host does not answer its own ARP requests, so without this
  // the node running the scanner is the one device missing from the survey.
  if (self && !devices.some((device) => device.mac === self.mac)) {
    devices.push(self);
  }
  return devices;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/scanner && npm run build:scanner`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/discovery.ts test/scanner/discovery.test.ts test/scanner/fixtures/arp-scan-output.txt
git commit -m "Discover LAN devices with arp-scan"
```

---

### Task 4: Names — reverse DNS, mDNS and SSDP

**Files:**
- Create: `scanner/src/names.ts`, `test/scanner/names.test.ts`
- Modify: `package.json` (add the `multicast-dns` dependency)

**Interfaces:**
- Consumes: `Device`, `NameSource` from `src/survey/types.ts`
- Produces:
  - `cleanText(value: string | null | undefined, max?: number): string | null` — trims, strips control characters, caps at 120
  - `serviceLabel(serviceType: string): string | null` — `_googlecast._tcp` → `Chromecast`, and the rest of the table below
  - `parseUpnpDescription(xml: string): { name: string | null; model: string | null }`
  - `mergeNames(device: Device, found: { mdns?: string | null; ssdp?: string | null; dns?: string | null; services?: string[] }): Device` — precedence mDNS > SSDP > DNS
  - `resolveNames(devices: Device[], options: NameOptions): Promise<Device[]>` where `NameOptions` injects each lookup so tests do no I/O

- [ ] **Step 1: Add the dependency and its types**

Run: `npm install multicast-dns@^7.2.5`
`multicast-dns` is a small, dependency-light Bonjour implementation; writing DNS packet encoding by hand for this is not worth it. It goes in `dependencies` (the scanner is a production artifact), which also puts it under Dependabot.

It ships no type declarations, and `strict` TypeScript will not import it untyped. Create `scanner/src/multicast-dns.d.ts` declaring only what this code uses:

```ts
// multicast-dns ships no types. Declared narrowly on purpose: widening this
// later is easy, whereas an `any` here would quietly cover a misuse.
declare module 'multicast-dns' {
  interface MdnsRecord {
    name: string;
    type: string;
    data?: unknown;
  }
  interface MdnsResponse {
    answers: MdnsRecord[];
    additionals?: MdnsRecord[];
  }
  interface Mdns {
    on(event: 'response', listener: (response: MdnsResponse) => void): void;
    query(query: { questions: Array<{ name: string; type: string }> }): void;
    destroy(): void;
  }
  export default function makeMdns(): Mdns;
}
```

With that declared, the `response` parameter in `collectMdns` is typed already — drop the inline annotation and write `mdns.on('response', (response) => {`.

- [ ] **Step 2: Write the failing test**

Create `test/scanner/names.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cleanText, mergeNames, parseUpnpDescription, resolveNames, serviceLabel } from '../../scanner/src/names';
import { Device } from '../../src/survey/types';

function device(ip: string, mac: string): Device {
  return {
    ip, mac, vendor: null, privateMac: false, name: null, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

describe('cleanText', () => {
  it('trims and caps long values', () => {
    expect(cleanText('  Living Room TV  ')).toBe('Living Room TV');
    expect(cleanText('x'.repeat(400))?.length).toBe(120);
  });

  it('strips control characters a device could send', () => {
    expect(cleanText('Lab  bench\n')).toBe('Lab bench');
  });

  it('returns null for nothing useful', () => {
    expect(cleanText('')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe('serviceLabel', () => {
  it('maps known service types to readable labels', () => {
    expect(serviceLabel('_googlecast._tcp')).toBe('Chromecast');
    expect(serviceLabel('_airplay._tcp')).toBe('AirPlay');
    expect(serviceLabel('_ipp._tcp')).toBe('Printer');
    expect(serviceLabel('_hap._tcp')).toBe('HomeKit');
    expect(serviceLabel('_ssh._tcp')).toBe('SSH');
  });

  it('ignores service types it has no label for', () => {
    expect(serviceLabel('_weird._udp')).toBeNull();
  });
});

describe('parseUpnpDescription', () => {
  it('reads the friendly name and model', () => {
    const xml = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
      <friendlyName>Living Room TV</friendlyName><modelName>KD-55X80J</modelName></device></root>`;

    expect(parseUpnpDescription(xml)).toEqual({ name: 'Living Room TV', model: 'KD-55X80J' });
  });

  it('survives XML it cannot understand', () => {
    expect(parseUpnpDescription('not xml at all')).toEqual({ name: null, model: null });
  });
});

describe('mergeNames', () => {
  const base = device('192.168.1.50', 'aa:bb:cc:dd:ee:01');

  it('prefers mDNS over SSDP and DNS', () => {
    const merged = mergeNames(base, { mdns: 'homeassistant.local', ssdp: 'Home Assistant', dns: 'ha' });

    expect(merged.name).toBe('homeassistant.local');
    expect(merged.nameSource).toBe('mdns');
  });

  it('falls back to SSDP, then DNS', () => {
    expect(mergeNames(base, { ssdp: 'Living Room TV', dns: 'tv' }).nameSource).toBe('ssdp');
    expect(mergeNames(base, { dns: 'printer' }).nameSource).toBe('dns');
  });

  it('leaves a device with no name alone', () => {
    const merged = mergeNames(base, {});

    expect(merged.name).toBeNull();
    expect(merged.nameSource).toBeNull();
  });

  it('records services and drops duplicates', () => {
    expect(mergeNames(base, { services: ['Printer', 'Printer', 'AirPlay'] }).services).toEqual(['Printer', 'AirPlay']);
  });
});

describe('resolveNames', () => {
  it('asks every source and merges the answers', async () => {
    const devices = [device('192.168.1.50', 'aa:bb:cc:dd:ee:01'), device('192.168.1.60', 'aa:bb:cc:dd:ee:02')];

    const named = await resolveNames(devices, {
      reverseDns: async (ip) => (ip === '192.168.1.50' ? 'ha' : null),
      mdns: async () => new Map([['192.168.1.50', { name: 'homeassistant.local', services: ['Home Assistant'] }]]),
      ssdp: async () => new Map([['192.168.1.60', { name: 'Living Room TV', model: 'KD-55X80J' }]]),
    });

    expect(named[0].name).toBe('homeassistant.local');
    expect(named[0].nameSource).toBe('mdns');
    expect(named[0].services).toEqual(['Home Assistant']);
    expect(named[1].name).toBe('Living Room TV');
    expect(named[1].nameSource).toBe('ssdp');
  });

  it('keeps going when a source fails outright', async () => {
    const devices = [device('192.168.1.50', 'aa:bb:cc:dd:ee:01')];

    const named = await resolveNames(devices, {
      reverseDns: async () => 'ha',
      mdns: async () => { throw new Error('no multicast here'); },
      ssdp: async () => { throw new Error('nor here'); },
    });

    expect(named[0].name).toBe('ha');
    expect(named[0].nameSource).toBe('dns');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/scanner/names.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `scanner/src/names.ts`:

```ts
import dns from 'node:dns';
import dgram from 'node:dgram';
import * as cheerio from 'cheerio';
import makeMdns from 'multicast-dns';
import { Device, NameSource } from '../../src/survey/types';

const MAX_TEXT = 120;

// Everything here comes from whatever answered on the network, so it is capped
// and stripped before it can reach a saved survey or a browser.
export function cleanText(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

const SERVICE_LABELS: Record<string, string> = {
  _googlecast: 'Chromecast',
  _airplay: 'AirPlay',
  _raop: 'AirPlay',
  _ipp: 'Printer',
  _ipps: 'Printer',
  _printer: 'Printer',
  _pdl_datastream: 'Printer',
  _hap: 'HomeKit',
  _homekit: 'HomeKit',
  _ssh: 'SSH',
  _smb: 'File sharing',
  _afpovertcp: 'File sharing',
  _spotify_connect: 'Spotify',
  _sonos: 'Sonos',
  _hue: 'Hue bridge',
  _http: 'Web',
};

export function serviceLabel(serviceType: string): string | null {
  return SERVICE_LABELS[serviceType.split('.')[0]] ?? null;
}

export function parseUpnpDescription(xml: string): { name: string | null; model: string | null } {
  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    return {
      name: cleanText($('friendlyName').first().text()),
      model: cleanText($('modelName').first().text()),
    };
  } catch {
    return { name: null, model: null };
  }
}

export interface FoundNames {
  mdns?: string | null;
  ssdp?: string | null;
  dns?: string | null;
  services?: string[];
}

// mDNS first: a device's own advertised name is what its owner recognises.
// SSDP next, then whatever the router's DHCP table remembers.
export function mergeNames(device: Device, found: FoundNames): Device {
  const candidates: Array<[NameSource, string | null]> = [
    ['mdns', cleanText(found.mdns)],
    ['ssdp', cleanText(found.ssdp)],
    ['dns', cleanText(found.dns)],
  ];
  const chosen = candidates.find(([, name]) => name !== null);
  return {
    ...device,
    name: chosen ? chosen[1] : null,
    nameSource: chosen ? chosen[0] : null,
    services: Array.from(new Set(found.services ?? [])),
  };
}

export interface NameOptions {
  reverseDns(ip: string): Promise<string | null>;
  mdns(): Promise<Map<string, { name: string | null; services: string[] }>>;
  ssdp(): Promise<Map<string, { name: string | null; model: string | null }>>;
}

export async function resolveNames(devices: Device[], options: NameOptions): Promise<Device[]> {
  // One broken source must not cost the whole stage: a scan with fewer names
  // is still a useful scan.
  const [mdnsResult, ssdpResult] = await Promise.all([
    options.mdns().catch(() => new Map()),
    options.ssdp().catch(() => new Map()),
  ]);
  return Promise.all(
    devices.map(async (device) => {
      const reverse = await options.reverseDns(device.ip).catch(() => null);
      const mdns = mdnsResult.get(device.ip);
      const ssdp = ssdpResult.get(device.ip);
      return mergeNames(device, {
        mdns: mdns?.name ?? null,
        ssdp: ssdp?.name ?? null,
        dns: reverse,
        services: mdns?.services ?? [],
      });
    }),
  );
}

// --- real implementations, injected in production and replaced in tests ---

export function reverseDnsVia(server: string): (ip: string) => Promise<string | null> {
  const resolver = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers([server]);
  return async (ip) => {
    try {
      const names = await resolver.reverse(ip);
      return cleanText(names[0] ?? null);
    } catch {
      return null;
    }
  };
}

export function collectMdns(durationMs = 4000): () => Promise<Map<string, { name: string | null; services: string[] }>> {
  return () =>
    new Promise((resolve) => {
      const found = new Map<string, { name: string | null; services: string[] }>();
      const mdns = makeMdns();
      mdns.on('response', (response: { answers: Array<Record<string, unknown>>; additionals?: Array<Record<string, unknown>> }) => {
        for (const record of [...response.answers, ...(response.additionals ?? [])]) {
          const type = record.type as string;
          const name = record.name as string;
          if (type === 'A' && typeof record.data === 'string') {
            const entry = found.get(record.data) ?? { name: null, services: [] };
            entry.name = entry.name ?? cleanText(name);
            found.set(record.data, entry);
          }
          if (type === 'PTR' && typeof name === 'string') {
            const label = serviceLabel(name);
            if (label) {
              for (const entry of found.values()) {
                if (!entry.services.includes(label)) {
                  entry.services.push(label);
                }
              }
            }
          }
        }
      });
      mdns.query({ questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }] });
      setTimeout(() => {
        mdns.destroy();
        resolve(found);
      }, durationMs);
    });
}

export function collectSsdp(durationMs = 4000, fetchDescription = fetchUpnpDescription):
  () => Promise<Map<string, { name: string | null; model: string | null }>> {
  return () =>
    new Promise((resolve) => {
      const locations = new Map<string, string>();
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const search = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n',
      );
      socket.on('message', (message, remote) => {
        const location = /^location:\s*(\S+)/im.exec(message.toString())?.[1];
        if (location && !locations.has(remote.address)) {
          locations.set(remote.address, location);
        }
      });
      socket.on('error', () => {
        socket.close();
        resolve(new Map());
      });
      socket.bind(() => socket.send(search, 1900, '239.255.255.250'));
      setTimeout(async () => {
        socket.close();
        const found = new Map<string, { name: string | null; model: string | null }>();
        await Promise.all(
          Array.from(locations.entries()).map(async ([ip, location]) => {
            found.set(ip, await fetchDescription(location));
          }),
        );
        resolve(found);
      }, durationMs);
    });
}

async function fetchUpnpDescription(location: string): Promise<{ name: string | null; model: string | null }> {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return { name: null, model: null };
    }
    return parseUpnpDescription((await response.text()).slice(0, 64 * 1024));
  } catch {
    return { name: null, model: null };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/scanner && npm run build:scanner && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scanner/src/names.ts test/scanner/names.test.ts package.json package-lock.json
git commit -m "Name discovered devices from mDNS, SSDP and the router's DNS"
```

---

### Task 5: Ports and web pages

**Files:**
- Create: `scanner/src/probes.ts`, `test/scanner/probes.test.ts`

**Interfaces:**
- Consumes: `Device`, `DevicePort`, `WebInfo` from `src/survey/types.ts`
- Produces:
  - `PORTS: ReadonlyArray<{ port: number; service: string; web: boolean }>` — the 16 ports from the spec
  - `extractTitle(html: string): string | null`
  - `probePort(ip, port, timeoutMs, connect?): Promise<boolean>`
  - `probeWeb(ip, port, timeoutMs, get?): Promise<WebInfo | null>`
  - `probeDevices(devices: Device[], options?: ProbeOptions): Promise<Device[]>` — fills `ports` and `web`, injectable throughout

- [ ] **Step 1: Write the failing test**

Create `test/scanner/probes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractTitle, PORTS, probeDevices } from '../../scanner/src/probes';
import { Device } from '../../src/survey/types';

function device(ip: string): Device {
  return {
    ip, mac: 'aa:bb:cc:dd:ee:01', vendor: null, privateMac: false, name: null, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

describe('PORTS', () => {
  it('covers the ports the design names, and no others', () => {
    expect(PORTS.map((p) => p.port)).toEqual(
      [22, 53, 80, 443, 445, 554, 631, 1883, 5000, 5001, 8008, 8009, 8080, 8123, 8443, 9100],
    );
  });

  it('marks the web ports', () => {
    const web = PORTS.filter((p) => p.web).map((p) => p.port);

    expect(web).toContain(80);
    expect(web).toContain(8123);
    expect(web).not.toContain(22);
  });
});

describe('extractTitle', () => {
  it('reads the title element', () => {
    expect(extractTitle('<html><head><title>Home Assistant</title></head></html>')).toBe('Home Assistant');
  });

  it('handles attributes, newlines and entities', () => {
    expect(extractTitle('<title lang="en">\n  Brother &amp; Sons\n</title>')).toBe('Brother & Sons');
  });

  it('returns null when there is no title', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull();
    expect(extractTitle('')).toBeNull();
  });

  it('caps an absurd title', () => {
    expect(extractTitle(`<title>${'x'.repeat(500)}</title>`)?.length).toBe(120);
  });
});

describe('probeDevices', () => {
  it('records open ports and the web page behind them', async () => {
    const connect = vi.fn(async (ip: string, port: number) => ip === '192.168.1.50' && (port === 22 || port === 8123));
    const get = vi.fn(async () => ({ url: 'http://192.168.1.50:8123', title: 'Home Assistant' }));

    const [probed] = await probeDevices([device('192.168.1.50')], { connect, get, timeoutMs: 10 });

    expect(probed.ports.map((p) => p.port)).toEqual([22, 8123]);
    expect(probed.ports[0]).toEqual({ port: 22, service: 'SSH', web: null });
    expect(probed.web).toEqual({ url: 'http://192.168.1.50:8123', title: 'Home Assistant' });
  });

  it('leaves a silent device with nothing rather than guessing', async () => {
    const [probed] = await probeDevices([device('192.168.1.120')], {
      connect: async () => false,
      get: async () => null,
      timeoutMs: 10,
    });

    expect(probed.ports).toEqual([]);
    expect(probed.web).toBeNull();
  });

  it('does not let one unreachable device fail the others', async () => {
    const connect = vi.fn(async (ip: string) => {
      if (ip === '192.168.1.9') throw new Error('EHOSTUNREACH');
      return true;
    });

    const probed = await probeDevices([device('192.168.1.9'), device('192.168.1.10')], {
      connect, get: async () => null, timeoutMs: 10,
    });

    expect(probed[0].ports).toEqual([]);
    expect(probed[1].ports.length).toBe(PORTS.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scanner/probes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scanner/src/probes.ts`:

```ts
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Device, DevicePort, WebInfo } from '../../src/survey/types';
import { cleanText } from './names';

// A short, deliberate list. A full port scan takes minutes and rarely answers
// "what is this device?" better than these do.
export const PORTS: ReadonlyArray<{ port: number; service: string; web: boolean }> = [
  { port: 22, service: 'SSH', web: false },
  { port: 53, service: 'DNS', web: false },
  { port: 80, service: 'Web', web: true },
  { port: 443, service: 'Web (TLS)', web: true },
  { port: 445, service: 'Windows file sharing', web: false },
  { port: 554, service: 'Camera (RTSP)', web: false },
  { port: 631, service: 'Printer (IPP)', web: false },
  { port: 1883, service: 'MQTT', web: false },
  { port: 5000, service: 'Synology', web: true },
  { port: 5001, service: 'Synology (TLS)', web: true },
  { port: 8008, service: 'Chromecast', web: false },
  { port: 8009, service: 'Chromecast', web: false },
  { port: 8080, service: 'Web (alt)', web: true },
  { port: 8123, service: 'Home Assistant', web: true },
  { port: 8443, service: 'Web (alt TLS)', web: true },
  { port: 9100, service: 'Printer (raw)', web: false },
];

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) {
    return null;
  }
  const decoded = match[1].replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);
  return cleanText(decoded);
}

export type Connect = (ip: string, port: number, timeoutMs: number) => Promise<boolean>;
export type Get = (ip: string, port: number, timeoutMs: number) => Promise<WebInfo | null>;

export interface ProbeOptions {
  connect?: Connect;
  get?: Get;
  timeoutMs?: number;
  concurrency?: number;
}

export const tcpConnect: Connect = (ip, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, ip);
  });

// Home devices almost all present self-signed certificates. This reads a page
// title and nothing else, so accepting them costs nothing; no credential is
// ever sent to these hosts.
export const httpGet: Get = (ip, port, timeoutMs) =>
  new Promise((resolve) => {
    const tls = port === 443 || port === 8443 || port === 5001;
    const url = `${tls ? 'https' : 'http'}://${ip}:${port}/`;
    // Typed as https options because rejectUnauthorized only exists there;
    // http.get ignores the extra field.
    const options: https.RequestOptions = {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: { accept: 'text/html' },
    };
    const request = (tls ? https : http).get(url, options, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          // A title lives in the head; 64KB is generous and bounds a device
          // that would otherwise stream forever.
          if (body.length > 64 * 1024) {
            request.destroy();
          }
        });
      response.on('end', () => resolve({ url, title: extractTitle(body) }));
      response.on('error', () => resolve({ url, title: extractTitle(body) }));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function probeDevices(devices: Device[], options: ProbeOptions = {}): Promise<Device[]> {
  const connect = options.connect ?? tcpConnect;
  const get = options.get ?? httpGet;
  const timeoutMs = options.timeoutMs ?? 500;
  const concurrency = options.concurrency ?? 32;

  return mapWithLimit(devices, 8, async (device) => {
    const open = await mapWithLimit(PORTS.slice(), concurrency, async (candidate) => {
      // One refusing host must not take the stage down with it.
      const isOpen = await connect(device.ip, candidate.port, timeoutMs).catch(() => false);
      return isOpen ? candidate : null;
    });
    const ports: DevicePort[] = [];
    let web: WebInfo | null = null;
    for (const candidate of open) {
      if (!candidate) {
        continue;
      }
      let portWeb: WebInfo | null = null;
      if (candidate.web) {
        portWeb = await get(device.ip, candidate.port, Math.max(timeoutMs, 2000)).catch(() => null);
        // The first responding web port becomes the device's link.
        web = web ?? portWeb;
      }
      ports.push({ port: candidate.port, service: candidate.service, web: portWeb });
    }
    return { ...device, ports, web };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/scanner && npm run build:scanner && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/probes.ts test/scanner/probes.test.ts
git commit -m "Probe common ports and read web page titles"
```

---

### Task 6: Stage orchestration and the entry point

**Files:**
- Create: `scanner/src/scan.ts`, `scanner/src/main.ts`, `test/scanner/scan.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5
- Produces:
  - `createRunner(config: ScannerConfig, stages?: Stages): ScanRunner & { whenIdle(): Promise<void> }`
  - `interface Stages { discover(): Promise<Device[]>; names(devices: Device[]): Promise<Device[]>; probe(devices: Device[]): Promise<Device[]> }`
- The runner moves `idle → running(discovery) → running(names) → running(ports) → running(web) → finished`, or `failed` with a message. It never throws out of `start()`.

- [ ] **Step 1: Write the failing test**

Create `test/scanner/scan.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRunner } from '../../scanner/src/scan';
import { ScannerConfig } from '../../scanner/src/config';
import { Device } from '../../src/survey/types';

const config: ScannerConfig = {
  token: 't', cidr: '192.168.1.0/24', iface: 'eno1', bindAddress: '127.0.0.1', port: 9450, version: 'test',
};

function device(ip: string): Device {
  return {
    ip, mac: 'aa:bb:cc:dd:ee:01', vendor: null, privateMac: false, name: null, nameSource: null,
    web: null, services: [], ports: [], rttMs: null,
  };
}

describe('createRunner', () => {
  it('starts idle', () => {
    expect(createRunner(config, {
      discover: async () => [], names: async (d) => d, probe: async (d) => d,
    }).getState()).toEqual({ state: 'idle' });
  });

  it('reports each stage and finishes with the devices', async () => {
    const stages = {
      discover: vi.fn(async () => [device('192.168.1.50')]),
      names: vi.fn(async (d: Device[]) => d.map((x) => ({ ...x, name: 'ha' }))),
      probe: vi.fn(async (d: Device[]) => d),
    };
    const runner = createRunner(config, stages);

    expect(runner.start()).toBe(true);
    const running = runner.getState();
    expect(running.state).toBe('running');
    if (running.state === 'running') {
      expect(running.stage).toBe('discovery');
      expect(running.stageCount).toBe(4);
    }

    await runner.whenIdle();

    const finished = runner.getState();
    expect(finished.state).toBe('finished');
    if (finished.state === 'finished') {
      expect(finished.result.cidr).toBe('192.168.1.0/24');
      expect(finished.result.devices).toHaveLength(1);
      expect(finished.result.devices[0].name).toBe('ha');
      expect(Date.parse(finished.result.scannedAt)).not.toBeNaN();
    }
    expect(stages.discover).toHaveBeenCalledTimes(1);
  });

  it('refuses a second scan while one is running', async () => {
    const runner = createRunner(config, {
      discover: async () => { await new Promise((r) => setTimeout(r, 20)); return []; },
      names: async (d) => d,
      probe: async (d) => d,
    });

    expect(runner.start()).toBe(true);
    expect(runner.start()).toBe(false);
    await runner.whenIdle();
    expect(runner.start()).toBe(true);
    await runner.whenIdle();
  });

  it('records a failure instead of throwing, and can scan again afterwards', async () => {
    const runner = createRunner(config, {
      discover: async () => { throw new Error('arp-scan exited 1'); },
      names: async (d) => d,
      probe: async (d) => d,
    });

    runner.start();
    await runner.whenIdle();

    const state = runner.getState();
    expect(state.state).toBe('failed');
    if (state.state === 'failed') {
      expect(state.error).toContain('arp-scan exited 1');
    }
    expect(runner.start()).toBe(true);
    await runner.whenIdle();
  });

  it('keeps the last finished result until the next scan starts', async () => {
    const runner = createRunner(config, {
      discover: async () => [device('192.168.1.2')], names: async (d) => d, probe: async (d) => d,
    });

    runner.start();
    await runner.whenIdle();
    expect(runner.getState().state).toBe('finished');

    runner.start();
    expect(runner.getState().state).toBe('running');
    await runner.whenIdle();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scanner/scan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scanner/src/scan.ts`:

```ts
import { Device, ScanStage, ScanState } from '../../src/survey/types';
import { ScannerConfig } from './config';
import { discover } from './discovery';
import { collectMdns, collectSsdp, resolveNames, reverseDnsVia } from './names';
import { probeDevices } from './probes';
import { ScanRunner } from './server';

export interface Stages {
  discover(): Promise<Device[]>;
  names(devices: Device[]): Promise<Device[]>;
  probe(devices: Device[]): Promise<Device[]>;
}

const STAGE_ORDER: ScanStage[] = ['discovery', 'names', 'ports', 'web'];

// The router is the DNS server that knows DHCP hostnames: x.x.x.1 on a home
// network laid out the way this one is.
function routerAddress(cidr: string): string {
  const [network] = cidr.split('/');
  const octets = network.split('.');
  return `${octets[0]}.${octets[1]}.${octets[2]}.1`;
}

export function defaultStages(config: ScannerConfig): Stages {
  return {
    discover: () => discover(config),
    names: (devices) =>
      resolveNames(devices, {
        reverseDns: reverseDnsVia(routerAddress(config.cidr)),
        mdns: collectMdns(),
        ssdp: collectSsdp(),
      }),
    // Ports and web are one pass over the network but two reported stages:
    // the web probes only run against ports the same pass just found open.
    probe: (devices) => probeDevices(devices),
  };
}

export function createRunner(
  config: ScannerConfig,
  stages: Stages = defaultStages(config),
): ScanRunner & { whenIdle(): Promise<void> } {
  let state: ScanState = { state: 'idle' };
  let running: Promise<void> | null = null;

  function setStage(stage: ScanStage, startedAt: string): void {
    state = {
      state: 'running',
      stage,
      stageIndex: STAGE_ORDER.indexOf(stage) + 1,
      stageCount: STAGE_ORDER.length,
      startedAt,
    };
  }

  async function run(): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      setStage('discovery', startedAt);
      const discovered = await stages.discover();

      setStage('names', startedAt);
      const named = await stages.names(discovered);

      setStage('ports', startedAt);
      const probed = await stages.probe(named);

      setStage('web', startedAt);
      state = {
        state: 'finished',
        result: { scannedAt: new Date().toISOString(), cidr: config.cidr, devices: probed },
      };
    } catch (err) {
      // A failed scan is a reportable state, not a crash: the website shows the
      // message and the next scan can still be started.
      state = { state: 'failed', error: (err as Error).message, finishedAt: new Date().toISOString() };
    } finally {
      running = null;
    }
  }

  return {
    getState: () => state,
    start: () => {
      if (running) {
        return false;
      }
      running = run();
      return true;
    },
    whenIdle: async () => {
      while (running) {
        await running;
      }
    },
  };
}
```

Create `scanner/src/main.ts`:

```ts
import { loadConfig } from './config';
import { createRunner } from './scan';
import { createServer } from './server';

const config = loadConfig();
const runner = createRunner(config);
const server = createServer(config, runner);

server.listen(config.port, config.bindAddress, () => {
  // Deliberately logs the bind address and range, and never the token.
  console.log(`www-scanner ${config.version} listening on ${config.bindAddress}:${config.port}, range ${config.cidr}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/scanner && npm run build:scanner && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scanner/src/scan.ts scanner/src/main.ts test/scanner/scan.test.ts
git commit -m "Run the four scan stages and serve their progress"
```

---

### Task 7: Scanner image and the two-image deploy

**Files:**
- Create: `scanner/Dockerfile`
- Modify: `.github/workflows/deploy-production.yml`, `.dockerignore`

**Interfaces:**
- Produces: image `ghcr.io/klaushofrichter/www-klaushofrichter-scanner:<sha>` and `:v<version>`
- The deploy updates the scanner **first**, then the website.

- [ ] **Step 1: Write the Dockerfile**

Create `scanner/Dockerfile`:

```dockerfile
FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.scanner.json ./
COPY src/survey ./src/survey
COPY scanner/src ./scanner/src
RUN npm run build:scanner

FROM node:26-alpine
WORKDIR /app
# The whole reason this service exists: arp-scan needs raw sockets, which the
# website's pod deliberately does not have.
RUN apk add --no-cache arp-scan
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist-scanner ./dist-scanner
# Runs as root with every capability dropped except NET_RAW (see the
# Deployment). Root in the container plus one capability is a smaller surface
# than a setcap binary with allowPrivilegeEscalation left on.
EXPOSE 9450
CMD ["node", "dist-scanner/scanner/src/main.js"]
```

- [ ] **Step 2: Verify the image builds and runs**

```bash
docker build -f scanner/Dockerfile -t www-scanner:test .
docker run --rm www-scanner:test sh -c 'arp-scan --version | head -1; node -e "require(\"/app/dist-scanner/scanner/src/config.js\"); console.log(\"config module loads\")"'
docker run --rm -e SCANNER_TOKEN=test-token-value -e SCAN_CIDR=192.168.1.0/24 -e SCAN_INTERFACE=eth0 \
  -e BIND_ADDRESS=0.0.0.0 -p 19450:9450 -d --name scanner-smoke www-scanner:test
sleep 2 && curl -s http://localhost:19450/health; echo
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:19450/scan
docker rm -f scanner-smoke && docker rmi www-scanner:test
```

Expected: an `arp-scan` version line, `config module loads`, `{"status":"ok","service":"www-scanner","version":"dev"}`, and `401` for `/scan` without a token.

If the Docker daemon is unavailable, record that and move on — CI builds the image on the next push.

- [ ] **Step 3: Update the deploy workflow**

In `.github/workflows/deploy-production.yml`, after the existing `Build and push` step, add:

```yaml
      - name: Build and push the scanner
        uses: docker/build-push-action@v7
        with:
          context: .
          file: scanner/Dockerfile
          push: true
          build-args: |
            APP_VERSION=${{ steps.ver.outputs.version }}
          tags: |
            ghcr.io/klaushofrichter/www-klaushofrichter-scanner:${{ github.sha }}
            ghcr.io/klaushofrichter/www-klaushofrichter-scanner:v${{ steps.ver.outputs.version }}
```

In the `Update kube-setup manifest and deploy` step, before the existing `kubectl apply` of the ksvc, add the scanner rollout:

```bash
          sed -i "s|image: ghcr.io/klaushofrichter/www-klaushofrichter-scanner:.*|image: ghcr.io/klaushofrichter/www-klaushofrichter-scanner:${SHA}|" manifests/www-klaushofrichter/www-scanner-deployment.yaml
          # set image, not apply: the runner may patch this one Deployment and
          # nothing else, so it can never create a privileged pod spec of its own.
          kubectl set image deployment/www-scanner -n www-klaushofrichter \
            scanner="ghcr.io/klaushofrichter/www-klaushofrichter-scanner:${SHA}"
          kubectl rollout status deployment/www-scanner -n www-klaushofrichter --timeout=120s
```

(The scanner goes first: a new website must never talk to an older scanner.)

In the `Smoke-test the public endpoints` step, after the `/public` check, add:

```bash
          # The scanner has no public hostname, so this is the only place its
          # health is checked. Never starts a scan: deploys must not scan the LAN.
          scanner=$(curl -s -o /tmp/scanner.json -w "%{http_code}" "http://10.42.0.1:9450/health")
          [ "$scanner" = "200" ] || { echo "::error::scanner /health returned ${scanner}"; exit 1; }
          grep -q "\"version\":\"${VERSION}\"" /tmp/scanner.json \
            || { echo "::error::scanner reports $(cat /tmp/scanner.json), expected ${VERSION}"; exit 1; }
          echo "scanner ok"
```

- [ ] **Step 4: Validate the workflow**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-production.yml')); print('valid')"`
Expected: `valid`.

- [ ] **Step 5: Commit**

```bash
git add scanner/Dockerfile .github/workflows/deploy-production.yml .dockerignore
git commit -m "Build and deploy the scanner image alongside the website"
```

---

### Task 8: Cluster manifests

**Controller-only task** — it touches the `kube-setup` repository and the live cluster. An implementer subagent must not run it.

**Files (in `../kube-setup`):**
- Create: `manifests/www-klaushofrichter/www-scanner-deployment.yaml`
- Modify: `manifests/www-klaushofrichter/www-ksvc.yaml`, `manifests/www-klaushofrichter-runner/rbac.yaml`

- [ ] **Step 1: Confirm the port is free on the node**

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl get pods -A -o json | python3 -c "
import json,sys
print([p['metadata']['name'] for p in json.load(sys.stdin)['items'] if p['spec'].get('hostNetwork')])
"
```
Expected: `[]` (no host-network pods). If anything appears, check its ports before continuing.

- [ ] **Step 2: Create the token secret**

Generate a token and store it where both workloads read it. The token never enters git:

```bash
TOKEN=$(openssl rand -hex 32)
kubectl create secret generic www-scanner -n www-klaushofrichter --from-literal=SCANNER_TOKEN="$TOKEN"
kubectl get secret www-scanner -n www-klaushofrichter -o jsonpath='{.data.SCANNER_TOKEN}' | wc -c
```

- [ ] **Step 3: Write the Deployment**

Create `manifests/www-klaushofrichter/www-scanner-deployment.yaml`:

```yaml
# The privileged half of the IP Survey. On the host network because ARP, mDNS
# and SSDP are layer-2 and do not cross the pod network's NAT; NET_RAW because
# arp-scan needs raw sockets. Deliberately NOT a Knative Service: it has no
# public hostname and must never get one.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: www-scanner
  namespace: www-klaushofrichter
spec:
  replicas: 1
  # Recreate, not RollingUpdate: on the host network the new pod would try to
  # bind 9450 while the old one still holds it, and crash-loop until it exits.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: www-scanner
  template:
    metadata:
      labels:
        app: www-scanner
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
      - name: scanner
        image: ghcr.io/klaushofrichter/www-klaushofrichter-scanner:latest
        env:
        - name: SCAN_CIDR
          value: 192.168.1.0/24
        - name: SCAN_INTERFACE
          value: eno1
        # The cluster bridge only. A wildcard bind here would put the scanner
        # on the LAN, where any device could reach it.
        - name: BIND_ADDRESS
          value: 10.42.0.1
        - name: SCANNER_PORT
          value: "9450"
        envFrom:
        - secretRef:
            name: www-scanner
        securityContext:
          runAsUser: 0
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: [ALL]
            add: [NET_RAW]
        readinessProbe:
          httpGet:
            path: /health
            port: 9450
            host: 10.42.0.1
          initialDelaySeconds: 2
        resources:
          limits:
            cpu: 500m
            memory: 192Mi
          requests:
            cpu: 50m
            memory: 64Mi
```

- [ ] **Step 4: Point the website at it**

In `manifests/www-klaushofrichter/www-ksvc.yaml`, add to the container's `env` (creating the list if absent) and extend `envFrom`:

```yaml
        env:
        - name: SCANNER_URL
          value: http://10.42.0.1:9450
        envFrom:
        - secretRef:
            name: www-oauth
        - secretRef:
            name: www-scanner
```

- [ ] **Step 5: Widen the runner's Role by exactly one resource**

In `manifests/www-klaushofrichter-runner/rbac.yaml`, add a second rule:

```yaml
- apiGroups:
  - apps
  resources:
  - deployments
  # By name: the runner may roll a new image onto this one Deployment and
  # nothing else. It cannot create a host-network pod spec of its own, which is
  # the privilege worth withholding from anything that runs workflow code.
  resourceNames:
  - www-scanner
  verbs:
  - get
  - watch
  - patch
```

- [ ] **Step 6: Apply, verify, commit**

```bash
export KUBECONFIG=~/.kube/k3s-config
cd ../kube-setup
kubectl apply -f manifests/www-klaushofrichter/www-scanner-deployment.yaml
kubectl apply -f manifests/www-klaushofrichter-runner/rbac.yaml
kubectl rollout status deployment/www-scanner -n www-klaushofrichter --timeout=120s
kubectl get pod -n www-klaushofrichter -l app=www-scanner -o wide
```

Expected: the pod is Running with the node's IP as its pod IP (that is what host networking means). Then confirm it answers and refuses:

```bash
POD=$(kubectl get pod -n www-klaushofrichter -l serving.knative.dev/service=www-klaushofrichter -o name | tail -1)
kubectl exec -n www-klaushofrichter "$POD" -c user-container -- sh -c \
  'wget -qO- http://10.42.0.1:9450/health; echo; wget -qS -O- http://10.42.0.1:9450/scan 2>&1 | head -2'
```

Expected: the health JSON with the deployed version, then `401` for `/scan` without a token.

Commit both manifests to `kube-setup` (the secret is not in git), then deploy the website so it picks up `SCANNER_URL`.

- [ ] **Step 7: Confirm the scanner is not reachable from the LAN**

From another machine on the network:

```bash
curl -m 3 http://192.168.1.103:9450/health ; echo "exit=$?"
```

Expected: a timeout or connection refused, **not** JSON. If it answers, the bind address is wrong — stop and fix it before going further.

---

### Task 9: First real scan, and the docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-17-ip-survey-design.md` (status line)

- [ ] **Step 1: Run a real scan**

Sign in at https://www.klaushofrichter.net/dashboard/ip-survey and press **Scan**. Expect the stage line to move through finding devices → finding names → checking ports → checking web pages in roughly 30-60 seconds, then a table.

- [ ] **Step 2: Check the result against devices you know**

Confirm the router, the Optiplex itself, and at least two devices you can identify appear with plausible manufacturers; that a phone shows as *Private address*; and that a device with a web interface is a working link. Note anything missing or wrong — a device that never appears is worth chasing, since ARP should reach everything on the segment.

- [ ] **Step 3: Save, rescan, compare**

Press **Save**. Reload: the saved survey should still be there (it is on the PVC now). Unplug or power off one device, scan again, and confirm it shows as *gone* while everything else stays unchanged.

- [ ] **Step 4: Confirm persistence survives a restart**

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl delete pod -n www-klaushofrichter -l serving.knative.dev/service=www-klaushofrichter
```

Reload the page: the saved survey must still be there. That is the PVC doing its job.

- [ ] **Step 5: Document it**

In `README.md`, replace the "the scanner does not exist yet" wording in the IP Survey section with what actually runs: the `www-scanner` Deployment, host networking and `NET_RAW`, the four stages and roughly how long they take, `SCAN_CIDR`/`SCAN_INTERFACE`, and the fact that it listens only on the cluster bridge and needs a token. Add a CHANGELOG entry under `## [Unreleased]`. Mark the design spec's status line as implemented.

- [ ] **Step 6: Commit and ship**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-09-17-ip-survey-design.md
git commit -m "Document the scanner now that it runs"
```

Then the usual promotion: PR `main` → `production`, wait for `test`, `e2e`, `codeql` and `build-push`, merge, watch the deploy.

---

## Notes for whoever executes this

- **Tasks 1-7 and 9's documentation are ordinary repo work.** Task 8 and the verification steps in Task 9 need cluster access and the user's judgement; keep them with the controller.
- **Nothing in CI ever scans a real network.** The e2e suite still runs against `e2e/fakeScanner.ts`; the scanner's own tests inject every network call.
- **Tell the `kube-setup` session** when Task 8 lands: the deploy workflow, the runner's RBAC and the namespace's workloads all change, and its fleet documents track exactly those.
