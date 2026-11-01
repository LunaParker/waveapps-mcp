import { mkdirSync } from 'node:fs';
import type { BrowserContext, BrowserType, LaunchOptions } from 'playwright';
import { browserProfileDir, resolveBrowserLaunchTarget } from './browser.js';

/**
 * Blink flags that stop the page from seeing an automated browser. Cloudflare in front of
 * Wave's sign-in pages reads `navigator.webdriver` and the `--enable-automation` infobar.
 */
export const STEALTH_ARGS = Object.freeze([
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
]);
export const STEALTH_IGNORE_DEFAULT_ARGS = Object.freeze(['--enable-automation']);

export interface LaunchWaveBrowserOptions {
  headless: boolean;
  /** Defaults to the shared sign-in profile. */
  profileDir?: string;
}

/**
 * Launch a persistent Chromium context Cloudflare will let through. Headless runs use the
 * full browser's new headless mode (Playwright's stripped headless shell gets a 403) and
 * drop the `HeadlessChrome` token from the user agent, which Cloudflare also blocks on.
 */
export async function launchWaveBrowser(opts: LaunchWaveBrowserOptions): Promise<BrowserContext> {
  const target = resolveBrowserLaunchTarget();
  if (!target) {
    throw new Error(
      'WAVE_MCP_BROWSER_PATH is set but the path does not exist (or is not executable). ' +
        'Point it at a Chromium-based browser, or unset it to use Playwright\'s Chromium.',
    );
  }
  const { chromium } = await import('playwright');
  const base: LaunchOptions = {
    headless: opts.headless,
    args: [...STEALTH_ARGS],
    ignoreDefaultArgs: [...STEALTH_IGNORE_DEFAULT_ARGS],
    ...(target.kind === 'executablePath'
      ? { executablePath: target.path }
      : opts.headless
        ? { channel: 'chromium' }
        : {}),
  };
  const profileDir = opts.profileDir ?? browserProfileDir();
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  try {
    const userAgent = opts.headless ? await headfulUserAgent(chromium, base) : undefined;
    return await chromium.launchPersistentContext(profileDir, {
      ...base,
      viewport: opts.headless ? { width: 1280, height: 900 } : null,
      ...(userAgent ? { userAgent } : {}),
    });
  } catch (err) {
    throw explainLaunchError(err);
  }
}

/** The browser's own user agent with `HeadlessChrome` swapped for `Chrome`, so the OS token stays real. */
async function headfulUserAgent(chromium: BrowserType, base: LaunchOptions): Promise<string> {
  const browser = await chromium.launch(base);
  try {
    const page = await browser.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    return ua.replace('HeadlessChrome/', 'Chrome/');
  } finally {
    await browser.close();
  }
}

export function explainLaunchError(err: unknown): Error {
  const message = (err as Error)?.message ?? String(err);
  if (/Executable doesn't exist|browserType\.launch.*install/i.test(message)) {
    return new Error("Playwright's Chromium isn't installed. Run: npx playwright install chromium");
  }
  if (/ProcessSingleton|SingletonLock|profile.*in use/i.test(message)) {
    return new Error(`The sign-in browser profile at ${browserProfileDir()} is in use by another Chromium window. Close it and retry.`);
  }
  return err instanceof Error ? err : new Error(message);
}
