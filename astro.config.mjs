// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Astro's built-in Origin check has no per-route exemption, and
  // /unsubscribe must accept a cross-site POST with no Origin header (Gmail
  // and Apple Mail's one-click unsubscribe per RFC 8058). The equivalent
  // check is reimplemented in src/middleware.ts for every route except
  // /unsubscribe, whose own HMAC token in the URL is what actually
  // authenticates the request. Do not rely on this flag alone for CSRF
  // protection elsewhere - see src/lib/originCheck.ts.
  security: { checkOrigin: false },
  vite: {
    optimizeDeps: {
      // Discover the passthrough image service before the Worker starts.
      include: ['astro/assets/services/noop'],
    },
  },
  adapter: cloudflare({
    imageService: 'passthrough',
    // The Daily Invitation's hourly cron runs as its own Worker (see
    // src/worker.ts and wrangler.cron.jsonc) rather than as a `scheduled`
    // export on this Worker - v14 of this adapter has no config for adding
    // one to the Worker it builds for `fetch`.
    auxiliaryWorkers: [{ configPath: './wrangler.cron.jsonc' }],
  }),
});
