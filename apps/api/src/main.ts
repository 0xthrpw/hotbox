import process from 'node:process';
import { createDb } from '@hotbox/db';
import { createDockerClient } from '@hotbox/docker';
import { Reconciler } from '@hotbox/reconciler';
import { loadMasterKey } from '@hotbox/crypto';
import { buildServer } from './server.js';
import { Aggregator } from './aggregator.js';

async function main(): Promise<void> {
  const dbUrl = required('DATABASE_URL');
  const masterKeyPath = process.env.HOTBOX_MASTER_KEY_PATH ?? '/etc/hotbox/master.key';
  const hostId = required('HOST_ID');
  const port = Number(process.env.PORT ?? 3000);

  const db = createDb({ connectionString: dbUrl });
  const docker = createDockerClient({ socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock' });
  const keyring = await loadMasterKey(masterKeyPath);

  const reconciler = new Reconciler({
    db,
    docker,
    hostId,
    logger: { info: console.log, error: console.error },
  });
  reconciler.start();

  const aggregator = new Aggregator(db, { info: console.log, error: console.error });
  aggregator.start();

  const app = await buildServer({ db, docker, reconciler, keyring, hostId });

  await app.listen({ host: '0.0.0.0', port });
  app.log.info(`hotbox-api listening on :${port}`);

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, async () => {
      app.log.info(`got ${sig}, shutting down`);
      reconciler.stop();
      aggregator.stop();
      await app.close();
      await db.destroy();
      process.exit(0);
    });
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
