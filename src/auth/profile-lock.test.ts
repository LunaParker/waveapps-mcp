import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withProfileLock } from './profile-lock.js';

let tmp: string;
let lockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'waveapps-mcp-lock-'));
  lockPath = join(tmp, 'sign-in.lock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('withProfileLock', () => {
  it('holds the lock while fn runs and releases it afterwards', async () => {
    const seen = await withProfileLock(async () => existsSync(lockPath), { lockPath });
    expect(seen).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('releases the lock when fn throws', async () => {
    await expect(withProfileLock(async () => { throw new Error('boom'); }, { lockPath })).rejects.toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('runs callers one at a time', async () => {
    const order: string[] = [];
    const slow = withProfileLock(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('a:end');
    }, { lockPath, pollMs: 10 });
    await new Promise((r) => setTimeout(r, 5));
    const fast = withProfileLock(async () => void order.push('b'), { lockPath, pollMs: 10 });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('gives up after waitMs when the lock stays held', async () => {
    mkdirSync(lockPath);
    await expect(withProfileLock(async () => 1, { lockPath, waitMs: 30, pollMs: 10 })).rejects.toThrow(/still running/);
  });

  it('breaks a lock left over from a crashed run', async () => {
    mkdirSync(lockPath);
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(lockPath, old, old);
    await expect(withProfileLock(async () => 'ran', { lockPath, staleMs: 60_000 })).resolves.toBe('ran');
  });
});
