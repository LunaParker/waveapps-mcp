import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_CHANNEL,
  WAVE_AUTH_COOKIE,
  WAVE_CSRF_COOKIE,
  WAVE_INVALIDATED_SENTINEL,
  browserProfileDir,
  extractWaveAuth,
  parseBusinessIdFromUrl,
  resolveBrowserLaunchTarget,
} from './browser.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('resolveBrowserLaunchTarget', () => {
  const ENV = 'WAVE_MCP_BROWSER_PATH';
  let prior: string | undefined;

  beforeEach(() => {
    prior = process.env[ENV];
    delete process.env[ENV];
  });

  afterEach(() => {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  });

  it('defaults to channel:chrome when no env override is set', () => {
    expect(resolveBrowserLaunchTarget()).toEqual({ kind: 'channel', channel: DEFAULT_BROWSER_CHANNEL });
  });

  it('returns the env path verbatim when WAVE_MCP_BROWSER_PATH points at an existing executable', () => {
    process.env[ENV] = '/path/to/brave';
    expect(resolveBrowserLaunchTarget({ existsFn: (p) => p === '/path/to/brave' })).toEqual({
      kind: 'executablePath',
      path: '/path/to/brave',
    });
  });

  it('returns null when WAVE_MCP_BROWSER_PATH is set but missing — does NOT silently fall back', () => {
    process.env[ENV] = '/no/such/brave';
    expect(resolveBrowserLaunchTarget({ existsFn: () => false })).toBeNull();
  });

  it('ignores an empty WAVE_MCP_BROWSER_PATH and falls back to channel:chrome', () => {
    process.env[ENV] = '';
    expect(resolveBrowserLaunchTarget()).toEqual({ kind: 'channel', channel: DEFAULT_BROWSER_CHANNEL });
  });
});

describe('browserProfileDir', () => {
  const ENV = 'WAVE_MCP_CONFIG_DIR';
  let prior: string | undefined;

  beforeEach(() => {
    prior = process.env[ENV];
    process.env[ENV] = '/tmp/wave-mcp-test';
  });

  afterEach(() => {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  });

  it('sits inside the config dir', () => {
    expect(browserProfileDir()).toBe('/tmp/wave-mcp-test/browser-profile');
  });
});

describe('parseBusinessIdFromUrl', () => {
  it('extracts the UUID from a next.waveapps.com path', () => {
    expect(parseBusinessIdFromUrl(`https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`)).toBe(BUSINESS_UUID);
  });

  it('extracts even without a trailing slash', () => {
    expect(parseBusinessIdFromUrl(`https://next.waveapps.com/${BUSINESS_UUID}`)).toBe(BUSINESS_UUID);
  });

  it('returns undefined for non-Wave URLs', () => {
    expect(parseBusinessIdFromUrl('https://example.com/abc')).toBeUndefined();
  });

  it('returns undefined when the path is not a UUID', () => {
    expect(parseBusinessIdFromUrl('https://next.waveapps.com/login/')).toBeUndefined();
  });

  it('returns undefined for null/empty URLs', () => {
    expect(parseBusinessIdFromUrl(null)).toBeUndefined();
    expect(parseBusinessIdFromUrl('')).toBeUndefined();
  });
});

describe('extractWaveAuth', () => {
  const cookies = (entries: Array<[string, string]>) => entries.map(([name, value]) => ({ name, value }));

  it('returns null when there is no waveapps cookie', () => {
    expect(extractWaveAuth(cookies([[WAVE_CSRF_COOKIE, 'csrf']]), null)).toBeNull();
  });

  it('returns null when waveapps is empty', () => {
    expect(extractWaveAuth(cookies([[WAVE_AUTH_COOKIE, '']]), null)).toBeNull();
  });

  it('returns null when waveapps is the invalidated sentinel', () => {
    expect(extractWaveAuth(cookies([[WAVE_AUTH_COOKIE, WAVE_INVALIDATED_SENTINEL]]), null)).toBeNull();
  });

  it('returns auth + csrf + businessId when everything is present', () => {
    const out = extractWaveAuth(
      cookies([
        [WAVE_AUTH_COOKIE, 'TOKEN'],
        [WAVE_CSRF_COOKIE, 'CSRF'],
      ]),
      `https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`,
    );
    expect(out).toEqual({
      authToken: 'TOKEN',
      csrfToken: 'CSRF',
      businessId: BUSINESS_UUID,
    });
  });

  it('csrf is undefined if not present (read-only sessions)', () => {
    const out = extractWaveAuth(cookies([[WAVE_AUTH_COOKIE, 'TOKEN']]), null);
    expect(out?.csrfToken).toBeUndefined();
  });

  it('businessId is undefined when URL has no UUID', () => {
    const out = extractWaveAuth(cookies([[WAVE_AUTH_COOKIE, 'TOKEN']]), 'https://my.waveapps.com/login/');
    expect(out?.businessId).toBeUndefined();
  });

  it('empty csrf string is treated as undefined', () => {
    const out = extractWaveAuth(
      cookies([
        [WAVE_AUTH_COOKIE, 'TOKEN'],
        [WAVE_CSRF_COOKIE, ''],
      ]),
      null,
    );
    expect(out?.csrfToken).toBeUndefined();
  });
});
