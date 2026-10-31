import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { memorySecretStore, setSecretStore } from './auth/secrets.js';

let configDir: string;

// Never let a test read or overwrite the developer's real Keychain entries or
// ~/.config/waveapps-mcp. Test files that set WAVE_MCP_CONFIG_DIR themselves override this.
beforeEach(() => {
  setSecretStore(memorySecretStore());
  configDir = mkdtempSync(join(tmpdir(), 'waveapps-mcp-setup-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = configDir;
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});
