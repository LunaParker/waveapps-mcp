import { mkdirSync } from 'node:fs';
import {
  WAVE_LOGIN_URL,
  browserProfileDir,
  extractWaveAuth,
  resolveBrowserLaunchTarget,
  type ChromeChannel,
  type LaunchTarget,
  type ScrapedAuth,
} from '../auth/browser.js';
import { credentialsPath, patchCredentials } from '../auth/credentials.js';

export interface CookieLike {
  name: string;
  value: string;
}

export interface PageLike {
  goto(url: string, opts?: { waitUntil?: 'domcontentloaded' | 'load' }): Promise<unknown>;
  cookies(): Promise<CookieLike[]>;
  url(): string;
  /**
   * Optional. When present, we inject a stealth init script to mask `navigator.webdriver`
   * (Google OAuth flags it as "this browser is insecure"). Real puppeteer pages have it;
   * test stubs can leave it undefined.
   */
  evaluateOnNewDocument?(fn: (...args: unknown[]) => unknown): Promise<unknown>;
}

export interface BrowserLike {
  pages(): Promise<PageLike[]>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

/** Puppeteer-core launch options we actually use. `channel` and `executablePath` are mutually exclusive. */
export interface LaunchOptions {
  executablePath?: string;
  channel?: ChromeChannel;
  userDataDir: string;
  headless: boolean;
  defaultViewport: null;
  args: ReadonlyArray<string>;
  /**
   * Args puppeteer normally adds by default that we want stripped — specifically
   * `--enable-automation`, which Google's "is this browser secure?" check reads.
   */
  ignoreDefaultArgs: ReadonlyArray<string>;
}

/**
 * Stealth args we always pass. `--disable-blink-features=AutomationControlled` removes
 * `navigator.webdriver` from Blink; combined with stripping `--enable-automation` it's
 * usually enough to get Google OAuth to accept the browser.
 */
export const STEALTH_ARGS = Object.freeze([
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
]);

/** Default puppeteer args we strip — Google reads these to flag automated browsers. */
export const STEALTH_IGNORE_DEFAULT_ARGS = Object.freeze(['--enable-automation']);

export interface RunLoginDeps {
  launch?: (opts: LaunchOptions) => Promise<BrowserLike>;
  resolveTarget?: () => LaunchTarget | null;
  ensureDir?: (path: string) => void;
  console?: Pick<Console, 'log' | 'error'>;
  delay?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stabilityMs?: number;
}

export const LOGIN_EXIT_OK = 0;
export const LOGIN_EXIT_NO_BROWSER = 2;
export const LOGIN_EXIT_TIMEOUT = 3;
export const LOGIN_EXIT_FAILURE = 4;

/**
 * Run the login flow: ask puppeteer-core to launch Chrome (or whatever WAVE_MCP_BROWSER_PATH
 * points at), send the user to Wave, wait for cookies, persist them. Returns a process exit code.
 */
export async function runLogin(deps: RunLoginDeps = {}): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const resolveTarget = deps.resolveTarget ?? (() => resolveBrowserLaunchTarget());
  const launch = deps.launch ?? loadDefaultLauncher();
  const ensureDir = deps.ensureDir ?? defaultEnsureDir;
  const delay = deps.delay ?? defaultDelay;
  const timeoutMs = deps.timeoutMs ?? 5 * 60 * 1000;
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const stabilityMs = deps.stabilityMs ?? 2_000;

  const target = resolveTarget();
  if (!target) {
    err(
      'WAVE_MCP_BROWSER_PATH is set but the path does not exist (or is not executable). Update it to a real Chromium-based browser executable, or unset it to let puppeteer-core auto-discover Chrome.',
    );
    return LOGIN_EXIT_NO_BROWSER;
  }
  log(
    target.kind === 'executablePath'
      ? `[waveapps-mcp] Launching ${target.path} (via WAVE_MCP_BROWSER_PATH)`
      : `[waveapps-mcp] Launching puppeteer-core channel:${target.channel} (set WAVE_MCP_BROWSER_PATH to use a specific browser)`,
  );

  const userDataDir = browserProfileDir();
  ensureDir(userDataDir);

  const baseOpts = {
    userDataDir,
    headless: false,
    defaultViewport: null as null,
    args: [...STEALTH_ARGS],
    ignoreDefaultArgs: [...STEALTH_IGNORE_DEFAULT_ARGS],
  } satisfies Omit<LaunchOptions, 'executablePath' | 'channel'>;
  const launchOpts: LaunchOptions =
    target.kind === 'executablePath'
      ? { ...baseOpts, executablePath: target.path }
      : { ...baseOpts, channel: target.channel };

  let browser: BrowserLike;
  try {
    browser = await launch(launchOpts);
  } catch (e) {
    err(
      `Failed to launch browser: ${(e as Error).message}\nIf Chrome isn't installed, set WAVE_MCP_BROWSER_PATH to a Chromium-based browser (e.g. Brave).`,
    );
    return LOGIN_EXIT_FAILURE;
  }

  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await applyStealthInit(page);
    await page.goto(WAVE_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    log('[waveapps-mcp] Waiting for you to finish logging in (close the browser to cancel)...');

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
    log('[waveapps-mcp] You can close the browser window now.');
    return LOGIN_EXIT_OK;
  } finally {
    try {
      await browser.close();
    } catch {
      /* browser may already be closed */
    }
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

/**
 * Best-effort: mask `navigator.webdriver` before any page script runs. Run via
 * `evaluateOnNewDocument` (puppeteer-only, so test stubs can omit it). Combined with
 * `--disable-blink-features=AutomationControlled` this clears Google's OAuth check.
 */
export async function applyStealthInit(page: PageLike): Promise<void> {
  if (typeof page.evaluateOnNewDocument !== 'function') return;
  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        configurable: true,
        get: () => undefined,
      });
    });
  } catch {
    // Non-critical: if the page rejects the script, we still get most of the way there
    // via --disable-blink-features=AutomationControlled.
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultEnsureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

/** Minimal shape we need off the puppeteer-extra instance — typed manually because its */
/* published .d.ts doesn't play nicely with ESM dynamic-import + esModuleInterop. */
interface PuppeteerExtraLike {
  use(plugin: unknown): unknown;
  launch(opts: unknown): Promise<unknown>;
}

function loadDefaultLauncher(): (opts: LaunchOptions) => Promise<BrowserLike> {
  return async (opts) => {
    // Lazy-loaded so the MCP server never pulls puppeteer for normal stdio runs.
    // puppeteer-extra wraps puppeteer-core (which it auto-discovers) and the stealth plugin
    // bundles ~10 anti-detection evasions (chrome.runtime, plugins list, webgl fingerprint,
    // navigator.webdriver, languages, etc.) that Google's OAuth flow checks.
    const peMod = (await import('puppeteer-extra')) as unknown as { default?: PuppeteerExtraLike };
    const puppeteer = (peMod.default ?? (peMod as unknown as PuppeteerExtraLike));
    const stealthMod = (await import('puppeteer-extra-plugin-stealth')) as unknown as { default?: () => unknown };
    const Stealth = stealthMod.default ?? (stealthMod as unknown as () => unknown);
    puppeteer.use(Stealth());
    return (await puppeteer.launch(opts)) as unknown as BrowserLike;
  };
}
