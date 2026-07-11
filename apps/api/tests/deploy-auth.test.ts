import { describe, it, expect } from 'vitest';
import { requireDeployAuth, DEPLOY_SCOPE } from '../src/routes/auth.js';

const SVC = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function statusOf(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as { statusCode?: number }).statusCode ?? -1;
  }
}

describe('api/auth requireDeployAuth', () => {
  it('passes a session user regardless of token state', () => {
    expect(statusOf(() => requireDeployAuth({ user: { id: 'u1' } }, SVC))).toBeNull();
  });

  it('passes a deploy-scoped token matching the target service', () => {
    const req = { apiToken: { id: 't1', serviceId: SVC, scopes: [DEPLOY_SCOPE] } };
    expect(statusOf(() => requireDeployAuth(req, SVC))).toBeNull();
  });

  it('401s when no credential was presented', () => {
    expect(statusOf(() => requireDeployAuth({}, SVC))).toBe(401);
  });

  it('403s a token scoped to a different service', () => {
    const req = { apiToken: { id: 't1', serviceId: OTHER, scopes: [DEPLOY_SCOPE] } };
    expect(statusOf(() => requireDeployAuth(req, SVC))).toBe(403);
  });

  it('403s an unscoped (global) token — deploy tokens must be service-scoped', () => {
    const req = { apiToken: { id: 't1', serviceId: null, scopes: [DEPLOY_SCOPE] } };
    expect(statusOf(() => requireDeployAuth(req, SVC))).toBe(403);
  });

  it('403s a token without the deploy scope', () => {
    const req = { apiToken: { id: 't1', serviceId: SVC, scopes: ['other'] } };
    expect(statusOf(() => requireDeployAuth(req, SVC))).toBe(403);
  });

  it('prefers the session user over a mismatched token', () => {
    const req = {
      user: { id: 'u1' },
      apiToken: { id: 't1', serviceId: OTHER, scopes: [] as string[] },
    };
    expect(statusOf(() => requireDeployAuth(req, SVC))).toBeNull();
  });
});
