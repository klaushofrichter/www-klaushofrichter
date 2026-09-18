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

  it('gives up with a failed state instead of reporting running forever when a stage never resolves', async () => {
    // A stage that hangs forever (a stuck arp-scan, a name-resolution stage
    // that never settles) is not itself cancellable, so the runner's only
    // recourse is a hard wall-clock deadline. A short deadline stands in for
    // the real ten-minute one.
    const runner = createRunner(
      config,
      {
        discover: async () => [],
        names: () => new Promise<Device[]>(() => {}), // never settles
        probe: async (d) => d,
      },
      20,
    );

    expect(runner.start()).toBe(true);
    await runner.whenIdle();

    const state = runner.getState();
    expect(state.state).toBe('failed');
    if (state.state === 'failed') {
      expect(state.error).toMatch(/deadline/);
    }
    // The hung stage is still out there, but the runner has moved on and a
    // new scan can start.
    expect(runner.start()).toBe(true);
  });

  it('does not let a stage that eventually resolves after the deadline overwrite the failure', async () => {
    let resolveNames: ((devices: Device[]) => void) | null = null;
    const runner = createRunner(
      config,
      {
        discover: async () => [],
        names: () => new Promise<Device[]>((resolve) => { resolveNames = resolve; }),
        probe: async (d) => d,
      },
      20,
    );

    runner.start();
    await runner.whenIdle();
    expect(runner.getState().state).toBe('failed');

    // The stale stage finally settles well after the deadline gave up on it.
    resolveNames?.([]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runner.getState().state).toBe('failed');
  });
});
