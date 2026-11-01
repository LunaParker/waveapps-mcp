import { describe, expect, it } from 'vitest';
import { SignInChallengeError, classifyPage, type PageSnapshot } from './auth0-sign-in.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://auth.waveapps.com/u/login/identifier?state=x',
    title: 'Log in | Wave',
    hasWaveCookie: false,
    usernameVisible: false,
    passwordVisible: false,
    otpVisible: false,
    challengeVisible: false,
    errorText: null,
    ...over,
  };
}

describe('classifyPage', () => {
  it('reads the Auth0 email page as the identifier step', () => {
    expect(classifyPage(snap({ usernameVisible: true }))).toBe('identifier');
  });

  it('prefers the password step when a password field is showing', () => {
    expect(classifyPage(snap({ url: 'https://auth.waveapps.com/u/login/password', passwordVisible: true }))).toBe('password');
  });

  it("reads Wave's /auth/verify code boxes as the OTP step", () => {
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/verify', otpVisible: true }))).toBe('otp');
  });

  it('is signed in only with a real cookie on a business URL', () => {
    const dashboard = `https://next.waveapps.com/${BUSINESS_UUID}/dashboard`;
    expect(classifyPage(snap({ url: dashboard, hasWaveCookie: true }))).toBe('signed-in');
    expect(classifyPage(snap({ url: dashboard, hasWaveCookie: false }))).toBe('waiting');
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/verify', hasWaveCookie: true }))).toBe('waiting');
  });

  it("spots Cloudflare's block page before anything else", () => {
    expect(classifyPage(snap({ title: 'Wave Maintenance', usernameVisible: true }))).toBe('blocked');
  });

  it('stops for a visible CAPTCHA even when a form field is showing', () => {
    expect(classifyPage(snap({ challengeVisible: true, passwordVisible: true }))).toBe('challenge');
  });

  it('reports a visible error message', () => {
    expect(classifyPage(snap({ errorText: 'Wrong email or password', passwordVisible: true }))).toBe('error');
  });

  it('waits while redirects are in flight', () => {
    expect(classifyPage(snap({ url: 'https://next.waveapps.com/auth/auth0', title: '' }))).toBe('waiting');
  });
});

describe('SignInChallengeError', () => {
  it('tells the user how to sign in by hand', () => {
    const err = new SignInChallengeError('Wave showed a CAPTCHA challenge');
    expect(err.message).toMatch(/CAPTCHA/);
    expect(err.message).toMatch(/npx waveapps-mcp login/);
  });
});
