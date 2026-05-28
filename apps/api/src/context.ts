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
  /**
   * Base domain for auto-generated service subdomains
   * (e.g. "on.hotbox.wtf"). When null, auto_subdomain=true on a service is
   * silently ignored — the operator hasn't configured the wildcard DNS +
   * Cloudflare API token yet, so we don't emit Traefik labels that would
   * never resolve.
   */
  autoSubdomainBase: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user?: { id: string; email: string; role: string };
  }
}
