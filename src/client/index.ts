import { loadAuth, type WaveAuth } from './auth.js';
import { WaveGraphQLClient } from './graphql.js';
import { WaveRestClient, type WaveAuthRefresher } from './rest.js';
import { assertUuid, toGlobalId } from './ids.js';
import { WaveAuthError } from './errors.js';
import { optionalEnv } from '../util/env.js';
import { migrateLegacySecrets, patchCredentials, readCredentials } from '../auth/credentials.js';
import { withProfileLock } from '../auth/profile-lock.js';
import { refreshSession } from '../auth/refresh-session.js';
import { secretStore, type SecretStore } from '../auth/secrets.js';
import { log } from '../util/log.js';

export interface WaveClientOptions {
  defaultBusinessId?: string;
  /** Function that mints a new WaveAuth when `current` is rejected as expired. */
  refresher?: (current: WaveAuth) => Promise<WaveAuth>;
}

export class WaveClient {
  readonly rest: WaveRestClient;
  readonly gql: WaveGraphQLClient;
  private readonly _defaultBusinessId: string | undefined;
  private _auth: WaveAuth;
  private readonly _externalRefresher: ((current: WaveAuth) => Promise<WaveAuth>) | undefined;
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
   * Build a client from env + credentials.json, with a refresh hook for expired sessions:
   * it reuses a session saved by `login` since startup, or, if an email is on file and a
   * password is in the OS credential store, signs back in headlessly and retries the call.
   */
  static fromEnv(store: SecretStore = secretStore()): WaveClient {
    const auth = loadAuth();
    try {
      const moved = migrateLegacySecrets(store);
      if (moved.length > 0) log.info('moved plaintext secrets into the OS credential store', { moved });
    } catch (err) {
      log.warn('could not move plaintext secrets into the OS credential store', { err: String(err) });
    }
    return new WaveClient(auth, { refresher: buildDefaultRefresher(readCredentials(), store) });
  }

  /**
   * Drive the configured refresher exactly once at a time. Returns true if the auth was
   * renewed, false if no refresher was configured; throws WaveAuthError if renewal failed.
   */
  private async refreshOnce(): Promise<boolean> {
    if (!this._externalRefresher) return false;
    if (!this._refreshInFlight) {
      this._refreshInFlight = (async (): Promise<boolean> => {
        try {
          log.info('refreshing Wave session');
          this._auth = await this._externalRefresher!(this._auth);
          log.info('refresh succeeded');
          return true;
        } catch (err) {
          log.warn('refresh failed', { err: String(err) });
          if (err instanceof WaveAuthError) throw err;
          // Surface why, e.g. a CAPTCHA that needs `npx waveapps-mcp login`.
          throw new WaveAuthError(`Wave session expired and automatic sign-in failed: ${(err as Error).message}`);
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

/**
 * The default refresher. It first picks up a session another process saved since this one
 * last looked (`npx waveapps-mcp login`, or another server's sign-in), so a manual sign-in
 * works without restarting the client. Otherwise it signs in with Playwright, if an email is
 * on file and a password is in the store; secrets are read per refresh, never cached.
 */
function buildDefaultRefresher(
  stored: ReturnType<typeof readCredentials>,
  store: SecretStore,
): (current: WaveAuth) => Promise<WaveAuth> {
  let lastSeenOnDisk = stored?.authToken;
  return (current) =>
    withProfileLock(async (): Promise<WaveAuth> => {
      const onDisk = readCredentials();
      if (onDisk && onDisk.authToken !== lastSeenOnDisk && onDisk.authToken !== current.authToken) {
        lastSeenOnDisk = onDisk.authToken;
        return { authToken: onDisk.authToken, csrfToken: onDisk.csrfToken };
      }
      const email = onDisk?.email;
      const password = email ? readSecret(store, 'password') : null;
      if (!email || !password) throw new WaveAuthError();
      const totpSecret = readSecret(store, 'totp-secret') ?? undefined;
      const scraped = await refreshSession({ email, password, totpSecret });
      patchCredentials({
        authToken: scraped.authToken,
        csrfToken: scraped.csrfToken,
        businessId: scraped.businessId ?? onDisk?.businessId,
      });
      lastSeenOnDisk = scraped.authToken;
      return { authToken: scraped.authToken, csrfToken: scraped.csrfToken };
    });
}

function readSecret(store: SecretStore, name: 'password' | 'totp-secret'): string | null {
  try {
    return store.get(name);
  } catch (err) {
    log.warn('could not read the OS credential store', { name, err: String(err) });
    return null;
  }
}

export type { WaveAuth } from './auth.js';
export { authFromEnv, loadAuth } from './auth.js';
export type { PageMeta, Paged, QueryParams } from './types.js';
export { WaveError, WaveAuthError, WaveApiError, WaveGraphQLError } from './errors.js';
export { toGlobalId, fromGlobalId, toCompositeGlobalId, fromCompositeGlobalId, isUuid, assertUuid } from './ids.js';
