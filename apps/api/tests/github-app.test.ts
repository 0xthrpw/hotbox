import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { buildAppJwt, GithubAppClient } from '../src/github-app.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('api/github-app buildAppJwt', () => {
  it('produces a JWT GitHub would accept: RS256, iss=appId, backdated iat, <10min exp', () => {
    const now = 1_800_000_000;
    const jwt = buildAppJwt('12345', PRIVATE_PEM, now);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(now - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60);

    const ok = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature!, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});

describe('api/github-app GithubAppClient.installationToken', () => {
  const config = { appId: '1', privateKeyPem: PRIVATE_PEM, webhookSecret: 'whs' };

  function mintResponse(token: string, ttlMs: number): Response {
    return new Response(
      JSON.stringify({ token, expires_at: new Date(Date.now() + ttlMs).toISOString() }),
      { status: 201 },
    );
  }

  it('mints once and serves from cache until near expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mintResponse('ghs_fresh', 60 * 60_000));
    const client = new GithubAppClient(config, fetchMock as typeof fetch);
    expect(await client.installationToken(42)).toBe('ghs_fresh');
    expect(await client.installationToken(42)).toBe('ghs_fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/app/installations/42/access_tokens');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('re-mints when the cached token is within 5 minutes of expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mintResponse('ghs_short', 4 * 60_000))
      .mockResolvedValueOnce(mintResponse('ghs_next', 60 * 60_000));
    const client = new GithubAppClient(config, fetchMock as typeof fetch);
    expect(await client.installationToken(42)).toBe('ghs_short');
    expect(await client.installationToken(42)).toBe('ghs_next');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches per installation, not globally', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mintResponse('ghs_a', 60 * 60_000))
      .mockResolvedValueOnce(mintResponse('ghs_b', 60 * 60_000));
    const client = new GithubAppClient(config, fetchMock as typeof fetch);
    expect(await client.installationToken(1)).toBe('ghs_a');
    expect(await client.installationToken(2)).toBe('ghs_b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws with status context when GitHub rejects the mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad credentials', { status: 401 }));
    const client = new GithubAppClient(config, fetchMock as typeof fetch);
    await expect(client.installationToken(42)).rejects.toThrow(/401/);
  });
});
