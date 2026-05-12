/**
 * Smoke-test script. Run with:
 *
 *   WAVE_AUTH_TOKEN=... npx tsx scripts/smoke.ts
 *
 * Hits the cheapest authenticated REST endpoint we know — the businesses
 * list — and prints whatever Wave returns. If your token is good, you'll see
 * a JSON array with your workspaces; if it's stale you'll see a clear
 * WaveAuthError. Don't run this from CI — it's for local validation only.
 */
import { WaveClient, WaveAuthError, WaveApiError } from '../src/client/index.js';

async function main(): Promise<void> {
  const client = WaveClient.fromEnv();
  try {
    const businesses = await client.rest.get<unknown>('/businesses/', { include_personal: true });
    process.stdout.write(JSON.stringify(businesses, null, 2) + '\n');
  } catch (err) {
    if (err instanceof WaveAuthError) {
      process.stderr.write(`Auth failed: ${err.message}\n`);
      process.exit(2);
    }
    if (err instanceof WaveApiError) {
      process.stderr.write(`Wave API ${err.status} on ${err.url}\n`);
      process.stderr.write(JSON.stringify(err.body, null, 2) + '\n');
      process.exit(3);
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
