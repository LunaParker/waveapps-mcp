import { afterEach, describe, expect, it } from 'vitest';
import { optionalEnv, requireEnv } from './env.js';

const KEY = '__WAVE_TEST_KEY__';

describe('requireEnv', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('returns the value when set', () => {
    process.env[KEY] = 'hello';
    expect(requireEnv(KEY)).toBe('hello');
  });

  it('throws when missing', () => {
    expect(() => requireEnv(KEY)).toThrowError(`Missing required env var: ${KEY}`);
  });

  it('throws when empty', () => {
    process.env[KEY] = '';
    expect(() => requireEnv(KEY)).toThrowError(`Missing required env var: ${KEY}`);
  });
});

describe('optionalEnv', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('returns the value when set', () => {
    process.env[KEY] = 'world';
    expect(optionalEnv(KEY)).toBe('world');
  });

  it('returns undefined when unset and no fallback is given', () => {
    expect(optionalEnv(KEY)).toBeUndefined();
  });

  it('returns the fallback when unset', () => {
    expect(optionalEnv(KEY, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when empty string', () => {
    process.env[KEY] = '';
    expect(optionalEnv(KEY, 'fallback')).toBe('fallback');
  });
});
