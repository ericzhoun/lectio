/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: import('@cloudflare/workers-types').D1Database;
    AI: Ai;
    // Static-assets binding from wrangler.jsonc (the site's own files).
    ASSETS: { fetch: (request: Request) => Promise<Response> };
    // R2 store for prebuilt TTS clips. Keys are the site path minus the
    // leading "audio/" and are gated by the manifests (see src/lib/audio.ts).
    AUDIO: import('@cloudflare/workers-types').R2Bucket;
    SESSION_SECRET: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_PRICE_BASIC: string;
    STRIPE_PRICE_PRO: string;
    STRIPE_PRICE_BASIC_ANNUAL: string;
    STRIPE_PRICE_PRO_ANNUAL: string;
    // Optional: Lectio-specific billing portal configuration id
    STRIPE_PORTAL_CONFIG_ID: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
    // Shared secret for the Roblox world's server-to-server calls to
    // /api/roblox/* (see src/roblox). Unset disables the integration (503).
    ROBLOX_API_KEY: string;
    // Optional endpoint overrides (dev/testing against a mock IdP only)
    GOOGLE_AUTH_URL: string;
    GOOGLE_TOKEN_URL: string;
    GOOGLE_USERINFO_URL: string;
    // Daily Invitation secrets (src/worker.ts, src/lib/unsubscribe.ts,
    // src/pages/api/resend-webhook.ts). Declaring these is the only
    // mechanism that catches a typo'd secret name at type-check time.
    MAIL_TOKEN_SECRET: string;
    RESEND_WEBHOOK_SECRET: string;
    RESEND_API_KEY: string;
  }
}

declare namespace App {
  interface Locals {
    /** Stable first-party visitor id, set by middleware (cookie `vid`). */
    vid: string;
    /** A/B variants assigned to this visitor (see src/lib/ab.ts). */
    variants: Record<string, string>;
  }
}
