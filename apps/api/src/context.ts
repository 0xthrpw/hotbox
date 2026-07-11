import type Dockerode from 'dockerode';
import type { HotboxDb } from '@hotbox/db';
import type { Reconciler } from '@hotbox/reconciler';
import type { KeyRing } from '@hotbox/crypto';
import type { BuildWorker } from './build-worker.js';
import type { GithubAppClient } from './github-app.js';

export interface AppContext {
  db: HotboxDb;
  docker: Dockerode;
  reconciler: Reconciler;
  buildWorker: BuildWorker;
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
  /**
   * Externally reachable base URL of this API (e.g. "https://api.hotbox.wtf"),
   * derived from HOTBOX_API_HOST. Used to render CI deploy-hook snippets and
   * GitHub webhook URLs in the UI. Null when the operator hasn't set the env
   * var — the UI falls back to a placeholder.
   */
  apiPublicUrl: string | null;
  /**
   * GitHub App client (private-repo clones, repo picker, app webhook).
   * Null when GITHUB_APP_* env vars aren't configured — github sources then
   * fall back to credential-less public clones and /webhooks/github-app 404s.
   */
  githubApp: GithubAppClient | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user?: { id: string; email: string; role: string };
    /** Set by attachApiToken when a valid `hbx_api_…` bearer token is presented. */
    apiToken?: { id: string; serviceId: string | null; userId: string | null; scopes: string[] };
  }
}
