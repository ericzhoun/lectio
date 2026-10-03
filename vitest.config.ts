import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Restrict test discovery to the source tree. Every real test lives under
    // src/, and the default glob otherwise walks host scratch directories that
    // happen to contain a snapshot of a test file (e.g. .zwork/artifacts/...),
    // collecting the same suite twice and failing on its relative imports.
    include: ['src/**/*.test.{ts,mts,js}'],
  },
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./src/lib/__mocks__/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
});
