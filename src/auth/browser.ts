import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './credentials.js';

const BROWSER_PATH_ENV = 'WAVE_MCP_BROWSER_PATH';
/** Default puppeteer-core channel when the user hasn't set WAVE_MCP_BROWSER_PATH. */
export const DEFAULT_BROWSER_CHANNEL = 'chrome' as const;
export type ChromeChannel = 'chrome' | 'chrome-beta' | 'chrome-canary' | 'chrome-dev' | 'chromium';

/** Result of resolving how puppeteer-core should launch a browser. */
export type LaunchTarget =
  | { kind: 'executablePath'; path: string }
  | { kind: 'channel'; channel: ChromeChannel };

/**
 * Resolve which browser puppeteer-core should launch.
 *
 *   - If `WAVE_MCP_BROWSER_PATH` is set, we hand puppeteer-core that executable verbatim.
 *     An invalid path is rejected outright (returns null) rather than silently falling back —
 *     the user set the env var on purpose and deserves to know it's wrong.
 *   - Otherwise we ask puppeteer-core to discover Chrome via its `channel: 'chrome'` mechanism.
 *     If the user has Chrome installed, puppeteer-core picks it up; if not, the launch fails
 *     with a clear error and the user can set `WAVE_MCP_BROWSER_PATH` to their browser.
 */
export function resolveBrowserLaunchTarget(
  opts: { existsFn?: (path: string) => boolean } = {},
): LaunchTarget | null {
  const exists = opts.existsFn ?? defaultExists;
  const override = process.env[BROWSER_PATH_ENV];
  if (override && override.length > 0) {
    return exists(override) ? { kind: 'executablePath', path: override } : null;
  }
  return { kind: 'channel', channel: DEFAULT_BROWSER_CHANNEL };
}

function defaultExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Dedicated user-data-dir the login flow always uses. Keeps the user's real Brave/Chrome untouched. */
export function browserProfileDir(): string {
  return join(configDir(), 'browser-profile');
}

export const WAVE_LOGIN_URL = 'https://my.waveapps.com/login/';
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
