import type Dockerode from 'dockerode';
import type { HotboxDb } from '@hotbox/db';
import type { Reconciler } from '@hotbox/reconciler';
import type { KeyRing } from '@hotbox/crypto';

export interface AppContext {
  db: HotboxDb;
  docker: Dockerode;
  reconciler: Reconciler;
  keyring: KeyRing;
  hostId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user?: { id: string; email: string; role: string };
  }
}
