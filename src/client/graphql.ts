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
  errors?: ReadonlyArray<{
    message: string;
    extensions?: { code?: string };
    path?: ReadonlyArray<string | number>;
  }>;
}

type Attempt<TData> = { authRejected: true } | { authRejected: false; data: TData };

export class WaveGraphQLClient {
  private readonly getAuth: () => WaveAuth;
  private readonly refresher: WaveAuthRefresher | undefined;

  constructor(auth: WaveAuthSource, refresher?: WaveAuthRefresher) {
    this.getAuth = typeof auth === 'function' ? auth : (): WaveAuth => auth;
    this.refresher = refresher;
  }

  async execute<TData, TVars = Record<string, unknown>>(op: GraphQLOperation<TVars>): Promise<TData> {
    const first = await this.attempt<TData, TVars>(op);
    if (!first.authRejected) return first.data;
    if (this.refresher && (await this.refresher())) {
      const retry = await this.attempt<TData, TVars>(op);
      if (!retry.authRejected) return retry.data;
    }
    throw new WaveAuthError();
  }

  private async attempt<TData, TVars>(op: GraphQLOperation<TVars>): Promise<Attempt<TData>> {
    const res = await this.fetchOnce(op);
    if (res.status === 401 || res.status === 403) return { authRejected: true };
    return this.parsePayload<TData, TVars>(res, op);
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

  private async parsePayload<TData, TVars>(res: Response, op: GraphQLOperation<TVars>): Promise<Attempt<TData>> {
    const text = await safeText(res);
    const payload = parseJson(text) as GraphQLResponse<TData> | undefined;
    const errors = payload?.errors ?? [];
    // An expired session comes back as HTTP 200 with an UNAUTHENTICATED error, not a 401.
    if (errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) return { authRejected: true };
    // Schema drift (unknown field, renamed input or enum) is a 400 that still carries GraphQL errors.
    if (errors.length > 0) {
      throw new WaveGraphQLError({ operationName: op.operationName, errors });
    }
    if (!res.ok || payload === undefined) {
      throw new WaveApiError({ status: res.status, url: GQL_ENDPOINT, body: text });
    }
    if (payload.data === undefined) {
      throw new WaveGraphQLError({
        operationName: op.operationName,
        errors: [{ message: 'GraphQL response had neither `data` nor `errors`.' }],
      });
    }
    return { authRejected: false, data: payload.data };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
