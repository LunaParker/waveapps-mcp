import { describe, expect, it } from 'vitest';
import { WaveApiError, WaveAuthError, WaveError, WaveGraphQLError, WaveMutationError, requireDidSucceed } from './errors.js';

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
  it('captures status, url, body, and puts a body excerpt in the message', () => {
    const err = new WaveApiError({ status: 400, url: 'https://x/y', body: { items: [{ taxes: ['Expected a dictionary'] }] } });
    expect(err.status).toBe(400);
    expect(err.url).toBe('https://x/y');
    expect(err.body).toEqual({ items: [{ taxes: ['Expected a dictionary'] }] });
    expect(err.message).toBe('Wave API 400 on https://x/y: {"items":[{"taxes":["Expected a dictionary"]}]}');
    expect(err.name).toBe('WaveApiError');
  });

  it('keeps the plain message when the body is empty', () => {
    expect(new WaveApiError({ status: 500, url: 'https://x/y', body: null }).message).toBe('Wave API 500 on https://x/y');
    expect(new WaveApiError({ status: 500, url: 'https://x/y', body: '' }).message).toBe('Wave API 500 on https://x/y');
    expect(new WaveApiError({ status: 500, url: 'https://x/y', body: {} }).message).toBe('Wave API 500 on https://x/y');
  });

  it('uses a string body as is and truncates long bodies', () => {
    expect(new WaveApiError({ status: 502, url: 'u', body: '<html>Bad gateway</html>' }).message).toBe('Wave API 502 on u: <html>Bad gateway</html>');
    const long = 'x'.repeat(5000);
    const msg = new WaveApiError({ status: 500, url: 'u', body: long }).message;
    expect(msg.length).toBeLessThan(1100);
    expect(msg.endsWith('...')).toBe(true);
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

describe('WaveGraphQLError details', () => {
  it('includes the extension code and path when present', () => {
    const err = new WaveGraphQLError({
      operationName: 'CreateEstimate',
      errors: [{ message: 'Variable "$input" got invalid value', extensions: { code: 'VARIABLE_VALUE' }, path: ['estimateCreate', 'input'] }],
    });
    expect(err.message).toBe('Wave GraphQL "CreateEstimate" returned errors: Variable "$input" got invalid value (VARIABLE_VALUE) at estimateCreate.input');
  });
});

describe('WaveMutationError', () => {
  it('lists each input error with its path and code', () => {
    const err = new WaveMutationError({
      operationName: 'InvoiceSend',
      inputErrors: [
        { path: ['to', 0], message: 'Enter a valid email address.', code: 'INVALID' },
        { message: 'Invoice must be approved first.' },
      ],
    });
    expect(err.name).toBe('WaveMutationError');
    expect(err.operationName).toBe('InvoiceSend');
    expect(err.inputErrors).toHaveLength(2);
    expect(err.message).toBe('Wave rejected InvoiceSend: to.0: Enter a valid email address. (INVALID); Invoice must be approved first.');
    expect(err).toBeInstanceOf(WaveError);
  });

  it('says so when Wave gave no reason', () => {
    expect(new WaveMutationError({ operationName: 'DeleteCustomer', inputErrors: null }).message).toBe('Wave rejected DeleteCustomer: no reason given');
  });
});

describe('requireDidSucceed', () => {
  it('returns the payload when didSucceed is true', () => {
    const payload = { didSucceed: true, inputErrors: [], customer: { id: 'c' } };
    expect(requireDidSucceed('CreateCustomer', payload)).toBe(payload);
  });

  it('throws WaveMutationError when didSucceed is false or the payload is missing', () => {
    expect(() => requireDidSucceed('CreateCustomer', { didSucceed: false, inputErrors: [{ message: 'Name is required.' }] })).toThrow(
      'Wave rejected CreateCustomer: Name is required.',
    );
    expect(() => requireDidSucceed('CreateCustomer', null)).toThrow(WaveMutationError);
    expect(() => requireDidSucceed('CreateCustomer', undefined)).toThrow(/no reason given/);
  });
});
