import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveApiError, WaveAuthError, WaveGraphQLError } from './errors.js';
import { WaveGraphQLClient } from './graphql.js';

const AUTH = { authToken: 'TOKEN', csrfToken: 'CSRF' };

function mockResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WaveGraphQLClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: WaveGraphQLClient;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    client = new WaveGraphQLClient(AUTH);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to gql.waveapps.com/graphql/internal with the operation envelope', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ data: { ping: 'ok' } }));
    const result = await client.execute({
      operationName: 'Ping',
      query: 'query Ping { ping }',
      variables: { v: 1 },
    });
    expect(result).toEqual({ ping: 'ok' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://gql.waveapps.com/graphql/internal');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ operationName: 'Ping', query: 'query Ping { ping }', variables: { v: 1 } });
  });

  it('attaches x-csrftoken when a CSRF token is configured', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ data: {} }));
    await client.execute({ operationName: 'Op', query: '{}', variables: {} });
    const headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['x-csrftoken']).toBe('CSRF');
    expect(headers['Authorization']).toBe('Bearer TOKEN');
  });

  it('omits x-csrftoken when no CSRF is configured', async () => {
    const noCsrf = new WaveGraphQLClient({ authToken: 'TOKEN', csrfToken: undefined });
    fetchSpy.mockResolvedValueOnce(mockResponse({ data: {} }));
    await noCsrf.execute({ operationName: 'Op', query: '{}', variables: {} });
    const headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['x-csrftoken']).toBeUndefined();
  });

  it('throws WaveAuthError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(client.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveAuthError);
  });

  it('throws WaveApiError on non-2xx non-auth status', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('server fail', { status: 503 }));
    await expect(client.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveApiError);
  });

  it('throws WaveGraphQLError when payload has errors[]', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      errors: [{ message: 'Field "foo" is unknown' }],
    }));
    try {
      await client.execute({ operationName: 'X', query: '{}', variables: {} });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WaveGraphQLError);
      if (err instanceof WaveGraphQLError) {
        expect(err.operationName).toBe('X');
        expect(err.errors).toHaveLength(1);
        expect(err.message).toContain('foo');
      }
    }
  });

  it('throws WaveGraphQLError when data is undefined and no errors', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({}));
    await expect(client.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveGraphQLError);
  });

  describe('refresh-on-401', () => {
    it('retries once when the refresher returns true', async () => {
      const refresher = vi.fn(async () => true);
      const c = new WaveGraphQLClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      fetchSpy.mockResolvedValueOnce(mockResponse({ data: { ok: true } }));
      const out = await c.execute({ operationName: 'X', query: '{}', variables: {} });
      expect(out).toEqual({ ok: true });
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws WaveAuthError when refresh succeeds but the retry still 401s', async () => {
      const refresher = vi.fn(async () => true);
      const c = new WaveGraphQLClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(c.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveAuthError);
    });

    it('throws WaveAuthError when no refresher is configured', async () => {
      const c = new WaveGraphQLClient(AUTH);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(c.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveAuthError);
    });

    it('does not retry on non-auth errors (e.g. 500)', async () => {
      const refresher = vi.fn(async () => true);
      const c = new WaveGraphQLClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('server bad day', { status: 500 }));
      await expect(c.execute({ operationName: 'X', query: '{}', variables: {} })).rejects.toBeInstanceOf(WaveApiError);
      expect(refresher).not.toHaveBeenCalled();
    });
  });

  it('swallows a text() failure when reading an error body', async () => {
    // Build a 500 response whose .text() rejects — exercises the safeText catch.
    const failing = new Response('ignored', { status: 500 });
    Object.defineProperty(failing, 'text', {
      value: () => Promise.reject(new Error('stream broke')),
    });
    fetchSpy.mockResolvedValueOnce(failing);
    try {
      await client.execute({ operationName: 'X', query: '{}', variables: {} });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WaveApiError);
      if (err instanceof WaveApiError) {
        expect(err.body).toBe('');
        expect(err.status).toBe(500);
      }
    }
  });
});
