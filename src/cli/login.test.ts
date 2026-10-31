import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_EXIT_FAILURE,
  LOGIN_EXIT_NO_BROWSER,
  LOGIN_EXIT_OK,
  LOGIN_EXIT_TIMEOUT,
  runLogin,
  waitForAuth,
  type BrowserLike,
  type CookieLike,
  type PageLike,
} from './login.js';
import { WAVE_AUTH0_ENTRY_URL } from '../auth/browser.js';
import { readCredentials } from '../auth/credentials.js';
import { STEALTH_ARGS, STEALTH_IGNORE_DEFAULT_ARGS } from '../auth/playwright.js';
import { profileLockPath } from '../auth/profile-lock.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface ScriptedPage {
  page: PageLike;
  setCookies(c: CookieLike[]): void;
  setUrl(u: string): void;
  gotoCalls: string[];
}

function scriptedPage(initialCookies: CookieLike[] = []): ScriptedPage {
  let cookies = initialCookies;
  let url = 'about:blank';
  const gotoCalls: string[] = [];
  const page: PageLike = {
    goto: async (target) => {
      gotoCalls.push(target);
      url = target;
    },
    cookies: async () => cookies,
    url: () => url,
  };
  return {
    page,
    setCookies(c) {
      cookies = c;
    },
    setUrl(u) {
      url = u;
    },
    gotoCalls,
  };
}

function browserFor(page: PageLike): BrowserLike & { closed: boolean } {
  return {
    closed: false,
    async pages() {
      return [page];
    },
    async newPage() {
      return page;
    },
    async close() {
      this.closed = true;
    },
  };
}

const silent = { log: () => undefined, error: () => undefined };

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'wave-mcp-login-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmpHome;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('runLogin', () => {
  it('uses the global console + default deps when none are supplied', async () => {
    // Point WAVE_MCP_BROWSER_PATH at a missing file so the default resolver returns null
    // and we exit early without ever trying to launch a real browser.
    process.env['WAVE_MCP_BROWSER_PATH'] = '/definitely-no-browser-here';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const code = await runLogin();
      expect(code).toBe(LOGIN_EXIT_NO_BROWSER);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      delete process.env['WAVE_MCP_BROWSER_PATH'];
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('returns NO_BROWSER when the target resolver returns null', async () => {
    const code = await runLogin({
      resolveTarget: () => null,
      launch: vi.fn(),
      console: silent,
      delay: () => Promise.resolve(),
    });
    expect(code).toBe(LOGIN_EXIT_NO_BROWSER);
  });

  it("sends the browser to Wave's Auth0 sign-in and saves the captured cookies", async () => {
    const sp = scriptedPage();
    sp.page.cookies = async () => {
      sp.setUrl(`https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`);
      return [
        { name: 'waveapps', value: 'FAKE_TOKEN_FOR_TEST' },
        { name: 'identity-csrftoken', value: 'CSRFTOKEN' },
      ];
    };
    const browser = browserFor(sp.page);
    const launch = vi.fn(async () => browser as unknown as BrowserLike);
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch,
      console: silent,
      delay: () => Promise.resolve(),
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 5_000,
    });
    expect(code).toBe(LOGIN_EXIT_OK);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(sp.gotoCalls).toEqual([WAVE_AUTH0_ENTRY_URL]);

    const stored = readCredentials();
    expect(stored?.authToken).toBe('FAKE_TOKEN_FOR_TEST');
    expect(stored?.csrfToken).toBe('CSRFTOKEN');
    expect(stored?.businessId).toBe(BUSINESS_UUID);
    expect(browser.closed).toBe(true);
  });

  it('names the WAVE_MCP_BROWSER_PATH browser it launches', async () => {
    const sp = scriptedPage();
    sp.page.cookies = async () => {
      sp.setUrl(`https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`);
      return [{ name: 'waveapps', value: 'tok' }];
    };
    const logs: string[] = [];
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'executablePath', path: '/path/to/brave' }),
      launch: async () => browserFor(sp.page),
      console: { log: (m: string) => void logs.push(m), error: () => undefined },
      delay: () => Promise.resolve(),
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 5_000,
    });
    expect(code).toBe(LOGIN_EXIT_OK);
    expect(logs[0]).toContain('/path/to/brave');
  });

  it('returns FAILURE without launching when another sign-in holds the profile lock', async () => {
    mkdirSync(profileLockPath());
    const launch = vi.fn();
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch,
      console: silent,
      delay: () => Promise.resolve(),
      lockWaitMs: 0,
    });
    expect(code).toBe(LOGIN_EXIT_FAILURE);
    expect(launch).not.toHaveBeenCalled();
  });

  it('returns TIMEOUT when the cookies never settle', async () => {
    const sp = scriptedPage([]);
    sp.page.cookies = async () => [{ name: 'waveapps', value: 'invalidated' }];
    const browser = browserFor(sp.page);
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch: async () => browser as unknown as BrowserLike,
      console: silent,
      delay: () => Promise.resolve(),
      pollIntervalMs: 0,
      stabilityMs: 1_000,
      timeoutMs: 50,
    });
    expect(code).toBe(LOGIN_EXIT_TIMEOUT);
    expect(browser.closed).toBe(true);
    expect(readCredentials()).toBeNull();
  });

  it('returns FAILURE when launch throws', async () => {
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch: async () => {
        throw new Error('cannot exec');
      },
      console: silent,
      delay: () => Promise.resolve(),
    });
    expect(code).toBe(LOGIN_EXIT_FAILURE);
  });

  it('opens a new page when the browser starts with none', async () => {
    const sp = scriptedPage();
    sp.page.cookies = async () => {
      sp.setUrl(`https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`);
      return [
        { name: 'waveapps', value: 'tok' },
        { name: 'identity-csrftoken', value: 'csrf' },
      ];
    };
    const browser: BrowserLike = {
      pages: async () => [],
      newPage: async () => sp.page,
      close: async () => undefined,
    };
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch: async () => browser,
      console: silent,
      delay: () => Promise.resolve(),
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 1_000,
    });
    expect(code).toBe(LOGIN_EXIT_OK);
  });

  it('swallows a close() error after a successful login', async () => {
    const sp = scriptedPage();
    sp.page.cookies = async () => {
      sp.setUrl(`https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`);
      return [
        { name: 'waveapps', value: 'tok' },
        { name: 'identity-csrftoken', value: 'csrf' },
      ];
    };
    const browser: BrowserLike = {
      pages: async () => [sp.page],
      newPage: async () => sp.page,
      close: async () => {
        throw new Error('already closed');
      },
    };
    const code = await runLogin({
      resolveTarget: () => ({ kind: 'bundled' }),
      launch: async () => browser,
      console: silent,
      delay: () => Promise.resolve(),
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 1_000,
    });
    expect(code).toBe(LOGIN_EXIT_OK);
  });
});

describe('STEALTH constants', () => {
  it('strips --enable-automation so Cloudflare does not flag us', () => {
    expect(STEALTH_IGNORE_DEFAULT_ARGS).toContain('--enable-automation');
  });

  it('disables the AutomationControlled blink feature', () => {
    expect(STEALTH_ARGS).toContain('--disable-blink-features=AutomationControlled');
  });
});

describe('waitForAuth', () => {
  it('requires the token to stay stable for stabilityMs', async () => {
    const cookieSequence: CookieLike[][] = [
      [{ name: 'waveapps', value: 'invalidated' }],
      [{ name: 'waveapps', value: 'TOKEN_A' }],
      [{ name: 'waveapps', value: 'TOKEN_A' }],
      [{ name: 'waveapps', value: 'TOKEN_A' }],
    ];
    let i = 0;
    let now = 0;
    const realDateNow = Date.now;
    Date.now = () => now;
    try {
      const page: PageLike = {
        goto: async () => undefined,
        cookies: async () => cookieSequence[i++] ?? cookieSequence.at(-1)!,
        url: () => `https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`,
      };
      const out = await waitForAuth(page, {
        timeoutMs: 10_000,
        pollIntervalMs: 100,
        stabilityMs: 2_000,
        delay: async (_ms) => {
          now += 1_000;
        },
      });
      expect(out?.authToken).toBe('TOKEN_A');
    } finally {
      Date.now = realDateNow;
    }
  });

  it('resets the stability window when the token changes', async () => {
    const cookieSequence: CookieLike[][] = [
      [{ name: 'waveapps', value: 'TOKEN_A' }],
      [{ name: 'waveapps', value: 'TOKEN_B' }],
      [{ name: 'waveapps', value: 'TOKEN_B' }],
      [{ name: 'waveapps', value: 'TOKEN_B' }],
    ];
    let i = 0;
    let now = 0;
    const realDateNow = Date.now;
    Date.now = () => now;
    try {
      const page: PageLike = {
        goto: async () => undefined,
        cookies: async () => cookieSequence[i++] ?? cookieSequence.at(-1)!,
        url: () => null as unknown as string,
      };
      const out = await waitForAuth(page, {
        timeoutMs: 10_000,
        pollIntervalMs: 100,
        stabilityMs: 1_500,
        delay: async (_ms) => {
          now += 1_000;
        },
      });
      expect(out?.authToken).toBe('TOKEN_B');
    } finally {
      Date.now = realDateNow;
    }
  });

  it('treats cookie() failures as no-auth and keeps polling', async () => {
    let attempt = 0;
    const page: PageLike = {
      goto: async () => undefined,
      cookies: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('disconnected');
        return [{ name: 'waveapps', value: 'TOK' }];
      },
      url: () => `https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`,
    };
    const out = await waitForAuth(page, {
      timeoutMs: 1_000,
      pollIntervalMs: 0,
      stabilityMs: 0,
      delay: () => Promise.resolve(),
    });
    expect(out?.authToken).toBe('TOK');
    expect(attempt).toBeGreaterThanOrEqual(2);
  });
});
