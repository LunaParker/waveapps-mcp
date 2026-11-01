import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInChallengeError } from '../auth/auth0-sign-in.js';
import { credentialsPath, readCredentials, writeCredentials } from '../auth/credentials.js';
import { memorySecretStore } from '../auth/secrets.js';
import {
  REFRESH_EXIT_CHALLENGE,
  REFRESH_EXIT_FAILURE,
  REFRESH_EXIT_NOT_CONFIGURED,
  REFRESH_EXIT_OK,
  runRefresh,
} from './refresh.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const silent = { log: () => undefined, error: () => undefined };

function seed(email: string | undefined = 'me@example.com'): void {
  writeCredentials({ authToken: 'OLD', csrfToken: 'OLD_CSRF', businessId: BUSINESS_UUID, email });
}

describe('runRefresh', () => {
  it('signs in with the stored secrets and saves the new token', async () => {
    seed();
    const store = memorySecretStore({ password: 'pw', 'totp-secret': 'JBSWY3DPEHPK3PXP' });
    const refresh = vi.fn(async () => ({ authToken: 'NEW', csrfToken: 'NEW_CSRF', businessId: undefined }));
    expect(await runRefresh({ console: silent, store, refresh }, { headed: true })).toBe(REFRESH_EXIT_OK);
    expect(refresh).toHaveBeenCalledWith(
      { email: 'me@example.com', password: 'pw', totpSecret: 'JBSWY3DPEHPK3PXP' },
      { headed: true },
    );
    expect(readCredentials()).toMatchObject({ authToken: 'NEW', csrfToken: 'NEW_CSRF', businessId: BUSINESS_UUID });
  });

  it('moves legacy plaintext secrets out of credentials.json before signing in', async () => {
    writeFileSync(credentialsPath(), JSON.stringify({ authToken: 'OLD', email: 'me@example.com', password: 'pw' }), 'utf8');
    const store = memorySecretStore();
    const refresh = vi.fn(async () => ({ authToken: 'NEW', csrfToken: undefined, businessId: undefined }));
    expect(await runRefresh({ console: silent, store, refresh })).toBe(REFRESH_EXIT_OK);
    expect(store.get('password')).toBe('pw');
    expect(readFileSync(credentialsPath(), 'utf8')).not.toContain('"password"');
  });

  it('asks for save-password when no password is stored', async () => {
    seed();
    const err = vi.fn();
    const refresh = vi.fn();
    expect(await runRefresh({ console: { log: () => undefined, error: err }, store: memorySecretStore(), refresh })).toBe(
      REFRESH_EXIT_NOT_CONFIGURED,
    );
    expect(err.mock.calls.flat().join('\n')).toMatch(/save-password/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('exits CHALLENGE when Wave needs a person', async () => {
    seed();
    const refresh = vi.fn(async () => {
      throw new SignInChallengeError('Wave showed a CAPTCHA challenge');
    });
    expect(await runRefresh({ console: silent, store: memorySecretStore({ password: 'pw' }), refresh })).toBe(
      REFRESH_EXIT_CHALLENGE,
    );
    expect(readCredentials()?.authToken).toBe('OLD');
  });

  it('exits FAILURE on any other sign-in error', async () => {
    seed();
    const refresh = vi.fn(async () => {
      throw new Error('Wave rejected the sign-in: Wrong email or password');
    });
    expect(await runRefresh({ console: silent, store: memorySecretStore({ password: 'pw' }), refresh })).toBe(
      REFRESH_EXIT_FAILURE,
    );
  });
});

describe('runRefresh: the sign-in email', () => {
  afterEach(() => vi.unstubAllEnvs());

  const store = () => memorySecretStore({ password: 'pw' });
  const signedIn = () => vi.fn(async () => ({ authToken: 'NEW', csrfToken: 'NEW_CSRF', businessId: BUSINESS_UUID }));
  const typing = (answer: string) => ({ ask: vi.fn(async () => answer), askSecret: vi.fn(async () => ''), close: vi.fn() });

  it('uses WAVE_EMAIL over the stored email and saves it', async () => {
    seed('old@example.com');
    vi.stubEnv('WAVE_EMAIL', 'env@example.com');
    const refresh = signedIn();
    expect(await runRefresh({ console: silent, store: store(), refresh, interactive: false })).toBe(REFRESH_EXIT_OK);
    expect(refresh).toHaveBeenCalledWith({ email: 'env@example.com', password: 'pw' }, { headed: false });
    expect(readCredentials()?.email).toBe('env@example.com');
  });

  it('signs in on a fresh host from WAVE_EMAIL and creates credentials.json', async () => {
    vi.stubEnv('WAVE_EMAIL', 'env@example.com');
    expect(await runRefresh({ console: silent, store: store(), refresh: signedIn(), interactive: false })).toBe(REFRESH_EXIT_OK);
    expect(readCredentials()).toMatchObject({ authToken: 'NEW', csrfToken: 'NEW_CSRF', businessId: BUSINESS_UUID, email: 'env@example.com' });
  });

  it('asks for the email in a terminal when none is on file, then saves it', async () => {
    const io = typing(' typed@example.com ');
    const refresh = signedIn();
    expect(await runRefresh({ console: silent, store: store(), refresh, io, interactive: true })).toBe(REFRESH_EXIT_OK);
    expect(io.ask).toHaveBeenCalledTimes(1);
    expect(io.close).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith({ email: 'typed@example.com', password: 'pw' }, { headed: false });
    expect(readCredentials()?.email).toBe('typed@example.com');
  });

  it('says how to supply the email when it cannot ask', async () => {
    const err = vi.fn();
    const io = typing('never@example.com');
    const refresh = vi.fn();
    const code = await runRefresh({ console: { log: () => undefined, error: err }, store: store(), refresh, io, interactive: false });
    expect(code).toBe(REFRESH_EXIT_NOT_CONFIGURED);
    expect(err.mock.calls.flat().join('\n')).toMatch(/WAVE_EMAIL/);
    expect(io.ask).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not ask for the email when there is no password to sign in with', async () => {
    const io = typing('typed@example.com');
    const refresh = vi.fn();
    expect(await runRefresh({ console: silent, store: memorySecretStore(), refresh, io, interactive: true })).toBe(
      REFRESH_EXIT_NOT_CONFIGURED,
    );
    expect(io.ask).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
