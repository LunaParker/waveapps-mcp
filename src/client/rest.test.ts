import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveApiError, WaveAuthError } from './errors.js';
import { WaveRestClient } from './rest.js';

type FetchArgs = Parameters<typeof fetch>;

const AUTH = { authToken: 'TOKEN', csrfToken: 'CSRF' };

function mockResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers(init.headers ?? { 'content-type': 'application/json' });
  return new Response(text, { status: init.status ?? 200, headers });
}

describe('WaveRestClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: WaveRestClient;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    client = new WaveRestClient(AUTH);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = (): FetchArgs => fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as FetchArgs;
  const lastUrl = (): string => String(lastCall()[0]);
  const lastInit = (): RequestInit => lastCall()[1] as RequestInit;

  describe('get', () => {
    it('builds the correct URL with query params and returns parsed JSON', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ a: 1 }));
      const out = await client.get<{ a: number }>('/x', { page: 1, sort: '-date', active: true });
      expect(out).toEqual({ a: 1 });
      const url = new URL(lastUrl());
      expect(url.origin + url.pathname).toBe('https://api.waveapps.com/x');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.get('sort')).toBe('-date');
      expect(url.searchParams.get('active')).toBe('true');
    });

    it('normalises paths that already have a leading slash', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await client.get('no-leading-slash');
      expect(lastUrl()).toContain('/no-leading-slash');
    });

    it('drops undefined and null query values', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await client.get('/x', { page: 1, status: undefined, customer: null });
      const url = new URL(lastUrl());
      expect(url.searchParams.has('status')).toBe(false);
      expect(url.searchParams.has('customer')).toBe(false);
      expect(url.searchParams.get('page')).toBe('1');
    });

    it('omits the x-csrftoken header on reads', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await client.get('/x');
      const headers = lastInit().headers as Record<string, string>;
      expect(headers['x-csrftoken']).toBeUndefined();
      expect(headers.Authorization).toBe('Bearer TOKEN');
    });
  });

  describe('getPaged', () => {
    it('returns items + meta with X-Total-* headers parsed', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse([{ id: 1 }, { id: 2 }], { headers: { 'content-type': 'application/json', 'X-Total-Count': '99', 'X-Total-Pages': '4' } }),
      );
      const out = await client.getPaged<{ id: number }>('/items/', { page: 2, page_size: 25 });
      expect(out.items).toEqual([{ id: 1 }, { id: 2 }]);
      expect(out.meta).toEqual({ page: 2, pageSize: 25, totalCount: 99, totalPages: 4 });
    });

    it('defaults page=1, pageSize=25 when caller omits them', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse([]));
      const out = await client.getPaged('/items/');
      expect(out.meta.page).toBe(1);
      expect(out.meta.pageSize).toBe(25);
    });

    it('handles missing X-Total-* headers as null', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse([]));
      const out = await client.getPaged('/items/');
      expect(out.meta.totalCount).toBeNull();
      expect(out.meta.totalPages).toBeNull();
    });
  });

  describe('mutating verbs', () => {
    it('post attaches CSRF + content-type and serialises the body', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: 'new' }, { status: 201 }));
      const out = await client.post<{ id: string }>('/x/', { foo: 'bar' });
      expect(out).toEqual({ id: 'new' });
      const init = lastInit();
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
      const headers = init.headers as Record<string, string>;
      expect(headers['x-csrftoken']).toBe('CSRF');
      expect(headers['content-type']).toBe('application/json');
    });

    it('patch sends a PATCH', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await client.patch('/x/', { y: 1 });
      expect(lastInit().method).toBe('PATCH');
    });

    it('put sends a PUT', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await client.put('/x/', { y: 1 });
      expect(lastInit().method).toBe('PUT');
    });

    it('delete returns void on 204', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(client.delete('/x/')).resolves.toBeUndefined();
      expect(lastInit().method).toBe('DELETE');
    });

    it('delete parses the body when status is non-204 and 2xx', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ confirmation: true }));
      await expect(client.delete('/x/')).resolves.toBeUndefined();
    });
  });

  describe('error mapping', () => {
    it('throws WaveAuthError on 401', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      await expect(client.get('/x')).rejects.toBeInstanceOf(WaveAuthError);
    });

    it('throws WaveAuthError on 403', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      await expect(client.get('/x')).rejects.toBeInstanceOf(WaveAuthError);
    });

    it('throws WaveApiError with status/url/body on a 422', async () => {
      const errBody = { errors: [{ field: 'x' }] };
      fetchSpy.mockResolvedValueOnce(mockResponse(errBody, { status: 422 }));
      try {
        await client.post('/things/', {});
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(WaveApiError);
        if (err instanceof WaveApiError) {
          expect(err.status).toBe(422);
          expect(err.url).toContain('/things/');
          expect(err.body).toEqual(errBody);
        }
      }
    });

    it('keeps non-JSON error bodies as a string', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('plain text oops', { status: 500 }));
      try {
        await client.get('/x');
      } catch (err) {
        expect(err).toBeInstanceOf(WaveApiError);
        if (err instanceof WaveApiError) {
          expect(err.body).toBe('plain text oops');
        }
      }
    });

    it('treats an empty 200 body as null', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'content-type': 'application/json' } }));
      await expect(client.get('/x')).resolves.toBeNull();
    });

    it('treats a non-numeric X-Total-Count header as null', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json', 'X-Total-Count': 'NaN' },
        }),
      );
      const paged = await client.getPaged('/items/');
      expect(paged.meta.totalCount).toBeNull();
    });
  });

  describe('refresh-on-401', () => {
    it('retries the request once when the refresher returns true', async () => {
      const refresher = vi.fn(async () => true);
      const c = new WaveRestClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      fetchSpy.mockResolvedValueOnce(mockResponse({ retried: true }));
      const out = await c.get<{ retried: boolean }>('/x');
      expect(out).toEqual({ retried: true });
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('still throws WaveAuthError when the refresh succeeds but the retry also 401s', async () => {
      const refresher = vi.fn(async () => true);
      const c = new WaveRestClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(c.get('/x')).rejects.toBeInstanceOf(WaveAuthError);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws WaveAuthError when no refresher is configured', async () => {
      const c = new WaveRestClient(AUTH);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(c.get('/x')).rejects.toBeInstanceOf(WaveAuthError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws WaveAuthError when the refresher itself returns false', async () => {
      const refresher = vi.fn(async () => false);
      const c = new WaveRestClient(AUTH, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(c.get('/x')).rejects.toBeInstanceOf(WaveAuthError);
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('uses a getAuth callable for each retry so the refreshed token is picked up', async () => {
      let auth: typeof AUTH = { authToken: 'OLD', csrfToken: 'CSRF' };
      const refresher = vi.fn(async () => {
        auth = { authToken: 'NEW', csrfToken: 'CSRF' };
        return true;
      });
      const c = new WaveRestClient(() => auth, refresher);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
      fetchSpy.mockResolvedValueOnce(mockResponse({}));
      await c.get('/x');
      const firstAuth = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      const secondAuth = (fetchSpy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
      expect(firstAuth.Authorization).toBe('Bearer OLD');
      expect(secondAuth.Authorization).toBe('Bearer NEW');
    });
  });
});
