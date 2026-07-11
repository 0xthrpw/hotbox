import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Minimal GitHub App client: App JWT → per-installation access tokens →
 * the two REST calls hotbox needs (token mint, repo listing). Hand-rolled
 * RS256 via node:crypto instead of @octokit/auth-app — the JWT is ~10 lines
 * and this keeps the API dependency-free.
 */

const GITHUB_API = 'https://api.github.com';

export interface GithubAppConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
}

export interface InstallationRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

/**
 * App-level JWT (RS256, GitHub caps validity at 10 minutes). iat is backdated
 * 60s per GitHub's docs to absorb clock drift between us and their edge.
 */
export function buildAppJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  })}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

export class GithubAppClient {
  /** installation_id → token, kept until ~5 min before its 1h expiry. */
  private tokenCache = new Map<number, { token: string; expiresAtMs: number }>();

  constructor(
    private readonly config: GithubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get webhookSecret(): string {
    return this.config.webhookSecret;
  }

  /** Short-lived installation access token; cached across builds/API calls. */
  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAtMs - 5 * 60_000 > Date.now()) return cached.token;

    const jwt = buildAppJwt(this.config.appId, this.config.privateKeyPem, Math.floor(Date.now() / 1000));
    const res = await this.fetchImpl(
      `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
      { method: 'POST', headers: this.headers(jwt) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub installation token mint failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const body = (await res.json()) as { token: string; expires_at: string };
    this.tokenCache.set(installationId, {
      token: body.token,
      expiresAtMs: new Date(body.expires_at).getTime(),
    });
    return body.token;
  }

  /** Repos visible to an installation (drives the create-form repo picker). */
  async installationRepos(installationId: number): Promise<InstallationRepo[]> {
    const token = await this.installationToken(installationId);
    const repos: InstallationRepo[] = [];
    // 10 pages × 100 = 1000 repos — beyond that the picker is the wrong UI anyway.
    for (let page = 1; page <= 10; page++) {
      const res = await this.fetchImpl(
        `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
        { headers: this.headers(token) },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GitHub repo listing failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const body = (await res.json()) as {
        total_count: number;
        repositories: Array<{ full_name: string; private: boolean; default_branch: string }>;
      };
      for (const r of body.repositories) {
        repos.push({ full_name: r.full_name, private: r.private, default_branch: r.default_branch });
      }
      if (body.repositories.length === 0 || repos.length >= body.total_count) break;
    }
    return repos;
  }

  private headers(auth: string): Record<string, string> {
    return {
      authorization: `Bearer ${auth}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'hotbox',
    };
  }
}

/**
 * All three GITHUB_APP_* vars set → client; none set → null (App features
 * hidden). A partial set is a config mistake — fail startup loudly rather
 * than silently disabling private-repo builds.
 */
export async function loadGithubApp(env: NodeJS.ProcessEnv): Promise<GithubAppClient | null> {
  const appId = env.GITHUB_APP_ID?.trim();
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET?.trim();
  const set = [appId, keyPath, webhookSecret].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 3) {
    throw new Error(
      'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH and GITHUB_APP_WEBHOOK_SECRET must be set together',
    );
  }
  const privateKeyPem = await readFile(keyPath!, 'utf8');
  return new GithubAppClient({ appId: appId!, privateKeyPem, webhookSecret: webhookSecret! });
}
