import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './credentials.js';

export interface ProfileLockOptions {
  lockPath?: string;
  /** How long to wait for another process's sign-in to finish. */
  waitMs?: number;
  /** A lock older than this is left over from a crashed run and gets broken. */
  staleMs?: number;
  pollMs?: number;
}

export function profileLockPath(): string {
  return join(configDir(), 'sign-in.lock');
}

/**
 * Run `fn` while holding a cross-process lock on the sign-in browser profile. Two MCP
 * servers hitting a 401 at once would otherwise both launch Chromium on the same profile.
 */
export async function withProfileLock<T>(fn: () => Promise<T>, opts: ProfileLockOptions = {}): Promise<T> {
  const lockPath = opts.lockPath ?? profileLockPath();
  const waitMs = opts.waitMs ?? 3 * 60_000;
  const staleMs = opts.staleMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 1_000;
  const deadline = Date.now() + waitMs;

  for (;;) {
    try {
      mkdirSync(lockPath, { recursive: false, mode: 0o700 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (lockAgeMs(lockPath) > staleMs) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Another waveapps-mcp sign-in is still running (lock at ${lockPath}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function lockAgeMs(lockPath: string): number {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}
