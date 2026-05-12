import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFromEnv, authHeaders, loadAuth, type WaveAuth } from './auth.js';

describe('authHeaders', () => {
  const auth: WaveAuth = { authToken: 'TOKEN123', csrfToken: 'CSRF456' };

  it('builds a Bearer header on every request', () => {
    expect(authHeaders(auth).Authorization).toBe('Bearer TOKEN123');
  });

  it('sets Accept: application/json', () => {
    expect(authHeaders(auth).Accept).toBe('application/json');
  });

  it('omits x-csrftoken on reads by default', () => {
    expect(authHeaders(auth)['x-csrftoken']).toBeUndefined();
  });

  it('adds x-csrftoken when mutating=true', () => {
    expect(authHeaders(auth, true)['x-csrftoken']).toBe('CSRF456');
  });

  it('throws when mutating without a CSRF token configured', () => {
    expect(() => authHeaders({ authToken: 'TOKEN', csrfToken: undefined }, true)).toThrowError(
      /WAVE_CSRF_TOKEN/,
    );
  });

  it('allows reads even without CSRF', () => {
    expect(() => authHeaders({ authToken: 'TOKEN', csrfToken: undefined }, false)).not.toThrow();
  });
});

describe('loadAuth (env precedence)', () => {
  const keys = ['WAVE_AUTH_TOKEN', 'WAVE_CSRF_TOKEN', 'WAVE_MCP_CONFIG_DIR'];
  const prior: Record<string, string | undefined> = {};
  let tmp: string;

  beforeEach(() => {
    for (const k of keys) {
      prior[k] = process.env[k];
      delete process.env[k];
    }
    tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-auth-'));
    process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  });

  it('reads WAVE_AUTH_TOKEN', () => {
    process.env['WAVE_AUTH_TOKEN'] = 'abc';
    expect(loadAuth()).toEqual({ authToken: 'abc', csrfToken: undefined });
  });

  it('reads WAVE_CSRF_TOKEN when present', () => {
    process.env['WAVE_AUTH_TOKEN'] = 'abc';
    process.env['WAVE_CSRF_TOKEN'] = 'def';
    expect(loadAuth()).toEqual({ authToken: 'abc', csrfToken: 'def' });
  });

  it('throws with a helpful message when neither env nor file is set', () => {
    expect(() => loadAuth()).toThrowError(/npx waveapps-mcp login/);
  });

  it('falls back to the credentials file when env is unset', () => {
    writeFileSync(
      join(tmp, 'credentials.json'),
      JSON.stringify({ authToken: 'FROM_FILE', csrfToken: 'FILE_CSRF' }),
      'utf8',
    );
    expect(loadAuth()).toEqual({ authToken: 'FROM_FILE', csrfToken: 'FILE_CSRF' });
  });

  it('env beats the credentials file when both exist', () => {
    writeFileSync(
      join(tmp, 'credentials.json'),
      JSON.stringify({ authToken: 'FROM_FILE' }),
      'utf8',
    );
    process.env['WAVE_AUTH_TOKEN'] = 'FROM_ENV';
    expect(loadAuth()).toEqual({ authToken: 'FROM_ENV', csrfToken: undefined });
  });

  it('exposes a back-compat authFromEnv alias', () => {
    expect(authFromEnv).toBe(loadAuth);
  });
});
