import { afterEach, describe, expect, it } from 'vitest';
import { booleanEnv, optionalEnv } from './env.js';

const KEY = '__WAVE_TEST_KEY__';

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

describe('booleanEnv', () => {
  it('is false when the variable is unset or empty', () => {
    expect(booleanEnv('WAVE_MCP_READ_ONLY', {})).toBe(false);
    expect(booleanEnv('WAVE_MCP_READ_ONLY', { WAVE_MCP_READ_ONLY: '' })).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', ' True '])('is true for %j', (value) => {
    expect(booleanEnv('WAVE_MCP_READ_ONLY', { WAVE_MCP_READ_ONLY: value })).toBe(true);
  });

  it.each(['0', 'false', 'False'])('is false for %j', (value) => {
    expect(booleanEnv('WAVE_MCP_READ_ONLY', { WAVE_MCP_READ_ONLY: value })).toBe(false);
  });

  it.each(['yes', 'on', '2', 'tru'])('refuses %j rather than guess', (value) => {
    expect(() => booleanEnv('WAVE_MCP_READ_ONLY', { WAVE_MCP_READ_ONLY: value })).toThrow(
      /WAVE_MCP_READ_ONLY must be 1, true, 0 or false/,
    );
  });
});
