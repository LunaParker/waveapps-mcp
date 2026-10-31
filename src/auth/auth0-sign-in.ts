import type { BrowserContext, Page } from 'playwright';
import { WAVE_AUTH0_ENTRY_URL, WAVE_AUTH_COOKIE, WAVE_INVALIDATED_SENTINEL, parseBusinessIdFromUrl } from './browser.js';

/**
 * Thrown when Wave or Cloudflare puts something in front of the sign-in that only a person
 * should answer (a visible hCaptcha, a Cloudflare block page). Never solved automatically.
 */
export class SignInChallengeError extends Error {
  constructor(detail: string) {
    super(
      `Automatic Wave sign-in stopped: ${detail}. Run \`npx waveapps-mcp login\` in a terminal ` +
        'and sign in in the window it opens.',
    );
    this.name = 'SignInChallengeError';
  }
}

/** What one poll of the sign-in tab can see. Built from the live page; pure so it can be tested. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** A real (non-sentinel) `waveapps` cookie is set. */
  hasWaveCookie: boolean;
  usernameVisible: boolean;
  passwordVisible: boolean;
  otpVisible: boolean;
  challengeVisible: boolean;
  errorText: string | null;
}

export type SignInStep =
  | 'signed-in'
  | 'blocked'
  | 'challenge'
  | 'error'
  | 'otp'
  | 'password'
  | 'identifier'
  | 'waiting';

export function classifyPage(s: PageSnapshot): SignInStep {
  if (/Wave Maintenance/i.test(s.title)) return 'blocked';
  if (s.challengeVisible) return 'challenge';
  if (s.hasWaveCookie && parseBusinessIdFromUrl(s.url)) return 'signed-in';
  if (s.errorText) return 'error';
  if (s.otpVisible) return 'otp';
  if (s.passwordVisible) return 'password';
  if (s.usernameVisible) return 'identifier';
  return 'waiting';
}

export interface AutomatedSignInInput {
  email: string;
  password: string;
  /** Current TOTP code, or null when no secret is stored. */
  generateTotp: () => string | null;
  /** Milliseconds left in the current 30-second TOTP window. */
  totpMsRemaining?: () => number;
  timeoutMs?: number;
}

const SELECTORS = {
  username: 'input[name="username"]',
  password: 'input[name="password"], input[type="password"]',
  otpFirst: 'input[aria-label="verification-code-input-0"]',
  trustDevice: 'form input[type="checkbox"]',
  // Visible hCaptcha / Turnstile / Auth0 captcha widgets. Invisible hCaptcha stays zero-size.
  challenge: [
    'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
    'iframe[src*="hcaptcha.com"][src*="frame=checkbox"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '[data-captcha-provider]',
    '.ulp-captcha',
  ].join(', '),
  error: '[role="alert"], [id^="error-element"], .ulp-input-error-message',
} as const;

const SUBMIT_NAME = /^(continue|log in|sign in|submit|verify)$/i;
const TRUST_LABEL = /don.t ask me for a code on this device/i;

/**
 * Walk Wave's Auth0 sign-in in an already-launched context: email, password, then Wave's
 * own 2FA page, ticking "don't ask on this device". Returns once a `waveapps` cookie exists.
 */
export async function runAutomatedSignIn(
  ctx: BrowserContext,
  input: AutomatedSignInInput,
): Promise<{ cookies: Array<{ name: string; value: string }>; url: string }> {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  const done = { identifier: false, password: false };
  const triedCodes = new Set<string>();

  // An expired token left in the profile must not pass for a fresh one.
  await ctx.clearCookies({ name: WAVE_AUTH_COOKIE });
  await page.goto(WAVE_AUTH0_ENTRY_URL, { waitUntil: 'domcontentloaded' });
  while (Date.now() < deadline) {
    const snap = await snapshot(ctx, page);
    switch (classifyPage(snap)) {
      case 'signed-in':
        return { cookies: await ctx.cookies('https://next.waveapps.com'), url: page.url() };
      case 'blocked':
        throw new SignInChallengeError('Cloudflare blocked the sign-in page');
      case 'challenge':
        throw new SignInChallengeError('Wave showed a CAPTCHA challenge');
      case 'error':
        throw new Error(`Wave rejected the sign-in: ${snap.errorText}`);
      case 'identifier':
      case 'password':
        // Auth0 asks for the email, then the password; the older Django form asks for both at once.
        if (!done.identifier && snap.usernameVisible) {
          await page.fill(SELECTORS.username, input.email);
          if (snap.passwordVisible) {
            await page.fill(SELECTORS.password, input.password);
            done.password = true;
          }
          await submit(page);
          done.identifier = true;
        } else if (!done.password && snap.passwordVisible) {
          await page.fill(SELECTORS.password, input.password);
          await submit(page);
          done.password = true;
        }
        break;
      case 'otp': {
        if ((input.totpMsRemaining?.() ?? 30_000) < 5_000) break; // let a fresh code roll over
        const code = input.generateTotp();
        if (code === null) {
          throw new SignInChallengeError('Wave asked for a 2FA code and no TOTP secret is stored');
        }
        if (triedCodes.has(code)) break;
        if (triedCodes.size >= 2) throw new Error('Wave rejected two 2FA codes in a row. Check the stored TOTP secret.');
        triedCodes.add(code);
        await enterTotp(page, code);
        break;
      }
      case 'waiting':
        break;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Automatic Wave sign-in timed out on ${page.url().replace(/[?#].*/, '')}.`);
}

async function snapshot(ctx: BrowserContext, page: Page): Promise<PageSnapshot> {
  const cookie = (await ctx.cookies('https://next.waveapps.com')).find((c) => c.name === WAVE_AUTH_COOKIE)?.value;
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    hasWaveCookie: Boolean(cookie) && cookie !== WAVE_INVALIDATED_SENTINEL,
    usernameVisible: await isVisible(page, SELECTORS.username),
    passwordVisible: await isVisible(page, SELECTORS.password),
    otpVisible: await isVisible(page, SELECTORS.otpFirst),
    challengeVisible: await isVisible(page, SELECTORS.challenge),
    errorText: await firstVisibleText(page, SELECTORS.error),
  };
}

async function enterTotp(page: Page, code: string): Promise<void> {
  await trustThisDevice(page);
  // Typing last leaves focus in the code boxes, so Enter submits if the button isn't found.
  await page.click(SELECTORS.otpFirst);
  await page.keyboard.type(code, { delay: 60 });
  await submit(page);
}

/** Tick "Don't ask me for a code on this device for 30 days". Best effort: sign-in works without it. */
async function trustThisDevice(page: Page): Promise<void> {
  try {
    const box = page.locator(SELECTORS.trustDevice).first();
    if ((await box.count()) === 0 || (await box.isChecked())) return;
    await box.check({ force: true, timeout: 3_000 }).catch(() => page.getByText(TRUST_LABEL).first().click({ timeout: 3_000 }));
  } catch {
    /* fall through to an untrusted sign-in */
  }
}

/** Click the form's primary submit button, never a "Sign in with Google/Apple" one. */
async function submit(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: SUBMIT_NAME }).first();
  if ((await button.count()) > 0 && (await button.isEnabled())) await button.click();
  else await page.keyboard.press('Enter');
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  const all = page.locator(selector);
  const n = await all.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    if (await all.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function firstVisibleText(page: Page, selector: string): Promise<string | null> {
  const all = page.locator(selector);
  const n = await all.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    const el = all.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = (await el.innerText().catch(() => '')).trim();
    if (text) return text.slice(0, 200);
  }
  return null;
}
