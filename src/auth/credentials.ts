import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { secretStore, type SecretName, type SecretStore } from './secrets.js';

/**
 * What lives in credentials.json. The password and TOTP secret do not: they sit in the OS
 * credential store (see secrets.ts). Older files may still carry them; see migrateLegacySecrets.
 */
export interface StoredCredentials {
  authToken: string;
  csrfToken: string | undefined;
  businessId: string | undefined;
  /** Email used for automatic sign-in. Optional. */
  email: string | undefined;
  updatedAt: string;
}

const CONFIG_DIR_OVERRIDE_ENV = 'WAVE_MCP_CONFIG_DIR';
const CONFIG_DIRNAME = 'waveapps-mcp';
const CREDENTIALS_FILENAME = 'credentials.json';

/** Pre-Keychain field names in credentials.json, and where each one moves to. */
const LEGACY_SECRET_FIELDS: ReadonlyArray<readonly [field: string, name: SecretName]> = [
  ['password', 'password'],
  ['totpSecret', 'totp-secret'],
];

export function configDir(): string {
  const override = process.env[CONFIG_DIR_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), '.config', CONFIG_DIRNAME);
}

export function credentialsPath(): string {
  return join(configDir(), CREDENTIALS_FILENAME);
}

function readRaw(): Record<string, unknown> | null {
  const path = credentialsPath();
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new Error(`Failed to read Wave credentials at ${path}: ${(err as Error).message}`);
  }
}

export function readCredentials(): StoredCredentials | null {
  const parsed = readRaw();
  if (parsed === null) return null;
  if (typeof parsed['authToken'] !== 'string' || parsed['authToken'].length === 0) return null;
  return {
    authToken: parsed['authToken'],
    csrfToken: optionalString(parsed['csrfToken']),
    businessId: optionalString(parsed['businessId']),
    email: optionalString(parsed['email']),
    updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : '',
  };
}

export function writeCredentials(creds: Omit<StoredCredentials, 'updatedAt'>): StoredCredentials {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const stored: StoredCredentials = {
    authToken: creds.authToken,
    csrfToken: creds.csrfToken,
    businessId: creds.businessId,
    email: creds.email,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  return stored;
}

/** Merge partial updates into the existing credentials file. Preserves fields you don't pass. */
export function patchCredentials(partial: Partial<Omit<StoredCredentials, 'updatedAt'>>): StoredCredentials {
  const existing = readCredentials();
  const merged: Omit<StoredCredentials, 'updatedAt'> = {
    authToken: partial.authToken ?? existing?.authToken ?? '',
    csrfToken: partial.csrfToken !== undefined ? partial.csrfToken : existing?.csrfToken,
    businessId: partial.businessId !== undefined ? partial.businessId : existing?.businessId,
    email: partial.email !== undefined ? partial.email : existing?.email,
  };
  if (merged.authToken.length === 0) {
    throw new Error('Refusing to write credentials without an authToken. Run `npx waveapps-mcp login` first.');
  }
  return writeCredentials(merged);
}

/**
 * Move a plaintext password / TOTP secret left in credentials.json by older versions into
 * the OS credential store, then rewrite the file without them. Leaves the file untouched
 * if the store rejects a write. Returns the secrets that moved.
 */
export function migrateLegacySecrets(store: SecretStore = secretStore()): SecretName[] {
  const raw = readRaw();
  if (raw === null) return [];
  const found = LEGACY_SECRET_FIELDS.filter(([field]) => typeof raw[field] === 'string' && raw[field] !== '');
  if (found.length === 0) return [];
  for (const [field, name] of found) store.set(name, raw[field] as string);

  const scrubbed = { ...raw };
  for (const [field] of LEGACY_SECRET_FIELDS) delete scrubbed[field];
  writeFileSync(credentialsPath(), JSON.stringify(scrubbed, null, 2), { encoding: 'utf8', mode: 0o600 });
  // `mode` only applies on create; tighten a file that was written looser by hand.
  chmodSync(credentialsPath(), 0o600);
  return found.map(([, name]) => name);
}

export function deleteCredentials(): boolean {
  const path = credentialsPath();
  try {
    rmSync(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** Stat the credentials file and return age in seconds, or null if missing. */
export function credentialsAgeSeconds(): number | null {
  try {
    const s = statSync(credentialsPath());
    return Math.floor((Date.now() - s.mtimeMs) / 1000);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
