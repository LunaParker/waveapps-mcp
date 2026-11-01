import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configDir,
  credentialsAgeSeconds,
  credentialsPath,
  deleteCredentials,
  migrateLegacySecrets,
  patchCredentials,
  readCredentials,
  writeCredentials,
} from './credentials.js';
import { memorySecretStore } from './secrets.js';

let tmp: string;
const ENV_KEY = 'WAVE_MCP_CONFIG_DIR';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'waveapps-mcp-test-'));
  process.env[ENV_KEY] = tmp;
});

afterEach(() => {
  delete process.env[ENV_KEY];
  rmSync(tmp, { recursive: true, force: true });
});

describe('configDir / credentialsPath', () => {
  it('honours WAVE_MCP_CONFIG_DIR', () => {
    expect(configDir()).toBe(tmp);
    expect(credentialsPath()).toBe(join(tmp, 'credentials.json'));
  });

  it('falls back to ~/.config/waveapps-mcp when env unset', () => {
    delete process.env[ENV_KEY];
    expect(configDir()).toMatch(/\.config\/waveapps-mcp$/);
  });
});

describe('writeCredentials / readCredentials', () => {
  it('round-trips authToken + csrfToken + businessId', () => {
    const stored = writeCredentials({
      authToken: 'TOKEN',
      csrfToken: 'CSRF',
      businessId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: undefined,
    });
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readCredentials()).toEqual(stored);
  });

  it('round-trips email', () => {
    writeCredentials({
      authToken: 'T',
      csrfToken: undefined,
      businessId: undefined,
      email: 'me@example.com',
    });
    expect(readCredentials()?.email).toBe('me@example.com');
  });

  it('never surfaces legacy plaintext secrets through readCredentials', () => {
    writeFileSync(credentialsPath(), JSON.stringify({ authToken: 'X', password: 'hunter2', totpSecret: 'JBSWY3DPEE' }), 'utf8');
    const out = readCredentials() as unknown as Record<string, unknown>;
    expect(out['password']).toBeUndefined();
    expect(out['totpSecret']).toBeUndefined();
  });

  it('reads old credential files (pre-new-fields) without errors', () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ authToken: 'X', csrfToken: 'Y', businessId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      'utf8',
    );
    expect(readCredentials()).toMatchObject({
      authToken: 'X',
      email: undefined,
    });
  });

  it('writes the file with 0600 permissions', () => {
    writeCredentials({ authToken: 'TOKEN', csrfToken: undefined, businessId: undefined, email: undefined });
    const mode = statSync(credentialsPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null when the file does not exist', () => {
    expect(readCredentials()).toBeNull();
  });

  it('returns null when authToken is missing from the file', () => {
    writeFileSync(credentialsPath(), JSON.stringify({ csrfToken: 'just-csrf' }), 'utf8');
    expect(readCredentials()).toBeNull();
  });

  it('throws on JSON parse errors with a helpful path', () => {
    writeFileSync(credentialsPath(), '{ not valid json', 'utf8');
    expect(() => readCredentials()).toThrowError(/Failed to read Wave credentials/);
  });

  it('handles optional fields when stored values are missing/wrong types', () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ authToken: 'X', csrfToken: 123, updatedAt: null }),
      'utf8',
    );
    expect(readCredentials()).toEqual({
      authToken: 'X',
      csrfToken: undefined,
      businessId: undefined,
      email: undefined,
      updatedAt: '',
    });
  });
});

describe('patchCredentials', () => {
  it('merges new fields into an existing file', () => {
    writeCredentials({
      authToken: 'TOKEN',
      csrfToken: 'CSRF',
      businessId: undefined,
      email: undefined,
    });
    const updated = patchCredentials({ email: 'me@example.com' });
    expect(updated.authToken).toBe('TOKEN');
    expect(updated.csrfToken).toBe('CSRF');
    expect(updated.email).toBe('me@example.com');
  });

  it('throws when no auth token exists and none is provided', () => {
    expect(() => patchCredentials({ email: 'me@example.com' })).toThrowError(/login/);
  });
});

describe('migrateLegacySecrets', () => {
  it('moves a plaintext password and TOTP secret into the store and scrubs the file', () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ authToken: 'X', email: 'me@example.com', password: 'hunter2', totpSecret: 'JBSWY3DPEE', updatedAt: 'then' }),
      'utf8',
    );
    const store = memorySecretStore();
    expect(migrateLegacySecrets(store)).toEqual(['password', 'totp-secret']);
    expect(store.get('password')).toBe('hunter2');
    expect(store.get('totp-secret')).toBe('JBSWY3DPEE');
    const raw = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Record<string, unknown>;
    expect(raw).toEqual({ authToken: 'X', email: 'me@example.com', updatedAt: 'then' });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  it('is a no-op when the file holds no secrets', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined, email: undefined });
    const before = readFileSync(credentialsPath(), 'utf8');
    expect(migrateLegacySecrets(memorySecretStore())).toEqual([]);
    expect(readFileSync(credentialsPath(), 'utf8')).toBe(before);
  });

  it('is a no-op when there is no file', () => {
    expect(migrateLegacySecrets(memorySecretStore())).toEqual([]);
  });

  it('leaves the file untouched when the store rejects a write', () => {
    writeFileSync(credentialsPath(), JSON.stringify({ authToken: 'X', password: 'hunter2' }), 'utf8');
    const before = readFileSync(credentialsPath(), 'utf8');
    const failing = { ...memorySecretStore(), set: (): void => { throw new Error('keychain locked'); } };
    expect(() => migrateLegacySecrets(failing)).toThrowError(/keychain locked/);
    expect(readFileSync(credentialsPath(), 'utf8')).toBe(before);
  });
});

describe('deleteCredentials', () => {
  it('returns true when a file existed and was removed', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined });
    expect(deleteCredentials()).toBe(true);
    expect(readCredentials()).toBeNull();
  });

  it('returns false when there was nothing to delete', () => {
    expect(deleteCredentials()).toBe(false);
  });

  it('rethrows non-ENOENT errors from rm', () => {
    // Make the config dir non-writable so rm fails with EACCES (skip on Windows).
    if (process.platform === 'win32') return;
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined });
    const dir = tmp;
    const restore = (): void => {
      try {
        require('node:fs').chmodSync(dir, 0o700);
      } catch {
        /* ignore */
      }
    };
    require('node:fs').chmodSync(dir, 0o500); // read+exec only
    try {
      expect(() => deleteCredentials()).toThrow();
    } finally {
      restore();
    }
  });
});

describe('credentialsAgeSeconds', () => {
  it('returns a small number for a freshly-written file', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined });
    const age = credentialsAgeSeconds();
    // filesystem mtime resolution + clock skew can put this within ~1s either way of zero.
    expect(age).not.toBeNull();
    expect(Math.abs(age!)).toBeLessThan(5);
  });

  it('returns null when the file is missing', () => {
    expect(credentialsAgeSeconds()).toBeNull();
  });
});
