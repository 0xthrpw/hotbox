import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('api/auth password hashing', () => {
  it('produces an argon2id-formatted hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the right password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(await verifyPassword(hash, 's3cret-pw')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('rejects a garbage hash without throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
