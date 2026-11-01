import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCredentials } from '../auth/credentials.js';
import { memorySecretStore } from '../auth/secrets.js';
import { runLogout } from './logout.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-logout-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

describe('runLogout', () => {
  it('removes the credentials file when present', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined, email: undefined });
    const log = vi.fn();
    expect(runLogout({ console: { log } })).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Removed'));
  });

  it('also removes the password and TOTP secret from the credential store', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined, email: undefined });
    const store = memorySecretStore({ password: 'pw', 'totp-secret': 'JBSWY3DPEHPK3PXP' });
    const log = vi.fn();
    expect(runLogout({ console: { log }, store })).toBe(0);
    expect(store.get('password')).toBeNull();
    expect(store.get('totp-secret')).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('password and totp-secret'));
  });

  it('is a no-op when no file exists', () => {
    const log = vi.fn();
    expect(runLogout({ console: { log } })).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No credentials file'));
  });

  it('uses the global console when no override is supplied', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(runLogout()).toBe(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
