import { createCipheriv, createDecipheriv } from 'node:crypto';

// The well-known default Meshtastic channel key ("AQ==" / LongFast).
export const DEFAULT_KEY = Buffer.from('1PG7OiApB1nwvP+rz05pAQ==', 'base64');

/**
 * Expands a channel PSK as the firmware does:
 * - 1 byte: index into the default key (1 = default, 2..10 = default with last byte bumped)
 * - 16 / 32 bytes: AES-128 / AES-256 key
 */
export function expandKey(psk: Buffer): Buffer | null {
  if (psk.length === 0) return null; // no encryption
  if (psk.length === 1) {
    const idx = psk[0];
    if (idx === 0) return null;
    const k = Buffer.from(DEFAULT_KEY);
    k[k.length - 1] = (k[k.length - 1] + idx - 1) & 0xff;
    return k;
  }
  if (psk.length === 16 || psk.length === 32) return psk;
  if (psk.length < 16) return Buffer.concat([psk, Buffer.alloc(16 - psk.length)]);
  if (psk.length < 32) return Buffer.concat([psk, Buffer.alloc(32 - psk.length)]);
  return psk.subarray(0, 32);
}

function nonce(packetId: number, fromNode: number): Buffer {
  const n = Buffer.alloc(16);
  n.writeUInt32LE(packetId >>> 0, 0); // packet id as u64 LE (upper 32 bits zero)
  n.writeUInt32LE(fromNode >>> 0, 8);
  return n;
}

const algo = (key: Buffer) => (key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr');

export function decrypt(data: Uint8Array, key: Buffer, packetId: number, fromNode: number): Buffer {
  const d = createDecipheriv(algo(key), key, nonce(packetId, fromNode));
  return Buffer.concat([d.update(data), d.final()]);
}

export function encrypt(data: Uint8Array, key: Buffer, packetId: number, fromNode: number): Buffer {
  const c = createCipheriv(algo(key), key, nonce(packetId, fromNode));
  return Buffer.concat([c.update(data), c.final()]);
}
