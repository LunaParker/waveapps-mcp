import { loadAuth, type WaveAuth } from './auth.js';
import { WaveGraphQLClient } from './graphql.js';
import { WaveRestClient, type WaveAuthRefresher } from './rest.js';
import { assertUuid, toGlobalId } from './ids.js';
import { optionalEnv } from '../util/env.js';
import { patchCredentials, readCredentials } from '../auth/credentials.js';
import { refreshSession } from '../auth/refresh-session.js';
import { log } from '../util/log.js';

export interface WaveClientOptions {
  defaultBusinessId?: string;
  /** Function that mints a new WaveAuth when the current one returns 401. */
  refresher?: () => Promise<WaveAuth>;
}

export class WaveClient {
  readonly rest: WaveRestClient;
  readonly gql: WaveGraphQLClient;
  private readonly _defaultBusinessId: string | undefined;
  private _auth: WaveAuth;
  private readonly _externalRefresher: (() => Promise<WaveAuth>) | undefined;
  private _refreshInFlight: Promise<boolean> | undefined;

  constructor(auth: WaveAuth, opts: WaveClientOptions = {}) {
    this._auth = auth;
    this._externalRefresher = opts.refresher;
    const refresher: WaveAuthRefresher | undefined = opts.refresher
      ? (): Promise<boolean> => this.refreshOnce()
      : undefined;
    this.rest = new WaveRestClient((): WaveAuth => this._auth, refresher);
    this.gql = new WaveGraphQLClient((): WaveAuth => this._auth, refresher);
    const fromArg =
      opts.defaultBusinessId ?? optionalEnv('WAVE_BUSINESS_ID') ?? readCredentials()?.businessId;
    if (fromArg !== undefined) assertUuid(fromArg, 'WAVE_BUSINESS_ID');
    this._defaultBusinessId = fromArg;
  }

  /**
   * Build a client from env + credentials.json. If email+password are stored, an
   * auto-refresh hook is wired in: on 401, the server logs back into Wave (puppeteer-extra,
   * Wave's own form — not Google), persists the new cookies, and retries the failed call.
   */
  static fromEnv(): WaveClient {
    const auth = loadAuth();
    const stored = readCredentials();
    const refresher = buildDefaultRefresher(stored);
    return new WaveClient(auth, refresher ? { refresher } : {});
  }

  /**
   * Drive the configured refresher exactly once at a time. Returns true if the
   * auth was successfully renewed, false if no refresher was configured.
   */
  private async refreshOnce(): Promise<boolean> {
    if (!this._externalRefresher) return false;
    if (!this._refreshInFlight) {
      this._refreshInFlight = (async (): Promise<boolean> => {
        try {
          log.info('refreshing Wave session');
          this._auth = await this._externalRefresher!();
          log.info('refresh succeeded');
          return true;
        } catch (err) {
          log.warn('refresh failed', { err: String(err) });
          return false;
        } finally {
          this._refreshInFlight = undefined;
        }
      })();
    }
    return this._refreshInFlight;
  }

  /** Resolve a business UUID — caller-supplied wins, otherwise the configured default. */
  businessId(explicit?: string): string {
    const id = explicit ?? this._defaultBusinessId;
    if (id === undefined) {
      throw new Error('No business ID supplied. Pass `businessId` or set WAVE_BUSINESS_ID.');
    }
    assertUuid(id, 'businessId');
    return id;
  }

  /** Convenience wrapper to translate a business UUID to the Relay ID GraphQL wants. */
  businessGlobalId(explicit?: string): string {
    return toGlobalId('Business', this.businessId(explicit));
  }
}

/** Build the default puppeteer-driven refresher from stored credentials, or undefined when no password is on file. */
function buildDefaultRefresher(
  stored: ReturnType<typeof readCredentials>,
): (() => Promise<WaveAuth>) | undefined {
  if (!stored?.email || !stored.password) return undefined;
  const email = stored.email;
  const password = stored.password;
  const totpSecret = stored.totpSecret;
  return async (): Promise<WaveAuth> => {
    const scraped = await refreshSession({ email, password, totpSecret });
    patchCredentials({
      authToken: scraped.authToken,
      csrfToken: scraped.csrfToken,
      businessId: scraped.businessId ?? readCredentials()?.businessId,
    });
    return { authToken: scraped.authToken, csrfToken: scraped.csrfToken };
  };
}

export type { WaveAuth } from './auth.js';
export { authFromEnv, loadAuth } from './auth.js';
export type { PageMeta, Paged, QueryParams } from './types.js';
export { WaveError, WaveAuthError, WaveApiError, WaveGraphQLError } from './errors.js';
export { toGlobalId, fromGlobalId, toCompositeGlobalId, fromCompositeGlobalId, isUuid, assertUuid } from './ids.js';
