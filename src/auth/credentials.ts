import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredCredentials {
  authToken: string;
  csrfToken: string | undefined;
  businessId: string | undefined;
  /** Email used for username/password sign-in. Optional. */
  email: string | undefined;
  /** Plaintext Wave password. Optional. Enables auto-refresh of expired sessions. */
  password: string | undefined;
  /** Base32 TOTP secret for 2FA-enabled accounts. Optional. Defeats 2FA when stored alongside the password — see README. */
  totpSecret: string | undefined;
  updatedAt: string;
}

const CONFIG_DIR_OVERRIDE_ENV = 'WAVE_MCP_CONFIG_DIR';
const CONFIG_DIRNAME = 'waveapps-mcp';
const CREDENTIALS_FILENAME = 'credentials.json';

export function configDir(): string {
  const override = process.env[CONFIG_DIR_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), '.config', CONFIG_DIRNAME);
}

export function credentialsPath(): string {
  return join(configDir(), CREDENTIALS_FILENAME);
}

export function readCredentials(): StoredCredentials | null {
  const path = credentialsPath();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (typeof parsed.authToken !== 'string' || parsed.authToken.length === 0) return null;
    return {
      authToken: parsed.authToken,
      csrfToken: typeof parsed.csrfToken === 'string' ? parsed.csrfToken : undefined,
      businessId: typeof parsed.businessId === 'string' ? parsed.businessId : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      password: typeof parsed.password === 'string' ? parsed.password : undefined,
      totpSecret: typeof parsed.totpSecret === 'string' ? parsed.totpSecret : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new Error(`Failed to read Wave credentials at ${path}: ${(err as Error).message}`);
  }
}

export function writeCredentials(creds: Omit<StoredCredentials, 'updatedAt'>): StoredCredentials {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const stored: StoredCredentials = { ...creds, updatedAt: new Date().toISOString() };
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
    password: partial.password !== undefined ? partial.password : existing?.password,
    totpSecret: partial.totpSecret !== undefined ? partial.totpSecret : existing?.totpSecret,
  };
  if (merged.authToken.length === 0) {
    throw new Error('Refusing to write credentials without an authToken. Run `npx waveapps-mcp paste` first.');
  }
  return writeCredentials(merged);
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

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
