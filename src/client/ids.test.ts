import { describe, expect, it } from 'vitest';
import {
  assertUuid,
  fromCompositeGlobalId,
  fromGlobalId,
  isUuid,
  toCompositeGlobalId,
  toGlobalId,
} from './ids.js';

const BUSINESS_UUID = 'c2cb3afe-5a24-41b2-add7-d1c6982d75a9';
const BUSINESS_GLOBAL_ID = 'QnVzaW5lc3M6YzJjYjNhZmUtNWEyNC00MWIyLWFkZDctZDFjNjk4MmQ3NWE5';

describe('toGlobalId / fromGlobalId', () => {
  it('encodes Business:UUID as base64', () => {
    expect(toGlobalId('Business', BUSINESS_UUID)).toBe(BUSINESS_GLOBAL_ID);
  });

  it('decodes the canonical Business global ID we captured from Wave', () => {
    expect(fromGlobalId(BUSINESS_GLOBAL_ID)).toEqual({
      typename: 'Business',
      uuid: BUSINESS_UUID,
    });
  });

  it('round-trips arbitrary types', () => {
    const encoded = toGlobalId('Customer', 'abc-123');
    expect(fromGlobalId(encoded)).toEqual({ typename: 'Customer', uuid: 'abc-123' });
  });

  it('throws on a malformed Relay ID', () => {
    // base64 of "no-colon-here"
    expect(() => fromGlobalId('bm8tY29sb24taGVyZQ==')).toThrowError(/Not a Relay global ID/);
  });
});

describe('toCompositeGlobalId / fromCompositeGlobalId', () => {
  it('produces the exact Customer composite ID Wave emits', () => {
    // Captured from /customers/102532808/view during investigation.
    expect(toCompositeGlobalId(BUSINESS_UUID, 'Customer', 102532808)).toBe(
      'QnVzaW5lc3M6YzJjYjNhZmUtNWEyNC00MWIyLWFkZDctZDFjNjk4MmQ3NWE5O0N1c3RvbWVyOjEwMjUzMjgwOA==',
    );
  });

  it('accepts numeric or string internal IDs', () => {
    const numeric = toCompositeGlobalId(BUSINESS_UUID, 'Product', 123);
    const stringy = toCompositeGlobalId(BUSINESS_UUID, 'Product', '123');
    expect(numeric).toBe(stringy);
  });

  it('round-trips composite IDs', () => {
    const encoded = toCompositeGlobalId(BUSINESS_UUID, 'Invoice', 999);
    expect(fromCompositeGlobalId(encoded)).toEqual({
      businessUuid: BUSINESS_UUID,
      typename: 'Invoice',
      internalId: '999',
    });
  });

  it('throws when there is no semicolon (not a Wave composite)', () => {
    expect(() => fromCompositeGlobalId(BUSINESS_GLOBAL_ID)).toThrowError(
      /Not a Wave composite Relay ID/,
    );
  });

  it('throws when child part is malformed', () => {
    // base64 of "Business:uuid;malformed"
    const malformed = Buffer.from('Business:uuid;malformed', 'utf8').toString('base64');
    expect(() => fromCompositeGlobalId(malformed)).toThrowError(/Malformed/);
  });
});

describe('isUuid / assertUuid', () => {
  it('accepts canonical lower-case UUIDs', () => {
    expect(isUuid(BUSINESS_UUID)).toBe(true);
  });

  it('accepts upper-case hex', () => {
    expect(isUuid('C2CB3AFE-5A24-41B2-ADD7-D1C6982D75A9')).toBe(true);
  });

  it.each([
    ['too short', 'c2cb3afe'],
    ['no hyphens', 'c2cb3afe5a2441b2add7d1c6982d75a9'],
    ['non-hex', 'c2cb3afe-5a24-41b2-add7-d1c6982d75az'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it('assertUuid passes through on valid input', () => {
    expect(() => assertUuid(BUSINESS_UUID)).not.toThrow();
  });

  it('assertUuid throws with the field name on invalid input', () => {
    expect(() => assertUuid('nope', 'businessId')).toThrowError(/businessId/);
  });
});
