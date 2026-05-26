import { describe, it, expect } from 'vitest';
import { KEY_BYTES, KeyRing, NONCE_BYTES, open, seal } from '../src/index.js';
import { randomBytes } from 'node:crypto';

function makeRing(version = 1): KeyRing {
  const ring = new KeyRing();
  ring.add(version, randomBytes(KEY_BYTES));
  return ring;
}

describe('crypto/seal', () => {
  it('round-trips plaintext', () => {
    const ring = makeRing();
    const s = seal(ring, 'hello world');
    expect(s.ciphertext.length).toBeGreaterThan(0);
    expect(s.nonce.length).toBe(NONCE_BYTES);
    expect(s.keyVersion).toBe(1);
    expect(open(ring, s)).toBe('hello world');
  });

  it('rejects ciphertext sealed by a different keyring', () => {
    const a = makeRing();
    const b = makeRing();
    const s = seal(a, 'secret');
    expect(() => open(b, s)).toThrow();
  });

  it('rejects tampered ciphertext (auth failure)', () => {
    const ring = makeRing();
    const s = seal(ring, 'do not change me');
    s.ciphertext[0] = s.ciphertext[0] === 0 ? 1 : 0; // flip a byte
    expect(() => open(ring, s)).toThrow();
  });

  it('rejects an unknown key version', () => {
    const ring = makeRing(1);
    expect(() => open(ring, { ciphertext: Buffer.alloc(16), nonce: Buffer.alloc(NONCE_BYTES), keyVersion: 99 })).toThrow();
  });

  it('uses the highest version for new seals when multiple keys are loaded', () => {
    const ring = new KeyRing();
    ring.add(1, randomBytes(KEY_BYTES));
    ring.add(2, randomBytes(KEY_BYTES));
    const s = seal(ring, 'rotated');
    expect(s.keyVersion).toBe(2);
    expect(open(ring, s)).toBe('rotated');
  });

  it('can still open older-version ciphertexts after rotation', () => {
    const ring = new KeyRing();
    ring.add(1, randomBytes(KEY_BYTES));
    const old = seal(ring, 'legacy');
    expect(old.keyVersion).toBe(1);

    ring.add(2, randomBytes(KEY_BYTES));
    const fresh = seal(ring, 'modern');
    expect(fresh.keyVersion).toBe(2);

    expect(open(ring, old)).toBe('legacy');
    expect(open(ring, fresh)).toBe('modern');
  });

  it('rejects a master key of the wrong length', () => {
    const ring = new KeyRing();
    expect(() => ring.add(1, new Uint8Array(31))).toThrow(/32 bytes/);
  });
});
