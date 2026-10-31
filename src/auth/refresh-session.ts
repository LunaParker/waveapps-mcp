import { extractWaveAuth, type ScrapedAuth } from './browser.js';
import { runAutomatedSignIn } from './auth0-sign-in.js';
import { launchWaveBrowser } from './playwright.js';
import { totp } from './totp.js';

export interface RefreshCredentials {
  email: string;
  password: string;
  /** Optional. If supplied, used to clear Wave's 2FA prompt automatically. */
  totpSecret?: string;
}

export interface DriverInput {
  email: string;
  password: string;
  /** Generates the current TOTP code from the stored secret, or null if none stored. */
  generateTotp: () => string | null;
  /** Show the browser window instead of running headless. */
  headed: boolean;
}

export interface DriverResult {
  cookies: ReadonlyArray<{ name: string; value: string }>;
  url: string;
}

export interface RefreshSessionDeps {
  /** Inject a fake driver for tests; defaults to the Playwright + Auth0 implementation. */
  driver?: (input: DriverInput) => Promise<DriverResult>;
  headed?: boolean;
}

/**
 * Sign in to Wave in a headless Chromium (Auth0 email + password, then Wave's TOTP page) to
 * mint fresh session cookies. Throws SignInChallengeError when a person has to step in.
 * Callers hold withProfileLock around this; the default driver uses the shared profile.
 */
export async function refreshSession(
  creds: RefreshCredentials,
  deps: RefreshSessionDeps = {},
): Promise<ScrapedAuth> {
  if (!creds.email || !creds.password) {
    throw new Error('refreshSession requires both email and password.');
  }
  const driver = deps.driver ?? playwrightDriver;
  const generateTotp = (): string | null => (creds.totpSecret ? totp(creds.totpSecret) : null);

  const result = await driver({ email: creds.email, password: creds.password, generateTotp, headed: deps.headed ?? false });
  const auth = extractWaveAuth(result.cookies, result.url);
  if (!auth) {
    throw new Error(
      `Refresh completed but Wave did not set a valid \`waveapps\` cookie. ` +
        `Final URL was ${result.url}. Likely causes: wrong password, account locked, ` +
        `or a 2FA prompt that we couldn't clear (missing/invalid TOTP secret).`,
    );
  }
  return auth;
}

async function playwrightDriver(input: DriverInput): Promise<DriverResult> {
  const ctx = await launchWaveBrowser({ headless: !input.headed });
  try {
    return await runAutomatedSignIn(ctx, {
      email: input.email,
      password: input.password,
      generateTotp: input.generateTotp,
      totpMsRemaining: () => 30_000 - (Date.now() % 30_000),
    });
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
