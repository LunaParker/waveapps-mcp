import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchCli } from './index.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-cli-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

describe('dispatchCli', () => {
  it('returns handled=false when argv is empty', async () => {
    const result = await dispatchCli([], { log: vi.fn(), error: vi.fn() });
    expect(result).toEqual({ handled: false, exitCode: 0 });
  });

  it('routes logout', async () => {
    const log = vi.fn();
    const result = await dispatchCli(['logout'], { log, error: vi.fn() });
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  // Note: `paste` isn't tested through the dispatcher because it opens a readline on stdin.
  // The dispatch switch arm is structurally identical to the others; runPaste itself has
  // dedicated tests with an injected `ask` function.

  it('routes whoami', async () => {
    const log = vi.fn();
    const result = await dispatchCli(['whoami'], { log, error: vi.fn() });
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(1); // no creds in tmp
  });

  it.each(['help', '--help', '-h'])('routes "%s" to the help screen', async (flag) => {
    const log = vi.fn();
    const result = await dispatchCli([flag], { log, error: vi.fn() });
    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Subcommands:'));
  });

  it('exits 64 (usage) on an unknown subcommand', async () => {
    const error = vi.fn();
    const result = await dispatchCli(['bogus'], { log: vi.fn(), error });
    expect(result).toEqual({ handled: true, exitCode: 64 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown subcommand: bogus'));
  });

  it('routes login (which exits NO_BROWSER without a real browser)', async () => {
    process.env['WAVE_MCP_BROWSER_PATH'] = '/definitely/not/a/browser';
    try {
      const error = vi.fn();
      const result = await dispatchCli(['login'], { log: vi.fn(), error });
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(2); // LOGIN_EXIT_NO_BROWSER
    } finally {
      delete process.env['WAVE_MCP_BROWSER_PATH'];
    }
  });
});
