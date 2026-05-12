import { describe, expect, it, vi } from 'vitest';
import { refreshSession, type DriverInput, type DriverResult } from './refresh-session.js';

const BUSINESS_UUID = 'c2cb3afe-5a24-41b2-add7-d1c6982d75a9';
const DASHBOARD_URL = `https://next.waveapps.com/${BUSINESS_UUID}/dashboard/`;

function stubDriver(result: DriverResult): (i: DriverInput) => Promise<DriverResult> {
  return vi.fn(async () => result);
}

describe('refreshSession', () => {
  it('returns extracted auth from the driver result', async () => {
    const driver = stubDriver({
      cookies: [
        { name: 'waveapps', value: 'NEW_TOKEN' },
        { name: 'identity-csrftoken', value: 'NEW_CSRF' },
      ],
      url: DASHBOARD_URL,
    });
    const out = await refreshSession({ email: 'me@example.com', password: 'pw' }, { driver });
    expect(out).toEqual({
      authToken: 'NEW_TOKEN',
      csrfToken: 'NEW_CSRF',
      businessId: BUSINESS_UUID,
    });
  });

  it('passes a working generateTotp function to the driver when totpSecret is set', async () => {
    let generated: string | null = null;
    const driver = vi.fn(async (input: DriverInput) => {
      generated = input.generateTotp();
      return { cookies: [{ name: 'waveapps', value: 'TOK' }], url: DASHBOARD_URL };
    });
    await refreshSession(
      { email: 'me@example.com', password: 'pw', totpSecret: 'JBSWY3DPEHPK3PXP' },
      { driver },
    );
    expect(generated).toMatch(/^\d{6}$/);
  });

  it('generateTotp returns null when no TOTP secret is stored', async () => {
    let generated: string | null = 'placeholder';
    const driver = vi.fn(async (input: DriverInput) => {
      generated = input.generateTotp();
      return { cookies: [{ name: 'waveapps', value: 'TOK' }], url: DASHBOARD_URL };
    });
    await refreshSession({ email: 'me@example.com', password: 'pw' }, { driver });
    expect(generated).toBeNull();
  });

  it('throws when the driver result has no valid waveapps cookie', async () => {
    const driver = stubDriver({
      cookies: [{ name: 'waveapps', value: 'invalidated' }],
      url: 'https://my.waveapps.com/login/',
    });
    await expect(refreshSession({ email: 'me@example.com', password: 'wrong' }, { driver })).rejects.toThrowError(
      /did not set a valid `waveapps` cookie/,
    );
  });

  it('rejects missing email or password before invoking the driver', async () => {
    const driver = vi.fn();
    await expect(refreshSession({ email: '', password: 'pw' }, { driver })).rejects.toThrowError(/email/);
    await expect(refreshSession({ email: 'a@b.com', password: '' }, { driver })).rejects.toThrowError(/email/);
    expect(driver).not.toHaveBeenCalled();
  });
});
