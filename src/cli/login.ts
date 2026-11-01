import type { BrowserContext, Page } from 'playwright';
import {
  WAVE_AUTH0_ENTRY_URL,
  extractWaveAuth,
  resolveBrowserLaunchTarget,
  type LaunchTarget,
  type ScrapedAuth,
} from '../auth/browser.js';
import { credentialsPath, patchCredentials } from '../auth/credentials.js';
import { launchWaveBrowser } from '../auth/playwright.js';
import { withProfileLock } from '../auth/profile-lock.js';

export interface CookieLike {
  name: string;
  value: string;
}

export interface PageLike {
  goto(url: string, opts?: { waitUntil?: 'domcontentloaded' | 'load' }): Promise<unknown>;
  /** Cookies Wave's web app can see (the browser context's, not just this tab's). */
  cookies(): Promise<CookieLike[]>;
  url(): string;
}

export interface BrowserLike {
  pages(): Promise<PageLike[]>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface RunLoginDeps {
  /** Opens a visible browser on the shared sign-in profile. */
  launch?: () => Promise<BrowserLike>;
  resolveTarget?: () => LaunchTarget | null;
  console?: Pick<Console, 'log' | 'error'>;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stabilityMs?: number;
  /** How long to wait for an automatic sign-in that is already using the profile. */
  lockWaitMs?: number;
}

export const LOGIN_EXIT_OK = 0;
export const LOGIN_EXIT_NO_BROWSER = 2;
export const LOGIN_EXIT_TIMEOUT = 3;
export const LOGIN_EXIT_FAILURE = 4;

/**
 * Run the login flow: open a visible Chromium on Wave's Auth0 sign-in, wait for the user
 * to finish (password, CAPTCHA, 2FA), persist the cookies. Returns a process exit code.
 */
export async function runLogin(deps: RunLoginDeps = {}): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const resolveTarget = deps.resolveTarget ?? (() => resolveBrowserLaunchTarget());
  const launch = deps.launch ?? launchHeaded;
  const delay = deps.delay ?? defaultDelay;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const stabilityMs = deps.stabilityMs ?? 2_000;

  const target = resolveTarget();
  if (!target) {
    err(
      'WAVE_MCP_BROWSER_PATH is set but the path does not exist (or is not executable). Update it to a real Chromium-based browser executable, or unset it to use Playwright\'s Chromium.',
    );
    return LOGIN_EXIT_NO_BROWSER;
  }
  log(
    target.kind === 'executablePath'
      ? `[waveapps-mcp] Launching ${target.path} (via WAVE_MCP_BROWSER_PATH)`
      : "[waveapps-mcp] Launching Playwright's Chromium (set WAVE_MCP_BROWSER_PATH to use a specific browser)",
  );

  try {
    return await withProfileLock(async () => {
      let browser: BrowserLike;
      try {
        browser = await launch();
      } catch (e) {
        err(`Failed to launch browser: ${(e as Error).message}`);
        return LOGIN_EXIT_FAILURE;
      }
      try {
        const pages = await browser.pages();
        const page = pages[0] ?? (await browser.newPage());
        await page.goto(WAVE_AUTH0_ENTRY_URL, { waitUntil: 'domcontentloaded' });
        log('[waveapps-mcp] Sign in to Wave in the window that opened (close it to cancel).');
        log('[waveapps-mcp] On the 2FA page, ticking "Don\'t ask me for a code on this device" lets automatic sign-in skip it.');

        const scraped = await waitForAuth(page, { timeoutMs, pollIntervalMs, stabilityMs, delay });
        if (!scraped) {
          err(`[waveapps-mcp] Timed out after ${Math.floor(timeoutMs / 1000)}s waiting for a logged-in Wave session.`);
          return LOGIN_EXIT_TIMEOUT;
        }

        patchCredentials({
          authToken: scraped.authToken,
          csrfToken: scraped.csrfToken,
          businessId: scraped.businessId,
        });
        log(`[waveapps-mcp] Captured tokens (length ${scraped.authToken.length}); saved to ${credentialsPath()}.`);
        if (scraped.businessId) log(`[waveapps-mcp] Default business: ${scraped.businessId}`);
        return LOGIN_EXIT_OK;
      } finally {
        try {
          await browser.close();
        } catch {
          /* browser may already be closed */
        }
      }
    }, deps.lockWaitMs !== undefined ? { waitMs: deps.lockWaitMs } : {});
  } catch (e) {
    err(`[waveapps-mcp] ${(e as Error).message}`);
    return LOGIN_EXIT_FAILURE;
  }
}

interface WaitOpts {
  timeoutMs: number;
  pollIntervalMs: number;
  stabilityMs: number;
  delay: (ms: number) => Promise<void>;
}

/**
 * Polls cookies on `page` until we see a non-sentinel `waveapps` value that holds steady
 * for `stabilityMs`. Returns null on timeout. Exported for unit testing.
 */
export async function waitForAuth(page: PageLike, opts: WaitOpts): Promise<ScrapedAuth | null> {
  const deadline = Date.now() + opts.timeoutMs;
  let firstSeen: { auth: ScrapedAuth; at: number } | null = null;
  while (Date.now() < deadline) {
    let cookies: CookieLike[] = [];
    let url: string | null = null;
    try {
      cookies = await page.cookies();
      url = page.url();
    } catch {
      // Page may have been closed mid-poll; treat as no-auth and try again until timeout.
    }
    const candidate = extractWaveAuth(cookies, url);
    if (candidate) {
      if (firstSeen && firstSeen.auth.authToken === candidate.authToken) {
        if (Date.now() - firstSeen.at >= opts.stabilityMs) return candidate;
      } else {
        firstSeen = { auth: candidate, at: Date.now() };
      }
    } else {
      firstSeen = null;
    }
    await opts.delay(opts.pollIntervalMs);
  }
  return null;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchHeaded(): Promise<BrowserLike> {
  const ctx = await launchWaveBrowser({ headless: false });
  return {
    pages: async () => ctx.pages().map((p) => wrapPage(ctx, p)),
    newPage: async () => wrapPage(ctx, await ctx.newPage()),
    close: () => ctx.close(),
  };
}

function wrapPage(ctx: BrowserContext, page: Page): PageLike {
  return {
    goto: (url, opts) => page.goto(url, opts),
    cookies: () => ctx.cookies('https://next.waveapps.com'),
    url: () => page.url(),
  };
}
