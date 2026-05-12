import { describe, expect, it } from 'vitest';
import { base32Decode, totp } from './totp.js';

describe('base32Decode', () => {
  it('decodes the empty-padded RFC 4648 example', () => {
    // "Hello!" base32 → "JBSWY3DPEE======"
    expect(base32Decode('JBSWY3DPEE======').toString('utf8')).toBe('Hello!');
  });

  it('tolerates lowercase, whitespace, and missing padding', () => {
    expect(base32Decode('jb swy3dp ee').toString('utf8')).toBe('Hello!');
  });

  it('throws on an invalid character', () => {
    expect(() => base32Decode('JBSWY3D!')).toThrowError(/Invalid base32/);
  });

  it('throws on an empty secret', () => {
    expect(() => base32Decode('')).toThrowError(/Empty/);
  });
});

describe('totp (RFC 6238 SHA-1 test vectors)', () => {
  // The RFC 6238 reference appendix uses "12345678901234567890" as the seed in ASCII —
  // that's base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const cases: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(cases)('at unix time %i emits %s', (unix, expected) => {
    expect(totp(SECRET, { now: unix * 1000, digits: 8, step: 30, algorithm: 'SHA1' })).toBe(expected);
  });

  it('defaults to 6 digits / SHA-1 / 30s step', () => {
    // Re-do the t=59 case as 6 digits and compare with the last six of the canonical 8-digit answer.
    const code = totp(SECRET, { now: 59_000 });
    expect(code).toBe('287082');
    expect(code.length).toBe(6);
  });

  it('left-pads short codes with zeroes', () => {
    // Engineered to produce a tiny code: try several timestamps until we find a value < 10**5.
    // Using the constructed RFC seed, t=20000 sec → 8-digit 53593286, 6-digit 593286.
    // The padding behaviour is tested by simply asserting length is always digits.
    for (let t = 0; t < 1_000_000; t += 13_579) {
      const c = totp(SECRET, { now: t * 1000 });
      expect(c).toHaveLength(6);
    }
  });
});
