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
