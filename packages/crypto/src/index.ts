import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;

export interface SealedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: number;
}

/**
 * KeyRing supports multiple key versions to allow lazy rotation.
 * The highest-numbered key is "current" — used for new seal() calls.
 * Older versions remain present so existing secrets can still be opened.
 */
export class KeyRing {
  private readonly keys = new Map<number, Uint8Array>();
  private currentVersion = 0;

  add(version: number, key: Uint8Array): void {
    if (key.length !== KEY_BYTES) {
      throw new Error(`master key v${version} must be ${KEY_BYTES} bytes, got ${key.length}`);
    }
    this.keys.set(version, key);
    if (version > this.currentVersion) this.currentVersion = version;
  }

  current(): { version: number; key: Uint8Array } {
    if (this.currentVersion === 0) throw new Error('no keys loaded');
    return { version: this.currentVersion, key: this.keys.get(this.currentVersion)! };
  }

  get(version: number): Uint8Array {
    const key = this.keys.get(version);
    if (!key) throw new Error(`unknown key version ${version}`);
    return key;
  }
}

/**
 * Load a master key from a hex- or raw-encoded file.
 * Hex files are detected by length (64 chars for 32 bytes) and decoded.
 */
export async function loadMasterKey(path: string, version = 1): Promise<KeyRing> {
  const buf = await readFile(path);
  const trimmed = buf.toString('utf8').trim();
  let key: Uint8Array;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    key = Buffer.from(trimmed, 'hex');
  } else if (buf.length === KEY_BYTES) {
    key = buf;
  } else {
    throw new Error(`master key must be ${KEY_BYTES} raw bytes or ${KEY_BYTES * 2} hex chars`);
  }
  const ring = new KeyRing();
  ring.add(version, key);
  return ring;
}

export function seal(ring: KeyRing, plaintext: string): SealedSecret {
  const { version, key } = ring.current();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  return { ciphertext: Buffer.from(ct), nonce, keyVersion: version };
}

export function open(ring: KeyRing, sealed: SealedSecret): string {
  const key = ring.get(sealed.keyVersion);
  if (sealed.nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes, got ${sealed.nonce.length}`);
  }
  const cipher = xchacha20poly1305(key, sealed.nonce);
  const pt = cipher.decrypt(sealed.ciphertext);
  return new TextDecoder().decode(pt);
}
