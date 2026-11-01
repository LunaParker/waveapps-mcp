#!/usr/bin/env node
/**
 * Pre-commit guard. Refuses to let a commit land if a staged file contains anything that
 * looks like a real Wave session token, password, or CSRF token.
 *
 *   • Hash block list — SHA-256 of historical real tokens that have ever appeared in this
 *     project, so the tokens themselves never sit in the repo. Useful defence against
 *     accidentally re-committing a value that already leaked once during development.
 *   • Heuristic block — long literals attached to known sensitive keys
 *     (authToken / password / csrfToken / totpSecret / Bearer …) that don't start with
 *     an obvious placeholder marker.
 *
 * False positive? Rename the literal so it starts with EXAMPLE_/FAKE_/TEST_/PLACEHOLDER_.
 * Emergency bypass: `git commit --no-verify`.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const IGNORE_PATHS = [
  /^node_modules\//,
  /^dist\//,
  /^coverage\//,
  /^docs\//,
  /^\.git\//,
  /^package-lock\.json$/,
];

/** SHA-256 of real tokens from this project's session history. Even rotated they identify
 * the account, so only hashes live here. Never re-commit the tokens. */
const KNOWN_REAL_TOKEN_HASHES = [
  { length: 30, sha256: 'a4922df93cf5274c3ace12a8ac641147ac48d45afeb52e876a096110bfa184ea' },
  { length: 32, sha256: '4d5ed2df608a7157af642bd4c52b126700c173ca337b04b8a295ab939e641528' },
];

/** Placeholder prefixes that mark a value as "obviously fake on purpose". */
const PLACEHOLDER_PREFIXES = [
  'EXAMPLE_',
  'FAKE_',
  'TEST_',
  'PLACEHOLDER_',
  'SAMPLE_',
  'DUMMY_',
];

/** Short literal values that are obviously not secrets — short test fixtures. */
const SHORT_OK = (value) => value.length < 15;

/** Heuristic rules: a regex that yields a captured value + a brief human label. */
const CONTEXTUAL_RULES = [
  {
    pattern: /(?:authToken|password|csrfToken|totpSecret)\s*[:=]\s*['"]([^'"]+)['"]/g,
    label: 'auth-context literal that does not look like a placeholder',
    extraOk: (value) =>
      // Short test fixtures we know about
      ['hunter2', 'pw', 'invalidated', 'X', 'Y', 'T', 'TOKEN', 'CSRF'].includes(value) ||
      value.startsWith('EXISTING_') ||
      // RFC 6238 canonical TOTP test vector — public, must stay valid base32.
      value === 'JBSWY3DPEHPK3PXP',
  },
  {
    pattern: /Bearer\s+([A-Za-z0-9_.+/=-]{20,})/g,
    label: 'Bearer-token literal without a placeholder prefix',
    extraOk: () => false,
  },
];

const isPlaceholder = (value) =>
  PLACEHOLDER_PREFIXES.some((p) => value.startsWith(p));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const mask = (value) => `${value.slice(0, 4)}…${value.slice(-2)}`;

/** Windows of each known token's length, inside alphanumeric runs, whose hash is on the list. */
function findKnownTokens(content) {
  const found = [];
  for (const run of content.matchAll(/[A-Za-z0-9]+/g)) {
    for (const known of KNOWN_REAL_TOKEN_HASHES) {
      for (let i = 0; i + known.length <= run[0].length; i += 1) {
        const value = run[0].slice(i, i + known.length);
        if (sha256(value) === known.sha256) found.push({ index: run.index + i, value });
      }
    }
  }
  return found;
}

function listStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !IGNORE_PATHS.some((re) => re.test(s)));
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

let violations = 0;
const violation = (file, line, label, snippet) => {
  console.error(`  ✗ ${file}:${line} — ${label}`);
  console.error(`      ${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''}`);
  violations += 1;
};

const staged = listStagedFiles();
for (const file of staged) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable
  }

  // Block list — known real tokens, matched by hash and reported masked
  for (const { index, value } of findKnownTokens(content)) {
    violation(file, lineNumberAt(content, index), 'known real Wave token from project history', mask(value));
  }

  // Heuristic rules
  for (const rule of CONTEXTUAL_RULES) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(content)) !== null) {
      const value = m[1];
      if (SHORT_OK(value)) continue;
      if (isPlaceholder(value)) continue;
      if (rule.extraOk(value)) continue;
      violation(file, lineNumberAt(content, m.index), rule.label, m[0]);
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} potential secret(s) found in staged files. Commit aborted.\n`);
  console.error('How to proceed:');
  console.error('  • If the match is a real secret: remove or replace it in your working tree.');
  console.error('  • If it is a false positive: prefix the literal with EXAMPLE_, FAKE_, TEST_,');
  console.error('    PLACEHOLDER_, SAMPLE_, or DUMMY_.');
  console.error('  • To bypass deliberately (e.g. intentional documentation):');
  console.error('       git commit --no-verify');
  process.exit(1);
}

process.exit(0);
