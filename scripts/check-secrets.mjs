#!/usr/bin/env node
/**
 * Pre-commit guard. Refuses to let a commit land if a staged file contains anything that
 * looks like a real Wave session token, password, or CSRF token.
 *
 *   • Exact-match block list — historical real tokens that have ever appeared in this
 *     project. Useful defence against accidentally re-committing a value that already
 *     leaked once during development.
 *   • Heuristic block — long literals attached to known sensitive keys
 *     (authToken / password / csrfToken / totpSecret / Bearer …) that don't start with
 *     an obvious placeholder marker.
 *
 * False positive? Rename the literal so it starts with EXAMPLE_/FAKE_/TEST_/PLACEHOLDER_.
 * Emergency bypass: `git commit --no-verify`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const IGNORE_PATHS = [
  /^node_modules\//,
  /^dist\//,
  /^coverage\//,
  /^docs\//,
  /^\.git\//,
  /^package-lock\.json$/,
  // The hook itself contains literal token examples for documentation; allowlist it.
  /^scripts\/check-secrets\.mjs$/,
];

/** Known-real tokens that have appeared in this project's session history. Even after
 * rotation, these are personally identifying — never re-commit. */
const KNOWN_REAL_TOKENS = [
  'tKWL4MKvWjVdZBfDAA70sCn4L5Vlbd',
  '8YGXLRXNtcmZ7AtDdXtlDtkpa2sJgTn3',
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

  // Block list — known real tokens
  for (const token of KNOWN_REAL_TOKENS) {
    let idx = content.indexOf(token);
    while (idx !== -1) {
      violation(file, lineNumberAt(content, idx), 'known real Wave token from project history', token);
      idx = content.indexOf(token, idx + 1);
    }
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
