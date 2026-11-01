import { describe, expect, it } from 'vitest';
import { sanitise } from './sanitise.js';

describe('sanitise', () => {
  it('trims whitespace', () => {
    expect(sanitise('  abc  ')).toBe('abc');
  });

  it('strips one pair of matching surrounding quotes', () => {
    expect(sanitise('"abc"')).toBe('abc');
    expect(sanitise("'abc'")).toBe('abc');
    expect(sanitise(' "abc" ')).toBe('abc');
  });

  it('leaves mismatched or inner quotes alone', () => {
    expect(sanitise('"abc')).toBe('"abc');
    expect(sanitise("abc'")).toBe("abc'");
    expect(sanitise('a"b"c')).toBe('a"b"c');
    expect(sanitise('""')).toBe('');
  });

  it('handles empty input', () => {
    expect(sanitise('')).toBe('');
    expect(sanitise('   ')).toBe('');
  });
});
