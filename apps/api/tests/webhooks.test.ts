import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { evaluatePushEvent, verifyGithubSignature } from '../src/routes/webhooks.js';

const SECRET = 'wh_secret_for_tests';

function sign(body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('api/webhooks verifyGithubSignature', () => {
  const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));

  it('accepts a correctly signed body', () => {
    expect(verifyGithubSignature(SECRET, body, sign(body))).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyGithubSignature(SECRET, body, sign(body, 'other'))).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const tampered = Buffer.from(JSON.stringify({ ref: 'refs/heads/evil' }));
    expect(verifyGithubSignature(SECRET, tampered, sign(body))).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyGithubSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, '')).toBe(false);
    expect(verifyGithubSignature(SECRET, body, 'sha1=abc')).toBe(false);
    expect(verifyGithubSignature(SECRET, body, 'sha256=')).toBe(false);
    expect(verifyGithubSignature(SECRET, body, 'sha256=zz-not-hex')).toBe(false);
  });
});

describe('api/webhooks evaluatePushEvent', () => {
  const source = { branch: 'main', last_built_sha: 'aaa111' };

  it('builds on a push to the configured branch', () => {
    const d = evaluatePushEvent(source, 'push', {
      ref: 'refs/heads/main',
      head_commit: { id: 'bbb222' },
    });
    expect(d).toEqual({ action: 'build' });
  });

  it('ignores non-push events', () => {
    expect(evaluatePushEvent(source, 'issues', { ref: 'refs/heads/main' }).reason)
      .toBe('unsupported-event');
  });

  it('ignores pushes to other branches and to tags', () => {
    expect(evaluatePushEvent(source, 'push', { ref: 'refs/heads/dev' }).reason)
      .toBe('ref-mismatch');
    expect(evaluatePushEvent(source, 'push', { ref: 'refs/tags/v1.0' }).reason)
      .toBe('ref-mismatch');
  });

  it('ignores branch deletions', () => {
    const d = evaluatePushEvent(source, 'push', { ref: 'refs/heads/main', deleted: true });
    expect(d.reason).toBe('branch-deleted');
  });

  it('ignores a redelivery whose head is already built', () => {
    const d = evaluatePushEvent(source, 'push', {
      ref: 'refs/heads/main',
      head_commit: { id: 'aaa111' },
    });
    expect(d.reason).toBe('already-built');
  });

  it('builds when head_commit is absent (force push edge)', () => {
    const d = evaluatePushEvent(source, 'push', { ref: 'refs/heads/main', head_commit: null });
    expect(d).toEqual({ action: 'build' });
  });

  it('a branch named like a prefix of another does not match', () => {
    const d = evaluatePushEvent({ branch: 'main', last_built_sha: null }, 'push', {
      ref: 'refs/heads/main-v2',
    });
    expect(d.reason).toBe('ref-mismatch');
  });
});
