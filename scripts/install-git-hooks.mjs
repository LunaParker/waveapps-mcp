#!/usr/bin/env node
/**
 * Install the project's git hooks into .git/hooks/. Runs automatically via `npm install`
 * (through the `prepare` script in package.json). Idempotent. Skips silently when there's
 * no .git directory (i.e. when this package is installed as a dependency).
 */
import { existsSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const gitDir = join(repoRoot, '.git');
const hooksDir = join(gitDir, 'hooks');

if (!existsSync(gitDir)) {
  // Installed as a dependency — no git checkout here. Quietly skip.
  process.exit(0);
}

// `.git` can be a file (worktree pointer) instead of a directory; resolve if so.
let actualHooksDir = hooksDir;
const gitStat = statSync(gitDir);
if (!gitStat.isDirectory()) {
  // A worktree's .git is a file `gitdir: <path>` pointing at the real git dir.
  // For simplicity we don't try to follow it — worktrees are uncommon for this project.
  console.warn('[waveapps-mcp] .git is not a directory (worktree?); skipping hook install.');
  process.exit(0);
}

mkdirSync(actualHooksDir, { recursive: true });

const preCommit = `#!/usr/bin/env bash
# Auto-installed by waveapps-mcp/scripts/install-git-hooks.mjs.
# Re-installed on every \`npm install\`. To customise the check, edit
# scripts/check-secrets.mjs in the repo (this file is regenerated).
set -e
exec node "$(git rev-parse --show-toplevel)/scripts/check-secrets.mjs"
`;

const target = join(actualHooksDir, 'pre-commit');
writeFileSync(target, preCommit, 'utf8');
chmodSync(target, 0o755);
console.log('[waveapps-mcp] Git pre-commit hook installed at .git/hooks/pre-commit.');
