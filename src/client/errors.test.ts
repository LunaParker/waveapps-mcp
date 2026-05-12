import { describe, expect, it } from 'vitest';
import { WaveApiError, WaveAuthError, WaveError, WaveGraphQLError } from './errors.js';

describe('WaveError', () => {
  it('sets the name to WaveError', () => {
    const err = new WaveError('boom');
    expect(err.name).toBe('WaveError');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });

  it('propagates the cause', () => {
    const root = new Error('root');
    const err = new WaveError('wrap', { cause: root });
    expect((err as Error & { cause?: unknown }).cause).toBe(root);
  });
});

describe('WaveAuthError', () => {
  it('has a sensible default message and the right name', () => {
    const err = new WaveAuthError();
    expect(err.name).toBe('WaveAuthError');
    expect(err.message).toMatch(/expired/);
    expect(err).toBeInstanceOf(WaveError);
  });

  it('accepts a custom message', () => {
    const err = new WaveAuthError('custom');
    expect(err.message).toBe('custom');
  });
});

describe('WaveApiError', () => {
  it('captures status, url, body, and builds a default message', () => {
    const err = new WaveApiError({ status: 500, url: 'https://x/y', body: { detail: 'oops' } });
    expect(err.status).toBe(500);
    expect(err.url).toBe('https://x/y');
    expect(err.body).toEqual({ detail: 'oops' });
    expect(err.message).toBe('Wave API 500 on https://x/y');
    expect(err.name).toBe('WaveApiError');
  });

  it('honours an explicit message override', () => {
    const err = new WaveApiError({ status: 422, url: '/x', body: null, message: 'kapow' });
    expect(err.message).toBe('kapow');
  });
});

describe('WaveGraphQLError', () => {
  it('joins error messages into the summary line', () => {
    const err = new WaveGraphQLError({
      operationName: 'GetX',
      errors: [{ message: 'a' }, { message: 'b' }],
    });
    expect(err.operationName).toBe('GetX');
    expect(err.errors).toHaveLength(2);
    expect(err.message).toContain('GetX');
    expect(err.message).toContain('a');
    expect(err.message).toContain('b');
    expect(err.name).toBe('WaveGraphQLError');
  });
});
