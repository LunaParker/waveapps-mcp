import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './credentials.js';

const BROWSER_PATH_ENV = 'WAVE_MCP_BROWSER_PATH';

/** Result of resolving which browser Playwright should launch. */
export type LaunchTarget = { kind: 'bundled' } | { kind: 'executablePath'; path: string };

/**
 * Resolve which browser Playwright should launch.
 *
 *   - If `WAVE_MCP_BROWSER_PATH` is set, we hand Playwright that executable verbatim.
 *     An invalid path is rejected outright (returns null) rather than silently falling back —
 *     the user set the env var on purpose and deserves to know it's wrong.
 *   - Otherwise Playwright's own Chromium (`npx playwright install chromium`).
 */
export function resolveBrowserLaunchTarget(
  opts: { existsFn?: (path: string) => boolean } = {},
): LaunchTarget | null {
  const exists = opts.existsFn ?? defaultExists;
  const override = process.env[BROWSER_PATH_ENV];
  if (override && override.length > 0) {
    return exists(override) ? { kind: 'executablePath', path: override } : null;
  }
  return { kind: 'bundled' };
}

function defaultExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dedicated user-data-dir for every sign-in, headed or headless. Keeps the user's real
 * browser untouched, and keeps Cloudflare's and Auth0's device cookies between runs.
 * Not `browser-profile`: that one was written by the older Puppeteer/Chrome flow.
 */
export function browserProfileDir(): string {
  return join(configDir(), 'chromium-profile');
}

/**
 * Starting here forces Wave's Auth0 sign-in. `my.waveapps.com/login/` picks between Auth0
 * and the older Django form at random.
 */
export const WAVE_AUTH0_ENTRY_URL = 'https://next.waveapps.com/auth/auth0';
export const WAVE_AUTH_COOKIE = 'waveapps';
export const WAVE_CSRF_COOKIE = 'identity-csrftoken';
/** Wave sets the auth cookie to this sentinel when the session is invalidated. */
export const WAVE_INVALIDATED_SENTINEL = 'invalidated';

export interface ScrapedAuth {
  authToken: string;
  csrfToken: string | undefined;
  businessId: string | undefined;
}

interface CookieLike {
  name: string;
  value: string;
}

const BUSINESS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_URL_RE = /^https:\/\/next\.waveapps\.com\/([0-9a-f-]{36})(?:\/|$)/i;

/**
 * Pure function: given the current cookies and page URL, returns a credential bundle
 * if Wave has issued a real (non-sentinel) auth token, otherwise null. Tested in isolation.
 */
export function extractWaveAuth(cookies: readonly CookieLike[], currentUrl: string | null): ScrapedAuth | null {
  const auth = cookies.find((c) => c.name === WAVE_AUTH_COOKIE)?.value;
  if (!auth || auth.length === 0 || auth === WAVE_INVALIDATED_SENTINEL) return null;
  const csrf = cookies.find((c) => c.name === WAVE_CSRF_COOKIE)?.value;
  const businessId = parseBusinessIdFromUrl(currentUrl);
  return {
    authToken: auth,
    csrfToken: csrf && csrf.length > 0 ? csrf : undefined,
    businessId,
  };
}

export function parseBusinessIdFromUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  const match = BUSINESS_URL_RE.exec(url);
  const candidate = match?.[1];
  return candidate && BUSINESS_UUID_RE.test(candidate) ? candidate : undefined;
}
