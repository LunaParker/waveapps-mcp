import { log } from '../util/log.js';
import { authHeaders, type WaveAuth } from './auth.js';
import { WaveApiError, WaveAuthError } from './errors.js';
import type { PageMeta, Paged, QueryParams } from './types.js';

const REST_BASE = 'https://api.waveapps.com';

/** Either a fixed WaveAuth (back-compat) or a getter that returns the current auth on each request. */
export type WaveAuthSource = WaveAuth | (() => WaveAuth);

/**
 * Optional refresh hook. Returns true if the auth was successfully renewed (caller should retry),
 * false if no refresher is configured (caller throws WaveAuthError as before).
 */
export type WaveAuthRefresher = () => Promise<boolean>;

export class WaveRestClient {
  private readonly getAuth: () => WaveAuth;
  private readonly refresher: WaveAuthRefresher | undefined;

  constructor(auth: WaveAuthSource, refresher?: WaveAuthRefresher) {
    this.getAuth = typeof auth === 'function' ? auth : (): WaveAuth => auth;
    this.refresher = refresher;
  }

  /** GET a single resource. Returns parsed JSON. */
  async get<T>(path: string, query?: QueryParams): Promise<T> {
    const url = buildUrl(path, query);
    const res = await this.request(url, { method: 'GET' });
    return (await parseJsonResponse<T>(res, url)) as T;
  }

  /** GET a list endpoint and surface Wave's pagination headers. */
  async getPaged<T>(path: string, query?: QueryParams): Promise<Paged<T>> {
    const url = buildUrl(path, query);
    const res = await this.request(url, { method: 'GET' });
    const items = (await parseJsonResponse<ReadonlyArray<T>>(res, url)) as ReadonlyArray<T>;
    return {
      items,
      meta: pageMetaFromResponse(res, query),
    };
  }

  async post<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    const url = buildUrl(path, query);
    const res = await this.request(url, {
      method: 'POST',
      mutating: true,
      body: JSON.stringify(body),
    });
    return (await parseJsonResponse<T>(res, url)) as T;
  }

  async patch<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    const url = buildUrl(path, query);
    const res = await this.request(url, {
      method: 'PATCH',
      mutating: true,
      body: JSON.stringify(body),
    });
    return (await parseJsonResponse<T>(res, url)) as T;
  }

  async put<T>(path: string, body: unknown, query?: QueryParams): Promise<T> {
    const url = buildUrl(path, query);
    const res = await this.request(url, {
      method: 'PUT',
      mutating: true,
      body: JSON.stringify(body),
    });
    return (await parseJsonResponse<T>(res, url)) as T;
  }

  async delete(path: string, query?: QueryParams): Promise<void> {
    const url = buildUrl(path, query);
    const res = await this.request(url, { method: 'DELETE', mutating: true });
    if (res.status === 204) return;
    await parseJsonResponse<unknown>(res, url);
  }

  private async request(
    url: string,
    opts: { method: string; mutating?: boolean; body?: string },
  ): Promise<Response> {
    const res = await this.requestOnce(url, opts);
    if (res.status === 401 || res.status === 403) {
      if (this.refresher && (await this.refresher())) {
        const retry = await this.requestOnce(url, opts);
        if (retry.status === 401 || retry.status === 403) throw new WaveAuthError();
        return retry;
      }
      throw new WaveAuthError();
    }
    return res;
  }

  private async requestOnce(
    url: string,
    opts: { method: string; mutating?: boolean; body?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...authHeaders(this.getAuth(), opts.mutating === true),
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const started = Date.now();
    const res = await fetch(url, { method: opts.method, headers, body: opts.body });
    log.debug('rest', { method: opts.method, url, status: res.status, ms: Date.now() - started });
    return res;
  }
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!path.startsWith('/')) path = `/${path}`;
  const url = new URL(`${REST_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseJsonResponse<T>(res: Response, url: string): Promise<T | null> {
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new WaveApiError({ status: res.status, url, body });
  }
  return body as T;
}

function pageMetaFromResponse(res: Response, query?: QueryParams): PageMeta {
  const page = Number(query?.['page'] ?? 1);
  const pageSize = Number(query?.['page_size'] ?? 25);
  const totalCount = numOrNull(res.headers.get('x-total-count'));
  const totalPages = numOrNull(res.headers.get('x-total-pages'));
  return { page, pageSize, totalCount, totalPages };
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
