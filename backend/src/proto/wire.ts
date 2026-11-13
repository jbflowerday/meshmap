// Minimal protobuf wire-format reader/writer.
// Meshtastic only needs a handful of message types, so a tiny hand-rolled codec
// avoids pulling in a code generator and keeps the container small.

export const WT_VARINT = 0;
export const WT_I64 = 1;
export const WT_LEN = 2;
export const WT_I32 = 5;

export interface Field {
  num: number;
  wt: number;
  /** varint value (as bigint so 64-bit / negative int32 values are exact) */
  varint?: bigint;
  /** raw bytes for LEN, I32 and I64 fields */
  bytes?: Uint8Array;
}

export class ProtoError extends Error {}

export function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  const readVarint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new ProtoError('truncated varint');
      const b = buf[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new ProtoError('varint too long');
  };
  while (pos < buf.length) {
    const key = Number(readVarint());
    const num = key >>> 3;
    const wt = key & 7;
    if (num === 0) throw new ProtoError('field number 0');
    switch (wt) {
      case WT_VARINT:
        fields.push({ num, wt, varint: readVarint() });
        break;
      case WT_I64:
        if (pos + 8 > buf.length) throw new ProtoError('truncated i64');
        fields.push({ num, wt, bytes: buf.subarray(pos, pos + 8) });
        pos += 8;
        break;
      case WT_LEN: {
        const len = Number(readVarint());
        if (pos + len > buf.length) throw new ProtoError('truncated len');
        fields.push({ num, wt, bytes: buf.subarray(pos, pos + len) });
        pos += len;
        break;
      }
      case WT_I32:
        if (pos + 4 > buf.length) throw new ProtoError('truncated i32');
        fields.push({ num, wt, bytes: buf.subarray(pos, pos + 4) });
        pos += 4;
        break;
      default:
        throw new ProtoError(`unsupported wire type ${wt}`);
    }
  }
  return fields;
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const textDecoder = new TextDecoder('utf-8', { fatal: false });

export const asUint32 = (f: Field): number => {
  if (f.wt === WT_I32 && f.bytes) return dv(f.bytes).getUint32(0, true);
  return Number(BigInt.asUintN(32, f.varint ?? 0n));
};
export const asInt32 = (f: Field): number => {
  if (f.wt === WT_I32 && f.bytes) return dv(f.bytes).getInt32(0, true);
  return Number(BigInt.asIntN(32, f.varint ?? 0n));
};
export const asSint32 = (f: Field): number => {
  const n = Number(BigInt.asUintN(32, f.varint ?? 0n));
  return (n >>> 1) ^ -(n & 1);
};
export const asBool = (f: Field): boolean => (f.varint ?? 0n) !== 0n;
export const asFloat = (f: Field): number => (f.bytes ? dv(f.bytes).getFloat32(0, true) : 0);
export const asString = (f: Field): string => (f.bytes ? textDecoder.decode(f.bytes) : '');
export const asBytes = (f: Field): Uint8Array => f.bytes ?? new Uint8Array();

/** Reads a repeated scalar field that may be packed (LEN) or unpacked. */
export function repeated(
  fields: Field[],
  num: number,
  kind: 'fixed32' | 'int32' | 'uint32',
): number[] {
  const out: number[] = [];
  for (const f of fields) {
    if (f.num !== num) continue;
    if (f.wt === WT_LEN && f.bytes) {
      if (kind === 'fixed32') {
        const d = dv(f.bytes);
        for (let i = 0; i + 4 <= f.bytes.length; i += 4) out.push(d.getUint32(i, true));
      } else {
        for (const v of readPackedVarints(f.bytes)) {
          out.push(kind === 'int32' ? Number(BigInt.asIntN(32, v)) : Number(BigInt.asUintN(32, v)));
        }
      }
    } else {
      out.push(kind === 'int32' ? asInt32(f) : asUint32(f));
    }
  }
  return out;
}

function readPackedVarints(buf: Uint8Array): bigint[] {
  const out: bigint[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const b = buf[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0 || pos >= buf.length) break;
      shift += 7n;
    }
    out.push(result);
  }
  return out;
}

// ---------------------------------------------------------------- writer

export class Writer {
  private chunks: number[] = [];

  private varint(v: bigint) {
    let x = BigInt.asUintN(64, v);
    while (x > 0x7fn) {
      this.chunks.push(Number(x & 0x7fn) | 0x80);
      x >>= 7n;
    }
    this.chunks.push(Number(x));
  }
  private key(num: number, wt: number) {
    this.varint(BigInt((num << 3) | wt));
  }
  uint32(num: number, v: number | undefined) {
    if (v === undefined || v === 0) return this;
    this.key(num, WT_VARINT);
    this.varint(BigInt(v >>> 0));
    return this;
  }
  int32(num: number, v: number | undefined) {
    if (v === undefined || v === 0) return this;
    this.key(num, WT_VARINT);
    this.varint(BigInt(v | 0));
    return this;
  }
  bool(num: number, v: boolean | undefined) {
    if (!v) return this;
    this.key(num, WT_VARINT);
    this.varint(1n);
    return this;
  }
  fixed32(num: number, v: number | undefined) {
    if (v === undefined || v === 0) return this;
    this.key(num, WT_I32);
    const b = new Uint8Array(4);
    dv(b).setUint32(0, v >>> 0, true);
    this.chunks.push(...b);
    return this;
  }
  sfixed32(num: number, v: number | undefined) {
    if (v === undefined || v === 0) return this;
    this.key(num, WT_I32);
    const b = new Uint8Array(4);
    dv(b).setInt32(0, v | 0, true);
    this.chunks.push(...b);
    return this;
  }
  float(num: number, v: number | undefined) {
    if (v === undefined || v === 0) return this;
    this.key(num, WT_I32);
    const b = new Uint8Array(4);
    dv(b).setFloat32(0, v, true);
    this.chunks.push(...b);
    return this;
  }
  bytes(num: number, v: Uint8Array | undefined) {
    if (!v || v.length === 0) return this;
    this.key(num, WT_LEN);
    this.varint(BigInt(v.length));
    this.chunks.push(...v);
    return this;
  }
  string(num: number, v: string | undefined) {
    if (!v) return this;
    return this.bytes(num, new TextEncoder().encode(v));
  }
  packedFixed32(num: number, v: number[] | undefined) {
    if (!v || v.length === 0) return this;
    const b = new Uint8Array(v.length * 4);
    v.forEach((x, i) => dv(b).setUint32(i * 4, x >>> 0, true));
    return this.bytes(num, b);
  }
  packedInt32(num: number, v: number[] | undefined) {
    if (!v || v.length === 0) return this;
    const w = new Writer();
    for (const x of v) w.varint(BigInt(x | 0));
    return this.bytes(num, w.finish());
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
