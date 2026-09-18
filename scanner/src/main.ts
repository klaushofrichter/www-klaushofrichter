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
    // A scan in flight keeps its connections open until every request
    // settles, which can outlast Kubernetes' 30s grace period. With
    // `strategy: Recreate` on a host port, the replacement pod cannot bind
    // until this one is fully gone, so a slow close here eats into the
    // deploy's rollout budget. Forcing the exit after a short grace period
    // bounds that instead of trusting every open connection to finish.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
