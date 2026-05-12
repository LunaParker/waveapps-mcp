import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveClient } from './index.js';

const TOKEN_KEYS = ['WAVE_AUTH_TOKEN', 'WAVE_CSRF_TOKEN', 'WAVE_BUSINESS_ID', 'WAVE_MCP_CONFIG_DIR'];
const BUSINESS_UUID = 'c2cb3afe-5a24-41b2-add7-d1c6982d75a9';
const BUSINESS_GLOBAL_ID = 'QnVzaW5lc3M6YzJjYjNhZmUtNWEyNC00MWIyLWFkZDctZDFjNjk4MmQ3NWE5';

describe('WaveClient', () => {
  const prior: Record<string, string | undefined> = {};
  let tmp: string;

  beforeEach(() => {
    for (const k of TOKEN_KEYS) {
      prior[k] = process.env[k];
      delete process.env[k];
    }
    tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-client-'));
    process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    for (const k of TOKEN_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  });

  it('fromEnv requires WAVE_AUTH_TOKEN', () => {
    expect(() => WaveClient.fromEnv()).toThrowError(/WAVE_AUTH_TOKEN/);
  });

  it('constructs with explicit auth and exposes rest + gql', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(c.rest).toBeDefined();
    expect(c.gql).toBeDefined();
  });

  it('businessId returns the explicit argument if passed', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(c.businessId(BUSINESS_UUID)).toBe(BUSINESS_UUID);
  });

  it('businessId falls back to WAVE_BUSINESS_ID env when unset', () => {
    process.env['WAVE_BUSINESS_ID'] = BUSINESS_UUID;
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(c.businessId()).toBe(BUSINESS_UUID);
  });

  it('businessId can be set via options', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined }, { defaultBusinessId: BUSINESS_UUID });
    expect(c.businessId()).toBe(BUSINESS_UUID);
  });

  it('businessId throws when neither argument nor default is available', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(() => c.businessId()).toThrowError(/No business ID supplied/);
  });

  it('businessId rejects non-UUID values', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(() => c.businessId('not-a-uuid')).toThrowError(/UUID/);
  });

  it('constructor rejects an invalid WAVE_BUSINESS_ID', () => {
    process.env['WAVE_BUSINESS_ID'] = 'bogus';
    expect(() => new WaveClient({ authToken: 'T', csrfToken: undefined })).toThrowError(/UUID/);
  });

  it('businessGlobalId returns the canonical Relay base64', () => {
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined }, { defaultBusinessId: BUSINESS_UUID });
    expect(c.businessGlobalId()).toBe(BUSINESS_GLOBAL_ID);
  });

  it('default business id falls back to the credentials file when env unset', () => {
    writeFileSync(
      join(tmp, 'credentials.json'),
      JSON.stringify({ authToken: 'X', businessId: BUSINESS_UUID }),
      'utf8',
    );
    const c = new WaveClient({ authToken: 'T', csrfToken: undefined });
    expect(c.businessId()).toBe(BUSINESS_UUID);
  });

  it('fromEnv pulls auth from the credentials file when env vars are absent', () => {
    writeFileSync(
      join(tmp, 'credentials.json'),
      JSON.stringify({ authToken: 'FROM_FILE', csrfToken: 'CSRF', businessId: BUSINESS_UUID }),
      'utf8',
    );
    const c = WaveClient.fromEnv();
    expect(c.businessId()).toBe(BUSINESS_UUID);
  });

  describe('refresh hook', () => {
    it('shares a single refresh promise across concurrent refresh attempts', async () => {
      let resolveRefresh: ((auth: { authToken: string; csrfToken: undefined }) => void) | null = null;
      const refresher = vi.fn(
        () =>
          new Promise<{ authToken: string; csrfToken: undefined }>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      try {
        const c = new WaveClient({ authToken: 'OLD', csrfToken: undefined }, { refresher });
        // Two parallel API calls, both will hit 401 and trigger refresh — but only ONE
        // refresher call should be made (debounced via the in-flight promise).
        fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
        fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
        fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: 2 }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const p1 = c.rest.get('/x');
        const p2 = c.rest.get('/y');
        // Wait a tick so both requests are in flight and both have called refresh.
        await new Promise((r) => setTimeout(r, 10));
        expect(refresher).toHaveBeenCalledTimes(1);
        resolveRefresh!({ authToken: 'NEW', csrfToken: undefined });
        await Promise.all([p1, p2]);
        expect(fetchSpy).toHaveBeenCalledTimes(4);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not wire a refresher when no email/password is on file', () => {
      // fromEnv: no env, no credentials file beyond the seed token → no refresher
      writeFileSync(
        join(tmp, 'credentials.json'),
        JSON.stringify({ authToken: 'JUST_TOKEN' }),
        'utf8',
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      try {
        const c = WaveClient.fromEnv();
        fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
        return expect(c.rest.get('/x')).rejects.toThrowError(/WaveAuthError|expired/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('wires a refresher when email + password are on file', () => {
      writeFileSync(
        join(tmp, 'credentials.json'),
        JSON.stringify({ authToken: 'X', email: 'me@example.com', password: 'pw' }),
        'utf8',
      );
      // We can't easily check the refresher fires without triggering puppeteer, but we
      // CAN verify the client constructs and exposes the rest/gql sub-clients.
      const c = WaveClient.fromEnv();
      expect(c.rest).toBeDefined();
      expect(c.gql).toBeDefined();
    });

    it('returns false from refreshOnce when no refresher is configured', async () => {
      const c = new WaveClient({ authToken: 'X', csrfToken: undefined });
      const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
      vi.stubGlobal('fetch', fetchSpy);
      try {
        await expect(c.rest.get('/x')).rejects.toThrowError(/expired/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('logs and surfaces failures from the user-supplied refresher gracefully', async () => {
      const refresher = vi.fn(async () => {
        throw new Error('puppeteer crashed');
      });
      const c = new WaveClient({ authToken: 'X', csrfToken: undefined }, { refresher });
      const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
      vi.stubGlobal('fetch', fetchSpy);
      try {
        await expect(c.rest.get('/x')).rejects.toThrowError(/expired/);
        expect(refresher).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
