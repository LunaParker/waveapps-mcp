import { defineConfig } from 'vitest/config';

// Contract tests against Wave's live, undocumented API. Never part of `npm test` or CI.
//   npm run test:live             — no session needed; a bogus token can't read or change anything
//   npm run test:live:signed-in   — also runs read-only checks with your stored session
//   npm run test:live:writes      — also creates, changes and deletes records on a test customer
export default defineConfig(({ mode }) => ({
  test: {
    include: ['src/**/*.live.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env:
      mode === 'writes'
        ? { WAVE_LIVE_SIGNED_IN: '1', WAVE_LIVE_WRITES: '1' }
        : mode === 'signed-in'
          ? { WAVE_LIVE_SIGNED_IN: '1' }
          : {},
  },
}));
