/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: import('@cloudflare/workers-types').D1Database;
    AI: Ai;
    // Static-assets binding from wrangler.jsonc, used to serve prebuilt
    // Chatterbox audio straight from dist/ without synthesizing on request.
    ASSETS: { fetch: (request: Request) => Promise<Response> };
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
    // Optional endpoint overrides (dev/testing against a mock IdP only)
    GOOGLE_AUTH_URL: string;
    GOOGLE_TOKEN_URL: string;
    GOOGLE_USERINFO_URL: string;
  }
}
