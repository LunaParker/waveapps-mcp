import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliCommand } from './cli-command.js';

let tmp: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'waveapps-mcp-cli-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function serverAt(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'server.js');
  writeFileSync(file, '');
  return file;
}

describe('cliCommand', () => {
  it('points at the built server when run as node dist/server.js', () => {
    const server = serverAt(join(tmp, 'waveapps-mcp', 'dist'));
    expect(cliCommand('login', server)).toBe(`node ${server} login`);
  });

  it('quotes a path the shell would split', () => {
    const server = serverAt(join(tmp, "Luna's code", 'dist'));
    expect(cliCommand('login', server)).toBe(`node '${server.replace("'", `'\\''`)}' login`);
  });

  it('resolves a symlinked server.js to the real file', () => {
    const server = serverAt(join(tmp, 'real'));
    const link = join(tmp, 'linked.js');
    symlinkSync(server, link);
    expect(cliCommand('refresh', link)).toBe(`node ${server} refresh`);
  });

  it('keeps npx for the installed bin', () => {
    const server = serverAt(join(tmp, 'node_modules', 'waveapps-mcp', 'dist'));
    const bin = join(tmp, 'node_modules', '.bin');
    mkdirSync(bin);
    symlinkSync(server, join(bin, 'waveapps-mcp'));
    expect(cliCommand('login', join(bin, 'waveapps-mcp'))).toBe('npx waveapps-mcp login');
  });

  it('falls back to npx for any other launcher', () => {
    expect(cliCommand('login', undefined)).toBe('npx waveapps-mcp login');
    expect(cliCommand('login', join(tmp, 'vitest.mjs'))).toBe('npx waveapps-mcp login');
    expect(cliCommand('logout')).toBe('npx waveapps-mcp logout');
  });
});
