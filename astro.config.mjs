// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  vite: {
    optimizeDeps: {
      // Discover the passthrough image service before the Worker starts.
      include: ['astro/assets/services/noop'],
    },
  },
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
});
