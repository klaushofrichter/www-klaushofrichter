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

// The stages themselves are not cancellable (arp-scan, multicast sockets and
// TCP probes all just run to completion), so this is a hard wall-clock cap
// on how long the runner will wait and report `running` before it gives up
// and reports `failed` instead, freeing the next scan to start. Sized well
// above a normal scan but far below the pathological case fix 2 targets:
// before that fix, one slow device's web ports alone could cost up to
// 7 ports x 6s each = 42s, and at 8 devices in flight and up to 254
// addresses that is ceil(254 / 8) = ~32 waves x 42s =~ 22 minutes with
// nothing to end it. Ten minutes is a simple, generous cap for a home LAN.
export const SCAN_DEADLINE_MS = 10 * 60 * 1000;

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
  deadlineMs = SCAN_DEADLINE_MS,
): ScanRunner & { whenIdle(): Promise<void> } {
  let state: ScanState = { state: 'idle' };
  let running: Promise<void> | null = null;
  // Bumped whenever a scan is abandoned (deadline hit) or superseded (a new
  // scan started). A stage from an earlier generation that eventually
  // settles checks this before touching `state`, so a scan the runner has
  // already given up on can never clobber whatever came after it.
  let generation = 0;

  function setStage(stage: ScanStage, startedAt: string): void {
    state = {
      state: 'running',
      stage,
      stageIndex: STAGE_ORDER.indexOf(stage) + 1,
      stageCount: STAGE_ORDER.length,
      startedAt,
    };
  }

  async function run(myGeneration: number): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      setStage('discovery', startedAt);
      const discovered = await stages.discover();
      if (myGeneration !== generation) {
        return;
      }

      setStage('names', startedAt);
      const named = await stages.names(discovered);
      if (myGeneration !== generation) {
        return;
      }

      setStage('ports', startedAt);
      const probed = await stages.probe(named);
      if (myGeneration !== generation) {
        return;
      }

      setStage('web', startedAt);
      state = {
        state: 'finished',
        result: { scannedAt: new Date().toISOString(), cidr: config.cidr, devices: probed },
      };
    } catch (err) {
      if (myGeneration !== generation) {
        return;
      }
      // A failed scan is a reportable state, not a crash: the website shows the
      // message and the next scan can still be started.
      state = { state: 'failed', error: (err as Error).message, finishedAt: new Date().toISOString() };
    }
  }

  return {
    getState: () => state,
    start: () => {
      if (running) {
        return false;
      }
      generation += 1;
      const myGeneration = generation;
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          if (myGeneration === generation) {
            state = {
              state: 'failed',
              error: `scan exceeded the ${Math.round(deadlineMs / 1000)}s deadline`,
              finishedAt: new Date().toISOString(),
            };
            // The in-flight run() is not cancellable and may still settle
            // later; bumping the generation here (not just on the next
            // start()) stops it from overwriting this failure if nothing
            // else has started a new scan by the time it does.
            generation += 1;
          }
          resolve();
        }, deadlineMs);
      });
      const runPromise = run(myGeneration).finally(() => clearTimeout(timer));
      running = Promise.race([runPromise, deadline]).finally(() => {
        running = null;
      });
      return true;
    },
    whenIdle: async () => {
      while (running) {
        await running;
      }
    },
  };
}
