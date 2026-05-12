import { describe, expect, it } from 'vitest';
import { errorResult, flattenConnection, jsonResult } from './_helpers.js';

describe('jsonResult', () => {
  it('returns text content with pretty-printed JSON', () => {
    const r = jsonResult({ a: 1, b: 'x' });
    expect(r.content).toEqual([
      { type: 'text', text: JSON.stringify({ a: 1, b: 'x' }, null, 2) },
    ]);
    expect(r.isError).toBeUndefined();
  });
});

describe('errorResult', () => {
  it('marks isError and wraps the message as text content', () => {
    const r = errorResult('something broke');
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'something broke' }]);
  });
});

describe('flattenConnection', () => {
  it('returns nodes from edges', () => {
    expect(flattenConnection({ edges: [{ node: 1 }, { node: 2 }] })).toEqual([1, 2]);
  });

  it('returns [] for null/undefined connection', () => {
    expect(flattenConnection(null)).toEqual([]);
    expect(flattenConnection(undefined)).toEqual([]);
  });

  it('returns [] for an empty edges array', () => {
    expect(flattenConnection({ edges: [] })).toEqual([]);
  });
});
