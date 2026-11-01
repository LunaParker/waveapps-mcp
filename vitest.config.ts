import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Live contract tests call Wave's real API; they run via vitest.live.config.ts only.
    exclude: [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/_test_utils.ts',
        'src/test-setup.ts',
        'src/server.ts',
        'src/transports/**',
      ],
    },
  },
});
