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
