import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/api/tests/**/*.test.ts',
      'apps/reconciler/tests/**/*.test.ts',
      'apps/rpc-proxy/tests/**/*.test.ts',
      'apps/metrics-scraper/tests/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 10_000,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: './test-results.xml' },
  },
});
