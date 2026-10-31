import { log } from '../util/log.js';
import { authHeaders, type WaveAuth } from './auth.js';
import { WaveAuthError, WaveGraphQLError, WaveApiError } from './errors.js';
import type { WaveAuthRefresher, WaveAuthSource } from './rest.js';

const GQL_ENDPOINT = 'https://gql.waveapps.com/graphql/internal';

export interface GraphQLOperation<TVars> {
  operationName: string;
  query: string;
  variables: TVars;
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: ReadonlyArray<{ message: string; extensions?: unknown; path?: ReadonlyArray<string | number> }>;
}

export class WaveGraphQLClient {
  private readonly getAuth: () => WaveAuth;
  private readonly refresher: WaveAuthRefresher | undefined;

  constructor(auth: WaveAuthSource, refresher?: WaveAuthRefresher) {
    this.getAuth = typeof auth === 'function' ? auth : (): WaveAuth => auth;
    this.refresher = refresher;
  }

  async execute<TData, TVars = Record<string, unknown>>(op: GraphQLOperation<TVars>): Promise<TData> {
    const res = await this.fetchOnce(op);
    if (await isAuthFailure(res)) {
      if (this.refresher && (await this.refresher())) {
        const retry = await this.fetchOnce(op);
        if (await isAuthFailure(retry)) throw new WaveAuthError();
        return this.parsePayload(retry, op);
      }
      throw new WaveAuthError();
    }
    return this.parsePayload(res, op);
  }

  private async fetchOnce<TVars>(op: GraphQLOperation<TVars>): Promise<Response> {
    const auth = this.getAuth();
    // GraphQL mutations also POST to the same endpoint. Wave checks CSRF for state-changing
    // operations; cheaper to always send it when available than to parse the query.
    const headers: Record<string, string> = {
      ...authHeaders(auth, auth.csrfToken !== undefined),
      'content-type': 'application/json',
    };
    const body = JSON.stringify({
      operationName: op.operationName,
      query: op.query,
      variables: op.variables,
    });
    const started = Date.now();
    const res = await fetch(GQL_ENDPOINT, { method: 'POST', headers, body });
    log.debug('gql', { op: op.operationName, status: res.status, ms: Date.now() - started });
    return res;
  }

  private async parsePayload<TData, TVars>(res: Response, op: GraphQLOperation<TVars>): Promise<TData> {
    if (!res.ok) {
      const errBody = await safeText(res);
      throw new WaveApiError({ status: res.status, url: GQL_ENDPOINT, body: errBody });
    }
    const payload = (await res.json()) as GraphQLResponse<TData>;
    if (payload.errors && payload.errors.length > 0) {
      throw new WaveGraphQLError({ operationName: op.operationName, errors: payload.errors });
    }
    if (payload.data === undefined) {
      throw new WaveGraphQLError({
        operationName: op.operationName,
        errors: [{ message: 'GraphQL response had neither `data` nor `errors`.' }],
      });
    }
    return payload.data;
  }
}

/**
 * 401/403, or an expired token, which Wave reports as HTTP 200 with an
 * `UNAUTHENTICATED` error ("Invalid request, authentication expired.").
 */
async function isAuthFailure(res: Response): Promise<boolean> {
  if (res.status === 401 || res.status === 403) return true;
  if (!res.ok) return false;
  try {
    const payload = (await res.clone().json()) as GraphQLResponse<unknown>;
    return (payload.errors ?? []).some((e) => (e.extensions as { code?: unknown } | undefined)?.code === 'UNAUTHENTICATED');
  } catch {
    return false;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
