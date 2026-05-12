import { readCredentials } from '../auth/credentials.js';
import { optionalEnv } from '../util/env.js';

export interface WaveAuth {
  /** The value of the `waveapps` cookie from a logged-in next.waveapps.com session. */
  readonly authToken: string;
  /** The value of the `identity-csrftoken` cookie. Required for mutating requests. */
  readonly csrfToken: string | undefined;
}

/**
 * Load Wave credentials. Resolution order:
 *   1. `WAVE_AUTH_TOKEN` / `WAVE_CSRF_TOKEN` env vars (explicit override).
 *   2. ~/.config/waveapps-mcp/credentials.json (from `npx waveapps-mcp login`).
 *   3. Throw a helpful error pointing the user at the login subcommand.
 */
export function loadAuth(): WaveAuth {
  const envToken = optionalEnv('WAVE_AUTH_TOKEN');
  if (envToken !== undefined) {
    return { authToken: envToken, csrfToken: optionalEnv('WAVE_CSRF_TOKEN') };
  }
  const stored = readCredentials();
  if (stored !== null) {
    return { authToken: stored.authToken, csrfToken: stored.csrfToken };
  }
  throw new Error(
    'No Wave credentials found. Run `npx waveapps-mcp login` to log in, or set WAVE_AUTH_TOKEN (and WAVE_CSRF_TOKEN for mutations).',
  );
}

/** Back-compat alias. Prefer `loadAuth`. */
export const authFromEnv = loadAuth;

/**
 * Build the headers Wave's API expects on every authenticated request.
 *
 * @param auth     Session token bundle.
 * @param mutating Pass `true` for POST/PUT/PATCH/DELETE; we'll attach the CSRF header.
 */
export function authHeaders(auth: WaveAuth, mutating = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.authToken}`,
    Accept: 'application/json',
  };
  if (mutating) {
    if (!auth.csrfToken) {
      throw new Error('A mutating request was attempted without WAVE_CSRF_TOKEN configured.');
    }
    headers['x-csrftoken'] = auth.csrfToken;
  }
  return headers;
}
