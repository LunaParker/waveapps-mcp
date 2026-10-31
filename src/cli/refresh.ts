import { SignInChallengeError } from '../auth/auth0-sign-in.js';
import { credentialsPath, migrateLegacySecrets, patchCredentials, readCredentials } from '../auth/credentials.js';
import { withProfileLock } from '../auth/profile-lock.js';
import { refreshSession } from '../auth/refresh-session.js';
import { secretStore, type SecretStore } from '../auth/secrets.js';

export interface RunRefreshDeps {
  console?: Pick<Console, 'log' | 'error'>;
  store?: SecretStore;
  refresh?: typeof refreshSession;
}

export interface RunRefreshOptions {
  /** Show the browser window while it signs in. */
  headed?: boolean;
}

export const REFRESH_EXIT_OK = 0;
export const REFRESH_EXIT_NOT_CONFIGURED = 1;
export const REFRESH_EXIT_CHALLENGE = 3;
export const REFRESH_EXIT_FAILURE = 4;

/**
 * Run the same automatic sign-in the server does on an expired session, from a terminal,
 * so it can be tried (or watched with --headed) before the server ever needs it.
 */
export async function runRefresh(deps: RunRefreshDeps = {}, options: RunRefreshOptions = {}): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const store = deps.store ?? secretStore();
  const refresh = deps.refresh ?? refreshSession;

  try {
    const moved = migrateLegacySecrets(store);
    if (moved.length > 0) log(`[waveapps-mcp] Moved ${moved.join(' and ')} from credentials.json into the OS credential store.`);
  } catch (e) {
    err(`[waveapps-mcp] Could not move plaintext secrets into the OS credential store: ${(e as Error).message}`);
    return REFRESH_EXIT_FAILURE;
  }

  const email = readCredentials()?.email;
  let password: string | null;
  let totpSecret: string | null;
  try {
    password = store.get('password');
    totpSecret = store.get('totp-secret');
  } catch (e) {
    err(`[waveapps-mcp] Could not read the OS credential store: ${(e as Error).message}`);
    return REFRESH_EXIT_FAILURE;
  }
  if (!email || !password) {
    err('[waveapps-mcp] No email and password on file. Run `npx waveapps-mcp save-password` first.');
    return REFRESH_EXIT_NOT_CONFIGURED;
  }

  log(`[waveapps-mcp] Signing in to Wave as ${email} (${options.headed ? 'visible window' : 'headless'})...`);
  try {
    const scraped = await withProfileLock(() =>
      refresh({ email, password, ...(totpSecret ? { totpSecret } : {}) }, { headed: options.headed ?? false }),
    );
    patchCredentials({
      authToken: scraped.authToken,
      csrfToken: scraped.csrfToken,
      businessId: scraped.businessId ?? readCredentials()?.businessId,
    });
    log(`[waveapps-mcp] Signed in. New token (length ${scraped.authToken.length}) saved to ${credentialsPath()}.`);
    return REFRESH_EXIT_OK;
  } catch (e) {
    err(`[waveapps-mcp] ${(e as Error).message}`);
    return e instanceof SignInChallengeError ? REFRESH_EXIT_CHALLENGE : REFRESH_EXIT_FAILURE;
  }
}
