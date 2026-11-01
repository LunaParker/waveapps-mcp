import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

/** A subcommand as a shell command matching how this process was started, so hints work from any folder. */
export function cliCommand(subcommand: string, script: string | undefined = process.argv[1]): string {
  if (script && basename(script) !== 'waveapps-mcp') {
    const resolved = realpath(script);
    if (basename(resolved) === 'server.js') return `node ${shellQuote(resolved)} ${subcommand}`;
  }
  return `npx waveapps-mcp ${subcommand}`;
}

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
