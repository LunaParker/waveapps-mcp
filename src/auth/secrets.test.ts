import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileSecretStore, memorySecretStore, SECRET_FILE_VARS, secretStoreFromEnv } from './secrets.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wave-mcp-secrets-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function secretFile(name: string, content: string, mode = 0o600): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

describe('secretStoreFromEnv', () => {
  it('uses the OS credential store when no file variable is set', () => {
    const keyring = memorySecretStore();
    expect(secretStoreFromEnv({}, () => keyring)).toBe(keyring);
  });

  it('uses the file store when either file variable is set, without loading the keyring', () => {
    const keyring = vi.fn(() => memorySecretStore());
    const store = secretStoreFromEnv({ WAVE_PASSWORD_FILE: secretFile('password', 'TEST_password_value\n') }, keyring);
    expect(keyring).not.toHaveBeenCalled();
    expect(store.readOnly).toBe(true);
    expect(store.get('password')).toBe('TEST_password_value');
    expect(store.get('totp-secret')).toBeNull();
  });
});

describe('fileSecretStore', () => {
  it('reads the file on every get, so a rotated secret takes effect', () => {
    const path = secretFile('password', 'TEST_password_one\n');
    const store = fileSecretStore({ password: path });
    expect(store.get('password')).toBe('TEST_password_one');
    writeFileSync(path, 'TEST_password_two\n');
    expect(store.get('password')).toBe('TEST_password_two');
  });

  it('treats an empty file as no secret', () => {
    expect(fileSecretStore({ 'totp-secret': secretFile('totp', '\n') }).get('totp-secret')).toBeNull();
  });

  it('names the variable and path when a file cannot be read', () => {
    const missing = join(dir, 'missing');
    expect(() => fileSecretStore({ password: missing }).get('password')).toThrow(`Could not read WAVE_PASSWORD_FILE (${missing})`);
  });

  it('warns once, without the value, when a secret file is readable by other users', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const store = fileSecretStore({ password: secretFile('password', 'TEST_password_value', 0o644) });
    store.get('password');
    store.get('password');
    const warnings = write.mock.calls.map(([chunk]) => String(chunk)).filter((line) => line.includes('readable by other users'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('TEST_password_value');
  });

  it('stays quiet for a 0600 file', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fileSecretStore({ password: secretFile('password', 'TEST_password_value') }).get('password');
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses to write or delete, naming the variable to edit', () => {
    const store = fileSecretStore({ password: secretFile('password', 'TEST_password_value') });
    expect(() => store.set('password', 'TEST_other')).toThrow(/WAVE_PASSWORD_FILE/);
    expect(() => store.delete('totp-secret')).toThrow(/WAVE_TOTP_SECRET_FILE/);
  });

  it('reports where each secret comes from', () => {
    const store = fileSecretStore({});
    expect(store.source?.('password')).toBe('from WAVE_PASSWORD_FILE');
    expect(store.source?.('totp-secret')).toBe(`from ${SECRET_FILE_VARS['totp-secret']}`);
  });
});
