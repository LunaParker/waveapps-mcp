import { createHmac } from 'node:crypto';

/**
 * Generate a TOTP code (RFC 6238) from a base32-encoded secret. The defaults match
 * what virtually every authenticator-app QR code encodes: SHA-1, 30s step, 6 digits.
 */
export function totp(secret: string, opts: { now?: number; step?: number; digits?: number; algorithm?: 'SHA1' | 'SHA256' | 'SHA512' } = {}): string {
  const now = opts.now ?? Date.now();
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const algorithm = opts.algorithm ?? 'SHA1';

  const counter = Math.floor(now / 1000 / step);
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm.toLowerCase(), key).update(counterBuf).digest();

  // RFC 4226 §5.3 dynamic truncation.
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);

  const code = binary % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 decoder. Tolerates whitespace, lowercase, and missing padding. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s=]/g, '').toUpperCase();
  if (cleaned.length === 0) throw new Error('Empty TOTP secret.');

  const bits: number[] = [];
  for (const ch of cleaned) {
    const value = BASE32_ALPHABET.indexOf(ch);
    if (value === -1) throw new Error(`Invalid base32 character in TOTP secret: "${ch}"`);
    for (let i = 4; i >= 0; i -= 1) bits.push((value >> i) & 1);
  }

  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let byte = 0; byte < out.length; byte += 1) {
    let v = 0;
    for (let i = 0; i < 8; i += 1) v = (v << 1) | (bits[byte * 8 + i] as number);
    out[byte] = v;
  }
  return out;
}
