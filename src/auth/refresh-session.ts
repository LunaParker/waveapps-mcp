import {
  WAVE_LOGIN_URL,
  browserProfileDir,
  extractWaveAuth,
  resolveBrowserLaunchTarget,
  type ScrapedAuth,
} from './browser.js';
import { totp } from './totp.js';

/**
 * Args puppeteer-extra normally injects that betray automation to bot-detection systems.
 * Mirrored from `src/cli/login.ts` so background refreshes carry the same stealth posture.
 */
export const REFRESH_STEALTH_ARGS = Object.freeze([
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
]);
export const REFRESH_IGNORE_DEFAULT_ARGS = Object.freeze(['--enable-automation']);

export interface RefreshCredentials {
  email: string;
  password: string;
  /** Optional. If supplied, used to clear a Wave 2FA prompt automatically. */
  totpSecret?: string;
}

export interface DriverInput {
  email: string;
  password: string;
  /** Generates the current TOTP code from the stored secret, or null if none stored. */
  generateTotp: () => string | null;
}

export interface DriverResult {
  cookies: ReadonlyArray<{ name: string; value: string }>;
  url: string;
}

export interface RefreshSessionDeps {
  /** Inject a fake driver for tests; defaults to a puppeteer-extra implementation. */
  driver?: (input: DriverInput) => Promise<DriverResult>;
}

/**
 * Run a headless browser through Wave's own login form to mint fresh session cookies.
 * Unlike `npx waveapps-mcp login`, this avoids Google entirely — we POST directly to
 * Wave's username/password form, which doesn't have Google's automation detection.
 *
 * On 2FA-protected accounts, the driver fills in a TOTP code generated from the stored secret.
 */
export async function refreshSession(
  creds: RefreshCredentials,
  deps: RefreshSessionDeps = {},
): Promise<ScrapedAuth> {
  if (!creds.email || !creds.password) {
    throw new Error('refreshSession requires both email and password.');
  }
  const driver = deps.driver ?? loadDefaultDriver();
  const generateTotp = (): string | null => (creds.totpSecret ? totp(creds.totpSecret) : null);

  const result = await driver({ email: creds.email, password: creds.password, generateTotp });
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

interface PuppeteerPage {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  waitForSelector(sel: string, opts?: { timeout?: number }): Promise<unknown>;
  type(sel: string, text: string, opts?: { delay?: number }): Promise<unknown>;
  focus(sel: string): Promise<unknown>;
  $(sel: string): Promise<unknown | null>;
  waitForNavigation(opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  cookies(): Promise<ReadonlyArray<{ name: string; value: string }>>;
  content(): Promise<string>;
  title(): Promise<string>;
  url(): string;
  keyboard: { press(key: string): Promise<unknown> };
}

interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

function loadDefaultDriver(): (input: DriverInput) => Promise<DriverResult> {
  return async (input) => {
    const peMod = (await import('puppeteer-extra')) as unknown as {
      default?: { use: (p: unknown) => unknown; launch: (o: unknown) => Promise<PuppeteerBrowser> };
    };
    const puppeteer = peMod.default ?? (peMod as unknown as { use: (p: unknown) => unknown; launch: (o: unknown) => Promise<PuppeteerBrowser> });
    const stealthMod = (await import('puppeteer-extra-plugin-stealth')) as unknown as { default?: () => unknown };
    const Stealth = stealthMod.default ?? (stealthMod as unknown as () => unknown);
    puppeteer.use(Stealth());

    const launchTarget = resolveBrowserLaunchTarget();
    const launchArgs: Record<string, unknown> = {
      headless: 'new',
      defaultViewport: null,
      userDataDir: browserProfileDir(),
      args: [...REFRESH_STEALTH_ARGS],
      ignoreDefaultArgs: [...REFRESH_IGNORE_DEFAULT_ARGS],
    };
    if (launchTarget?.kind === 'executablePath') launchArgs['executablePath'] = launchTarget.path;
    else if (launchTarget?.kind === 'channel') launchArgs['channel'] = launchTarget.channel;

    const browser = await puppeteer.launch(launchArgs);
    try {
      const page = await browser.newPage();
      await page.goto(WAVE_LOGIN_URL, { waitUntil: 'domcontentloaded' });

      try {
        await page.waitForSelector('input[name="username"]', { timeout: 15_000 });
      } catch (e) {
        const title = await page.title().catch(() => '(no title)');
        throw new Error(
          `Login page did not render the username input. Final URL: ${page.url()}, ` +
            `title: ${JSON.stringify(title)}. Likely causes: Cloudflare bot challenge, ` +
            `Wave maintenance, or a profile-state issue. (${(e as Error).message})`,
        );
      }

      await page.type('input[name="username"]', input.email);
      await page.type('input[name="password"]', input.password);
      // Submit via Enter on the focused password field. Equivalent to clicking the
      // submit button but works regardless of whether the button is fully hydrated.
      const nav1 = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => null);
      await page.focus('input[name="password"]');
      await page.keyboard.press('Enter');
      await nav1;

      // Detect a 2FA prompt — Django/Wave can call the field `otp_token`, `token`, or
      // expose an autocomplete="one-time-code" field. Cover the common shapes.
      const twoFactorSelectors = [
        'input[name="otp_token"]',
        'input[name="token"]',
        'input[name="code"]',
        'input[autocomplete="one-time-code"]',
      ].join(', ');
      const totpHandle = await page.$(twoFactorSelectors);
      if (totpHandle) {
        const code = input.generateTotp();
        if (!code) {
          throw new Error(
            'Wave is asking for a 2FA code but no TOTP secret is stored. ' +
              'Run `npx waveapps-mcp save-password` and supply the TOTP secret.',
          );
        }
        await page.type(twoFactorSelectors, code, { delay: 30 });
        const nav2 = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => null);
        await page.keyboard.press('Enter');
        await nav2;
      }

      const cookies = await page.cookies();
      const url = page.url();
      return { cookies, url };
    } finally {
      await browser.close().catch(() => undefined);
    }
  };
}
