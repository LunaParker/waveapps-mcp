import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCredentials, writeCredentials } from '../auth/credentials.js';
import {
  SAVE_PW_EXIT_BAD_TOTP,
  SAVE_PW_EXIT_DECLINED,
  SAVE_PW_EXIT_NO_INPUT,
  SAVE_PW_EXIT_OK,
  runSavePassword,
} from './save-password.js';
import type { PromptIo } from './prompter.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-savepw-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

/** Scripted prompter — separate queues for echoed vs secret prompts so order matches the CLI flow. */
function scriptedIo(asks: ReadonlyArray<string>, secrets: ReadonlyArray<string>): PromptIo & { askLog: string[]; secretLog: string[] } {
  let askIdx = 0;
  let secretIdx = 0;
  const askLog: string[] = [];
  const secretLog: string[] = [];
  return {
    async ask(question) {
      askLog.push(question);
      return asks[askIdx++] ?? '';
    },
    async askSecret(question) {
      secretLog.push(question);
      return secrets[secretIdx++] ?? '';
    },
    close() {},
    askLog,
    secretLog,
  };
}

function seed(): void {
  writeCredentials({
    authToken: 'EXISTING_TOKEN',
    csrfToken: 'EXISTING_CSRF',
    businessId: 'c2cb3afe-5a24-41b2-add7-d1c6982d75a9',
    email: undefined,
    password: undefined,
    totpSecret: undefined,
  });
}

const silent = { log: () => undefined, error: () => undefined };

describe('runSavePassword', () => {
  describe('warning banner + confirmation', () => {
    it('prints a boxed warning that mentions insecurity, 2FA, and includes ⚠ characters', async () => {
      seed();
      const log = vi.fn();
      const io = scriptedIo(['n'], []); // 'n' aborts at the confirmation prompt
      await runSavePassword({ io, console: { log, error: () => undefined } });
      const banner = log.mock.calls.flat().join('\n');
      expect(banner).toContain('⚠');
      expect(banner).toMatch(/WARNING — THIS IS INSECURE/);
      expect(banner).toContain('╔');
      expect(banner).toContain('╚');
      expect(banner).toMatch(/plaintext/i);
      expect(banner).toMatch(/2FA/);
    });

    it('aborts with DECLINED when the user does not type y', async () => {
      seed();
      const io = scriptedIo(['n'], []);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_DECLINED);
      expect(readCredentials()?.password).toBeUndefined();
    });

    it.each(['', 'no', 'nope', 'maybe', '?'])('treats "%s" as a decline', async (reply) => {
      seed();
      const io = scriptedIo([reply], []);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_DECLINED);
    });

    it.each(['y', 'Y', 'yes', 'YES'])('accepts "%s" as confirmation', async (reply) => {
      seed();
      const io = scriptedIo([reply, 'me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
    });

    it('skips the confirmation when options.skipConfirmation is true', async () => {
      seed();
      const io = scriptedIo(['me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent }, { skipConfirmation: true });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      // First ask should have been the email prompt, NOT the confirmation.
      expect(io.askLog[0]).toMatch(/Wave email/);
    });
  });

  describe('email / password prompts', () => {
    it('stores email + password when 2FA is declined', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      const out = readCredentials();
      expect(out?.email).toBe('me@example.com');
      expect(out?.password).toBe('pw');
      expect(out?.totpSecret).toBeUndefined();
      expect(out?.authToken).toBe('EXISTING_TOKEN'); // existing fields preserved
    });

    it('uses askSecret (not ask) for the password prompt', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      await runSavePassword({ io, console: silent });
      // The password prompt must have gone to askSecret, never to ask.
      expect(io.secretLog.some((q) => /password/i.test(q))).toBe(true);
      expect(io.askLog.every((q) => !/password/i.test(q))).toBe(true);
    });

    it('falls back to the existing email when the user just hits Enter', async () => {
      writeCredentials({
        authToken: 'T', csrfToken: undefined, businessId: undefined,
        email: 'old@example.com', password: undefined, totpSecret: undefined,
      });
      const io = scriptedIo(['y', '', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(readCredentials()?.email).toBe('old@example.com');
    });

    it('refuses an empty password', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com'], ['']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_NO_INPUT);
    });

    it('refuses if no credentials.json exists yet (need paste first)', async () => {
      const err = vi.fn();
      const io = scriptedIo(['y', 'me@example.com'], ['pw']);
      const code = await runSavePassword({ io, console: { log: () => undefined, error: err } });
      expect(code).toBe(SAVE_PW_EXIT_NO_INPUT);
      expect(err.mock.calls.flat().join('\n')).toMatch(/paste/);
    });
  });

  describe('2FA gating', () => {
    it('does NOT ask for the TOTP secret when the user says they have no 2FA', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      await runSavePassword({ io, console: silent });
      expect(io.secretLog.length).toBe(1); // password only — no TOTP prompt
    });

    it('asks for + stores TOTP secret when 2FA is enabled', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['pw', 'JBSWY3DPEHPK3PXP']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(readCredentials()?.totpSecret).toBe('JBSWY3DPEHPK3PXP');
      // Both password and TOTP secret went through askSecret.
      expect(io.secretLog).toHaveLength(2);
      expect(io.secretLog[1]).toMatch(/TOTP/);
    });

    it('rejects a malformed TOTP secret with BAD_TOTP', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'yes'], ['pw', '!!!not-base32!!!']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_BAD_TOTP);
      expect(readCredentials()?.totpSecret).toBeUndefined();
    });

    it('skips silently if the user opts in but pastes nothing', async () => {
      seed();
      const log = vi.fn();
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['pw', '']);
      const code = await runSavePassword({ io, console: { log, error: () => undefined } });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(readCredentials()?.totpSecret).toBeUndefined();
      expect(log.mock.calls.flat().join('\n')).toMatch(/skipping/);
    });
  });
});
