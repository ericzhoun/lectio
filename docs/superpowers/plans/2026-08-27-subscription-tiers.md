# Subscription Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Free/Basic/Pro subscription tiers to Inspire, gating spread choice, daily draw quota, and reading history, billed via Stripe.

**Architecture:** Astro API routes on Cloudflare Workers own auth (email+password, signed session cookie) and Stripe billing (Checkout, webhook, Customer Portal). New D1 tables (`users`, `subscriptions`, `usage_daily`) sit alongside the existing `drawing_sessions` table, following the same lazy `ensureTable` pattern already used in `src/lib/db.ts`. A pure `entitlements` module decides tier access without touching D1, so it's unit-testable; thin async wrappers do the D1 reads/writes.

**Tech Stack:** Astro 7 (Cloudflare adapter), D1, Web Crypto (`crypto.subtle`) for password hashing and cookie signing, `stripe` npm package with its fetch-based HTTP client (Workers-compatible), Vitest for unit tests (new — no test runner exists in this repo yet).

**Spec:** `docs/superpowers/specs/2026-08-27-subscription-tiers-design.md`

## Global Constraints

- No native bcrypt — Workers has no native bindings; password hashing uses `crypto.subtle` PBKDF2.
- No server-side session store — sessions are a signed cookie (HMAC-SHA256), verified stateless.
- Stripe secret key, webhook signing secret, session-signing secret, and both price IDs are Worker secrets (`wrangler secret put`), never committed.
- Anonymous (logged-out) users stay Free tier, keyed by the existing `user_id` cookie — no forced login for the current single-card flow.
- Follow the existing lazy `ensureTable`-per-module pattern from `src/lib/db.ts` for all new D1 tables — no separate migrations directory.

---

## Task 1: Add Vitest test tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__tests__/sanity.test.ts`

**Interfaces:**
- Produces: `npm test` script, runnable by every later task's test steps.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to package.json**

Add to the `"scripts"` block in `package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write a sanity test**

```typescript
// src/lib/__tests__/sanity.test.ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/__tests__/sanity.test.ts
git commit -m "test: add vitest harness"
```

---

## Task 2: Password hashing (`src/lib/crypto.ts`)

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `src/lib/__tests__/crypto.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>` — returns `"<saltB64>:<hashB64>"`.
- Produces: `verifyPassword(password: string, stored: string): Promise<boolean>`.
- Consumes: `crypto.subtle` (global, available in Workers and Node ≥22 test env).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../crypto';

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../crypto'"

- [ ] **Step 3: Implement crypto.ts**

```typescript
// src/lib/crypto.ts
const ITERATIONS = 100_000;
const HASH_ALGO = 'SHA-256';
const KEY_LENGTH_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH_ALGO },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt);
  return `${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = await deriveBits(password, salt);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts src/lib/__tests__/crypto.test.ts
git commit -m "feat: add PBKDF2 password hashing"
```

---

## Task 3: Signed session cookie (`src/lib/session.ts`)

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/__tests__/session.test.ts`

**Interfaces:**
- Produces: `createSessionToken(userId: string, secret: string, ttlSeconds?: number): Promise<string>`.
- Produces: `verifySessionToken(token: string, secret: string): Promise<string | null>` — returns `userId` or `null` if invalid/expired.
- Consumes: `crypto.subtle` (HMAC-SHA256).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/session.test.ts
import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '../session';

const SECRET = 'test-secret';

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionToken('user-123', SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe('user-123');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('user-123', SECRET);
    expect(await verifySessionToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken('user-123', SECRET);
    const tampered = token.replace('user-123', 'user-456');
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken('user-123', SECRET, -1);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../session'"

- [ ] **Step 3: Implement session.ts**

```typescript
// src/lib/session.ts
function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 30
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${expiry}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiryStr, sigB64] = parts;
  const expiry = Number(expiryStr);
  if (!userId || !Number.isFinite(expiry)) return null;
  if (Math.floor(Date.now() / 1000) > expiry) return null;

  const payload = `${userId}.${expiryStr}`;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(sigB64), new TextEncoder().encode(payload));
  return valid ? userId : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/__tests__/session.test.ts
git commit -m "feat: add signed session token"
```

---

## Task 4: D1 tables for users, subscriptions, usage

**Files:**
- Create: `src/lib/users.ts`
- Create: `src/lib/subscriptions.ts`
- Create: `src/lib/usage.ts`

**Interfaces:**
- Consumes: `env.DB` (D1Database, as used in `src/lib/db.ts`), `hashPassword`/`verifyPassword` from Task 2.
- Produces (`users.ts`): `createUser(email: string, password: string): Promise<{id: string} | {error: 'duplicate'}>`, `verifyUserCredentials(email: string, password: string): Promise<string | null>` (returns `userId` or `null`).
- Produces (`subscriptions.ts`): `getSubscription(userId: string): Promise<{tier: string; status: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; currentPeriodEnd: string | null} | null>`, `upsertSubscription(params: {userId: string; tier: string; status: string; stripeCustomerId?: string; stripeSubscriptionId?: string; currentPeriodEnd?: string}): Promise<void>`.
- Produces (`usage.ts`): `getTodayUsage(userId: string): Promise<number>`, `incrementUsage(userId: string): Promise<void>`.

No D1 test double exists in this repo (the existing `drawing_sessions` code in `src/lib/db.ts` has no unit tests either) — these three modules are verified manually via the dev server in Task 7/10, consistent with the existing pattern. Follow `src/lib/db.ts`'s `ensureTable`-guarded-by-module-level-boolean structure exactly.

- [ ] **Step 1: Implement users.ts**

```typescript
// src/lib/users.ts
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword } from './crypto';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

export async function createUser(
  email: string,
  password: string
): Promise<{ id: string } | { error: 'duplicate' }> {
  const db = env.DB;
  await ensureTable(db);
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return { error: 'duplicate' };

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db
    .prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .bind(id, email, passwordHash)
    .run();
  return { id };
}

export async function verifyUserCredentials(email: string, password: string): Promise<string | null> {
  const db = env.DB;
  await ensureTable(db);
  const row = await db
    .prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? row.id : null;
}
```

- [ ] **Step 2: Implement subscriptions.ts**

```typescript
// src/lib/subscriptions.ts
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end DATETIME
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

export interface SubscriptionRow {
  tier: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const db = env.DB;
  await ensureTable(db);
  const row = await db
    .prepare(
      'SELECT tier, status, stripe_customer_id, stripe_subscription_id, current_period_end FROM subscriptions WHERE user_id = ?'
    )
    .bind(userId)
    .first<{
      tier: string;
      status: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      current_period_end: string | null;
    }>();
  if (!row) return null;
  return {
    tier: row.tier,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end,
  };
}

export async function upsertSubscription(params: {
  userId: string;
  tier: string;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
}): Promise<void> {
  const db = env.DB;
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = excluded.status,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
         current_period_end = excluded.current_period_end`
    )
    .bind(
      params.userId,
      params.tier,
      params.status,
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
      params.currentPeriodEnd ?? null
    )
    .run();
}
```

- [ ] **Step 3: Implement usage.ts**

```typescript
// src/lib/usage.ts
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  draw_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(userId: string): Promise<number> {
  const db = env.DB;
  await ensureTable(db);
  const row = await db
    .prepare('SELECT draw_count FROM usage_daily WHERE user_id = ? AND date = ?')
    .bind(userId, todayUtc())
    .first<{ draw_count: number }>();
  return row?.draw_count ?? 0;
}

export async function incrementUsage(userId: string): Promise<void> {
  const db = env.DB;
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO usage_daily (user_id, date, draw_count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET draw_count = draw_count + 1`
    )
    .bind(userId, todayUtc())
    .run();
}
```

- [ ] **Step 4: Type-check**

Run: `npx astro check`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/users.ts src/lib/subscriptions.ts src/lib/usage.ts
git commit -m "feat: add users, subscriptions, usage_daily D1 tables"
```

---

## Task 5: Entitlements logic (`src/lib/entitlements.ts`)

**Files:**
- Create: `src/lib/entitlements.ts`
- Test: `src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Consumes: `getSubscription` from `subscriptions.ts` (Task 4), `getTodayUsage`/`incrementUsage` from `usage.ts` (Task 4).
- Produces: `type Tier = 'free' | 'basic' | 'pro'`.
- Produces: `SPREAD_ACCESS: Record<Tier, string[]>` — spread keys allowed per tier (`'single' | '3card' | 'celtic_cross'`, matching the keys in `SPREADS` from `src/lib/tarot.ts`).
- Produces: `QUOTA: Record<Tier, number>` — `Infinity` for unlimited.
- Produces: `evaluateEntitlement(tier: Tier, todayCount: number, spreadKey: string): { ok: true } | { ok: false; reason: 'quota' | 'spread_locked' }` — pure, no I/O.
- Produces: `canDraw(userId: string, spreadKey: string): Promise<{ ok: true } | { ok: false; reason: 'quota' | 'spread_locked' }>` — resolves tier via `getSubscription` (defaults `'free'` on missing row or `status !== 'active'`), resolves usage via `getTodayUsage`, delegates to `evaluateEntitlement`.
- Produces: `recordDraw(userId: string): Promise<void>` — calls `incrementUsage`.

- [ ] **Step 1: Write the failing tests (pure logic only)**

```typescript
// src/lib/__tests__/entitlements.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateEntitlement, SPREAD_ACCESS, QUOTA } from '../entitlements';

describe('evaluateEntitlement', () => {
  it('allows free tier single-card draws under quota', () => {
    expect(evaluateEntitlement('free', 0, 'single')).toEqual({ ok: true });
  });

  it('blocks free tier at quota', () => {
    expect(evaluateEntitlement('free', QUOTA.free, 'single')).toEqual({ ok: false, reason: 'quota' });
  });

  it('blocks free tier from 3card spread', () => {
    expect(evaluateEntitlement('free', 0, '3card')).toEqual({ ok: false, reason: 'spread_locked' });
  });

  it('allows basic tier 3card under quota', () => {
    expect(evaluateEntitlement('basic', 0, '3card')).toEqual({ ok: true });
  });

  it('blocks basic tier from celtic_cross', () => {
    expect(evaluateEntitlement('basic', 0, 'celtic_cross')).toEqual({ ok: false, reason: 'spread_locked' });
  });

  it('allows pro tier celtic_cross with unlimited quota', () => {
    expect(evaluateEntitlement('pro', 10_000, 'celtic_cross')).toEqual({ ok: true });
  });

  it('every tier in SPREAD_ACCESS has a matching QUOTA entry', () => {
    expect(Object.keys(SPREAD_ACCESS).sort()).toEqual(Object.keys(QUOTA).sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../entitlements'"

- [ ] **Step 3: Implement entitlements.ts**

```typescript
// src/lib/entitlements.ts
import { getSubscription } from './subscriptions';
import { getTodayUsage, incrementUsage } from './usage';

export type Tier = 'free' | 'basic' | 'pro';

export const SPREAD_ACCESS: Record<Tier, string[]> = {
  free: ['single'],
  basic: ['single', '3card'],
  pro: ['single', '3card', 'celtic_cross'],
};

export const QUOTA: Record<Tier, number> = {
  free: 3,
  basic: 20,
  pro: Infinity,
};

export type EntitlementResult = { ok: true } | { ok: false; reason: 'quota' | 'spread_locked' };

export function evaluateEntitlement(tier: Tier, todayCount: number, spreadKey: string): EntitlementResult {
  if (!SPREAD_ACCESS[tier].includes(spreadKey)) {
    return { ok: false, reason: 'spread_locked' };
  }
  if (todayCount >= QUOTA[tier]) {
    return { ok: false, reason: 'quota' };
  }
  return { ok: true };
}

export async function resolveTier(userId: string): Promise<Tier> {
  const sub = await getSubscription(userId);
  if (!sub || sub.status !== 'active') return 'free';
  if (sub.tier === 'basic' || sub.tier === 'pro') return sub.tier;
  return 'free';
}

export async function canDraw(userId: string, spreadKey: string): Promise<EntitlementResult> {
  const tier = await resolveTier(userId);
  const todayCount = await getTodayUsage(userId);
  return evaluateEntitlement(tier, todayCount, spreadKey);
}

export async function recordDraw(userId: string): Promise<void> {
  await incrementUsage(userId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts src/lib/__tests__/entitlements.test.ts
git commit -m "feat: add entitlements (tier/spread/quota) logic"
```

---

## Task 6: Env types and local secrets

**Files:**
- Modify: `src/env.d.ts`
- Create: `.dev.vars.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Cloudflare.Env` fields `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, consumed by Tasks 7 and 9.

- [ ] **Step 1: Extend env.d.ts**

```typescript
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: import('@cloudflare/workers-types').D1Database;
    SESSION_SECRET: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_PRICE_BASIC: string;
    STRIPE_PRICE_PRO: string;
  }
}
```

- [ ] **Step 2: Add .dev.vars.example**

```
SESSION_SECRET=replace-with-a-long-random-string
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_...
STRIPE_PRICE_PRO=price_...
```

- [ ] **Step 3: Confirm .gitignore excludes local secrets**

Check `.gitignore` contains `.dev.vars` (add it if missing — never commit real secrets).

- [ ] **Step 4: Type-check**

Run: `npx astro check`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/env.d.ts .dev.vars.example .gitignore
git commit -m "chore: add env types and local secrets template for auth/billing"
```

---

## Task 7: Auth API routes (signup, login, logout)

**Files:**
- Create: `src/pages/api/auth/signup.ts`
- Create: `src/pages/api/auth/login.ts`
- Create: `src/pages/api/auth/logout.ts`

**Interfaces:**
- Consumes: `createUser`, `verifyUserCredentials` (Task 4), `createSessionToken` (Task 3), `env.SESSION_SECRET` (Task 6).
- Produces: sets/clears an `httpOnly` `session` cookie, used by `entitlements`-gated pages in later tasks to resolve `userId`.

- [ ] **Step 1: Implement signup.ts**

```typescript
// src/pages/api/auth/signup.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createUser } from '../../../lib/users';
import { createSessionToken } from '../../../lib/session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  if (!email || password.length < 8) {
    return redirect('/signup?error=invalid');
  }

  const result = await createUser(email, password);
  if ('error' in result) {
    return redirect('/signup?error=duplicate');
  }

  const token = await createSessionToken(result.id, env.SESSION_SECRET);
  cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  return redirect('/account');
};
```

- [ ] **Step 2: Implement login.ts**

```typescript
// src/pages/api/auth/login.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyUserCredentials } from '../../../lib/users';
import { createSessionToken } from '../../../lib/session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  const userId = await verifyUserCredentials(email, password);
  if (!userId) {
    return redirect('/login?error=invalid');
  }

  const token = await createSessionToken(userId, env.SESSION_SECRET);
  cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  return redirect('/account');
};
```

- [ ] **Step 3: Implement logout.ts**

```typescript
// src/pages/api/auth/logout.ts
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('session', { path: '/' });
  return redirect('/');
};
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, then:
```bash
curl -i -c cookies.txt -d "email=test@example.com&password=password123" http://localhost:4321/api/auth/signup
curl -i -b cookies.txt -c cookies.txt -d "email=test@example.com&password=password123" http://localhost:4321/api/auth/login
```
Expected: both return `302` redirects and set a `session` cookie; login with a wrong password redirects to `/login?error=invalid`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/auth
git commit -m "feat: add signup/login/logout API routes"
```

---

## Task 8: Stripe webhook logic (`src/lib/stripe.ts`)

**Files:**
- Create: `src/lib/stripe.ts`
- Test: `src/lib/__tests__/stripe.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `getStripeClient(secretKey: string): Stripe` — configured with the fetch-based HTTP client for Workers.
- Produces: `mapSubscriptionEvent(event: Stripe.Event): { tier: 'basic' | 'pro' | 'free'; status: string; stripeCustomerId: string; stripeSubscriptionId: string | null; currentPeriodEnd: string | null; userId: string | null } | null` — pure mapping from a Stripe event to the fields `upsertSubscription` needs; returns `null` for event types we don't act on.

- [ ] **Step 1: Install stripe**

```bash
npm install stripe
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/lib/__tests__/stripe.test.ts
import { describe, it, expect } from 'vitest';
import { mapSubscriptionEvent } from '../stripe';
import type Stripe from 'stripe';

function checkoutCompletedEvent(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: 'user-123',
        customer: 'cus_abc',
        subscription: 'sub_abc',
        metadata: { tier: 'basic' },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionUpdatedEvent(status = 'active'): Stripe.Event {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_abc',
        customer: 'cus_abc',
        status,
        current_period_end: 1_800_000_000,
        metadata: { tier: 'pro' },
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionDeletedEvent(): Stripe.Event {
  return {
    type: 'customer.subscription.deleted',
    data: {
      object: { id: 'sub_abc', customer: 'cus_abc' },
    },
  } as unknown as Stripe.Event;
}

describe('mapSubscriptionEvent', () => {
  it('maps checkout.session.completed to an active subscription', () => {
    expect(mapSubscriptionEvent(checkoutCompletedEvent())).toEqual({
      tier: 'basic',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: null,
      userId: 'user-123',
    });
  });

  it('maps customer.subscription.updated to its status and tier', () => {
    expect(mapSubscriptionEvent(subscriptionUpdatedEvent('active'))).toEqual({
      tier: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      userId: null,
    });
  });

  it('maps customer.subscription.deleted to free/canceled', () => {
    expect(mapSubscriptionEvent(subscriptionDeletedEvent())).toEqual({
      tier: 'free',
      status: 'canceled',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      userId: null,
    });
  });

  it('returns null for events it does not handle', () => {
    const event = { type: 'invoice.paid', data: { object: {} } } as unknown as Stripe.Event;
    expect(mapSubscriptionEvent(event)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../stripe'"

- [ ] **Step 4: Implement stripe.ts**

```typescript
// src/lib/stripe.ts
import Stripe from 'stripe';

export function getStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
  });
}

export interface MappedSubscription {
  tier: 'free' | 'basic' | 'pro';
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  userId: string | null;
}

export function mapSubscriptionEvent(event: Stripe.Event): MappedSubscription | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const tier = (session.metadata?.tier as 'basic' | 'pro' | undefined) ?? 'basic';
      return {
        tier,
        status: 'active',
        stripeCustomerId: String(session.customer),
        stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
        currentPeriodEnd: null,
        userId: session.client_reference_id ?? null,
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const tier = (sub.metadata?.tier as 'basic' | 'pro' | undefined) ?? 'basic';
      return {
        tier,
        status: sub.status,
        stripeCustomerId: String(sub.customer),
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        userId: null,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        tier: 'free',
        status: 'canceled',
        stripeCustomerId: String(sub.customer),
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        userId: null,
      };
    }
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/stripe.ts src/lib/__tests__/stripe.test.ts
git commit -m "feat: add Stripe event mapping"
```

---

## Task 9: Stripe API routes (checkout, webhook, portal)

**Files:**
- Create: `src/pages/api/stripe/checkout.ts`
- Create: `src/pages/api/stripe/webhook.ts`
- Create: `src/pages/api/stripe/portal.ts`

**Interfaces:**
- Consumes: `getStripeClient`, `mapSubscriptionEvent` (Task 8), `upsertSubscription`, `getSubscription` (Task 4), `verifySessionToken` (Task 3), `env.STRIPE_SECRET_KEY` / `env.STRIPE_WEBHOOK_SECRET` / `env.STRIPE_PRICE_BASIC` / `env.STRIPE_PRICE_PRO` / `env.SESSION_SECRET` (Task 6).

- [ ] **Step 1: Implement checkout.ts**

```typescript
// src/pages/api/stripe/checkout.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getStripeClient } from '../../../lib/stripe';
import { verifySessionToken } from '../../../lib/session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  if (!userId) return redirect('/login');

  const form = await request.formData();
  const tier = String(form.get('tier') ?? '');
  const priceId = tier === 'pro' ? env.STRIPE_PRICE_PRO : tier === 'basic' ? env.STRIPE_PRICE_BASIC : null;
  if (!priceId) return redirect('/pricing?error=invalid_tier');

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { tier } },
    success_url: `${url.origin}/account?checkout=success`,
    cancel_url: `${url.origin}/pricing?checkout=cancelled`,
  });

  return redirect(checkoutSession.url ?? '/pricing');
};
```

- [ ] **Step 2: Implement webhook.ts**

```typescript
// src/pages/api/stripe/webhook.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getStripeClient, mapSubscriptionEvent } from '../../../lib/stripe';
import { upsertSubscription, getSubscription } from '../../../lib/subscriptions';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();
  if (!signature) return new Response('missing signature', { status: 400 });

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }

  const mapped = mapSubscriptionEvent(event);
  if (!mapped) return new Response('ignored', { status: 200 });

  // checkout.session.completed carries the userId directly; subscription.updated/deleted
  // only carry the Stripe customer id, so look up the existing row by customer id via a
  // linear scan is avoided by requiring checkout to have run first and storing the
  // customer id on that row — resolve userId from the existing subscription record.
  let userId = mapped.userId;
  if (!userId) {
    const existing = await findSubscriptionByCustomerId(mapped.stripeCustomerId);
    userId = existing;
  }
  if (!userId) return new Response('unknown customer', { status: 200 });

  await upsertSubscription({
    userId,
    tier: mapped.tier,
    status: mapped.status,
    stripeCustomerId: mapped.stripeCustomerId,
    stripeSubscriptionId: mapped.stripeSubscriptionId ?? undefined,
    currentPeriodEnd: mapped.currentPeriodEnd ?? undefined,
  });

  return new Response('ok', { status: 200 });
};

async function findSubscriptionByCustomerId(stripeCustomerId: string): Promise<string | null> {
  const { env: cfEnv } = await import('cloudflare:workers');
  const row = await cfEnv.DB
    .prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?')
    .bind(stripeCustomerId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}
```

Note: `getSubscription` is imported for symmetry with the rest of the codebase's lookups but the webhook needs a lookup *by Stripe customer id*, which `subscriptions.ts` doesn't expose — hence the local `findSubscriptionByCustomerId` helper querying `env.DB` directly, matching the raw-D1-access style already used throughout `src/lib/*.ts`.

- [ ] **Step 3: Implement portal.ts**

```typescript
// src/pages/api/stripe/portal.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getStripeClient } from '../../../lib/stripe';
import { verifySessionToken } from '../../../lib/session';
import { getSubscription } from '../../../lib/subscriptions';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, url }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  if (!userId) return redirect('/login');

  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) return redirect('/pricing');

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${url.origin}/account`,
  });

  return redirect(portalSession.url);
};
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, then use the Stripe CLI in test mode:
```bash
stripe listen --forward-to localhost:4321/api/stripe/webhook
stripe trigger checkout.session.completed
```
Expected: webhook route returns `200`; a row appears in `subscriptions` for the triggered event (check via `wrangler d1 execute inspire-readings --local --command "select * from subscriptions"`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/stripe
git commit -m "feat: add Stripe checkout/webhook/portal routes"
```

---

## Task 10: Gate drawing by entitlements in index.astro

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `canDraw`, `recordDraw`, `SPREAD_ACCESS`, `resolveTier` (Task 5), `verifySessionToken` (Task 3), `env.SESSION_SECRET` (Task 6).

- [ ] **Step 1: Resolve the identity used for entitlements**

In `src/pages/index.astro`, near the top of the frontmatter (after the existing `lang` resolution), add:

```typescript
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../lib/session';
import { canDraw, recordDraw, resolveTier, SPREAD_ACCESS, type Tier } from '../lib/entitlements';

const sessionCookie = Astro.cookies.get('session')?.value;
const loggedInUserId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
```

- [ ] **Step 2: Use the resolved identity (logged-in user or anon cookie) for entitlement checks**

Inside the existing `if (Astro.request.method === 'POST')` block, right after `userId` is resolved (the existing anonymous-cookie block), add:

```typescript
const entitlementUserId = loggedInUserId ?? userId;
const entitlement = await canDraw(entitlementUserId, spreadKey);
```

Then wrap the existing draw/interpret/log logic: replace the current unconditional drawing code with:

```typescript
if (!entitlement.ok) {
  error =
    entitlement.reason === 'spread_locked'
      ? lang === 'zh'
        ? '此牌阵需要升级订阅'
        : 'This spread requires a paid plan'
      : lang === 'zh'
        ? '今日次数已用完，请升级订阅'
        : "You've used today's free draws — upgrade for more";
} else {
  // existing deck/drawCards/generateInterpretation/generateFollowUpQuestions/logReading block goes here, unchanged
  await recordDraw(entitlementUserId);
}
```

- [ ] **Step 3: Compute the current tier for the spread picker UI**

Add, alongside the other GET/POST-independent frontmatter:

```typescript
const currentTier: Tier = await resolveTier(loggedInUserId ?? Astro.cookies.get('user_id')?.value ?? '');
```

- [ ] **Step 4: Lock unavailable spreads in the picker**

In the spread-picker markup, change:

```astro
{Object.entries(SPREADS).map(([key, s]) => (
  <div class={`spread-option ${spreadKey === key ? 'selected' : ''}`} data-spread={key}>
```

to:

```astro
{Object.entries(SPREADS).map(([key, s]) => {
  const locked = !SPREAD_ACCESS[currentTier].includes(key);
  return (
    <div
      class={`spread-option ${spreadKey === key ? 'selected' : ''} ${locked ? 'locked' : ''}`}
      data-spread={key}
      data-locked={locked ? 'true' : 'false'}
    >
```

(closing the map with `);})` and adding a locked badge inside — e.g. `{locked && <span class="tier-badge">Pro</span>}` — plus a CSS rule in `src/styles/global.css` dimming `.spread-option.locked` and disabling pointer events, and a link to `/pricing` in place of selection for locked options in the existing `selectSpread` script (skip `selectSpread` when `data-locked === 'true'` and navigate to `/pricing` instead).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. As an anonymous user, draw 3 single-card readings, then a 4th — expect the quota upsell message. Attempt to select the 3-card spread — expect it locked with a link to `/pricing`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro src/styles/global.css
git commit -m "feat: gate drawing by tier entitlements"
```

---

## Task 11: Signup and login pages

**Files:**
- Create: `src/pages/signup.astro`
- Create: `src/pages/login.astro`

**Interfaces:**
- Consumes: `Layout` from `src/layouts/Layout.astro`, posts to `/api/auth/signup` and `/api/auth/login` (Task 7).

- [ ] **Step 1: Implement signup.astro**

```astro
---
export const prerender = false;
import Layout from '../layouts/Layout.astro';

const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';
const error = url.searchParams.get('error');
---
<Layout title={lang === 'zh' ? '注册' : 'Sign up'}>
  <h1>{lang === 'zh' ? '注册' : 'Sign up'}</h1>
  {error === 'duplicate' && <p class="error">{lang === 'zh' ? '该邮箱已注册' : 'That email is already registered'}</p>}
  {error === 'invalid' && <p class="error">{lang === 'zh' ? '邮箱或密码无效（密码至少8位）' : 'Invalid email or password (password must be 8+ characters)'}</p>}
  <form method="post" action="/api/auth/signup">
    <p><input type="email" name="email" placeholder={lang === 'zh' ? '邮箱' : 'Email'} required /></p>
    <p><input type="password" name="password" placeholder={lang === 'zh' ? '密码' : 'Password'} minlength="8" required /></p>
    <button type="submit">{lang === 'zh' ? '注册' : 'Sign up'}</button>
  </form>
  <p><a href={`/login?lang=${lang}`}>{lang === 'zh' ? '已有账号？登录' : 'Already have an account? Log in'}</a></p>
</Layout>
```

- [ ] **Step 2: Implement login.astro**

```astro
---
export const prerender = false;
import Layout from '../layouts/Layout.astro';

const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';
const error = url.searchParams.get('error');
---
<Layout title={lang === 'zh' ? '登录' : 'Log in'}>
  <h1>{lang === 'zh' ? '登录' : 'Log in'}</h1>
  {error === 'invalid' && <p class="error">{lang === 'zh' ? '邮箱或密码错误' : 'Invalid email or password'}</p>}
  <form method="post" action="/api/auth/login">
    <p><input type="email" name="email" placeholder={lang === 'zh' ? '邮箱' : 'Email'} required /></p>
    <p><input type="password" name="password" placeholder={lang === 'zh' ? '密码' : 'Password'} required /></p>
    <button type="submit">{lang === 'zh' ? '登录' : 'Log in'}</button>
  </form>
  <p><a href={`/signup?lang=${lang}`}>{lang === 'zh' ? '没有账号？注册' : "Don't have an account? Sign up"}</a></p>
</Layout>
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, visit `/signup`, submit the form, confirm redirect to `/account` (will 404 until Task 12 — that's expected here) with a `session` cookie set.

- [ ] **Step 4: Commit**

```bash
git add src/pages/signup.astro src/pages/login.astro
git commit -m "feat: add signup and login pages"
```

---

## Task 12: Pricing and account pages

**Files:**
- Create: `src/pages/pricing.astro`
- Create: `src/pages/account.astro`

**Interfaces:**
- Consumes: `resolveTier`, `getTodayUsage`, `QUOTA` (Tasks 4/5), `verifySessionToken` (Task 3), posts to `/api/stripe/checkout` and `/api/stripe/portal` (Task 9), `/api/auth/logout` (Task 7).

- [ ] **Step 1: Implement pricing.astro**

```astro
---
export const prerender = false;
import Layout from '../layouts/Layout.astro';

const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';

const tiers = [
  { key: 'free', name: { zh: '免费', en: 'Free' }, price: { zh: '¥0', en: '$0' }, blurb: { zh: '单张牌，每日3次', en: 'Single card, 3 draws/day' } },
  { key: 'basic', name: { zh: '基础版', en: 'Basic' }, price: { zh: '¥28/月', en: '$4.99/mo' }, blurb: { zh: '单张/三张牌，每日20次，历史记录', en: 'Single/3-card, 20 draws/day, history' } },
  { key: 'pro', name: { zh: '专业版', en: 'Pro' }, price: { zh: '¥68/月', en: '$11.99/mo' }, blurb: { zh: '全部牌阵，无限次数，历史记录', en: 'All spreads, unlimited draws, history' } },
];
---
<Layout title={lang === 'zh' ? '价格' : 'Pricing'}>
  <h1>{lang === 'zh' ? '价格' : 'Pricing'}</h1>
  <div class="pricing-grid">
    {tiers.map((t) => (
      <div class="pricing-card">
        <h2>{t.name[lang]}</h2>
        <p class="price">{t.price[lang]}</p>
        <p>{t.blurb[lang]}</p>
        {t.key !== 'free' && (
          <form method="post" action="/api/stripe/checkout">
            <input type="hidden" name="tier" value={t.key} />
            <button type="submit">{lang === 'zh' ? '订阅' : 'Subscribe'}</button>
          </form>
        )}
      </div>
    ))}
  </div>
</Layout>
```

- [ ] **Step 2: Implement account.astro**

```astro
---
export const prerender = false;
import Layout from '../layouts/Layout.astro';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../lib/session';
import { resolveTier, getTodayUsage, QUOTA } from '../lib/entitlements';

const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';

const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
if (!userId) return Astro.redirect(`/login?lang=${lang}`);

const tier = await resolveTier(userId);
const usedToday = await getTodayUsage(userId);
const quota = QUOTA[tier];
---
<Layout title={lang === 'zh' ? '账户' : 'Account'}>
  <h1>{lang === 'zh' ? '账户' : 'Account'}</h1>
  <p>{lang === 'zh' ? '当前套餐：' : 'Current plan: '}<strong>{tier}</strong></p>
  <p>{lang === 'zh' ? '今日已用：' : 'Used today: '}{usedToday} / {quota === Infinity ? (lang === 'zh' ? '无限' : 'unlimited') : quota}</p>
  {tier !== 'free' && (
    <form method="post" action="/api/stripe/portal">
      <button type="submit">{lang === 'zh' ? '管理订阅' : 'Manage subscription'}</button>
    </form>
  )}
  <p><a href={`/history?lang=${lang}`}>{lang === 'zh' ? '查看历史记录' : 'View history'}</a></p>
  <form method="post" action="/api/auth/logout">
    <button type="submit">{lang === 'zh' ? '登出' : 'Log out'}</button>
  </form>
</Layout>
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, sign up, visit `/account` — expect `tier: free`, `Used today: 0 / 3`. Visit `/pricing`, submit a tier — expect redirect to Stripe-hosted checkout.

- [ ] **Step 4: Commit**

```bash
git add src/pages/pricing.astro src/pages/account.astro
git commit -m "feat: add pricing and account pages"
```

---

## Task 13: Reading history page

**Files:**
- Create: `src/pages/history/index.astro`
- Modify: `src/lib/db.ts`

**Interfaces:**
- Consumes: `resolveTier` (Task 5), `verifySessionToken` (Task 3).
- Produces (added to `db.ts`): `getReadingsForUser(userId: string, limit?: number): Promise<Array<{ id: number; question: string; cards: string; interpretation: string; timestamp: string }>>`.

- [ ] **Step 1: Add getReadingsForUser to db.ts**

Append to `src/lib/db.ts`:

```typescript
export async function getReadingsForUser(
  userId: string,
  limit = 50
): Promise<Array<{ id: number; question: string; cards: string; interpretation: string; timestamp: string }>> {
  const db = env.DB;
  await ensureTable(db);
  const result = await db
    .prepare(
      'SELECT id, question, cards, interpretation, timestamp FROM drawing_sessions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
    )
    .bind(userId, limit)
    .all<{ id: number; question: string; cards: string; interpretation: string; timestamp: string }>();
  return result.results ?? [];
}
```

- [ ] **Step 2: Implement history/index.astro**

```astro
---
export const prerender = false;
import Layout from '../../layouts/Layout.astro';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../../lib/session';
import { resolveTier } from '../../lib/entitlements';
import { getReadingsForUser } from '../../lib/db';

const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';

const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
if (!userId) return Astro.redirect(`/login?lang=${lang}`);

const tier = await resolveTier(userId);
if (tier === 'free') return Astro.redirect(`/pricing?lang=${lang}`);

const readings = await getReadingsForUser(userId);
---
<Layout title={lang === 'zh' ? '历史记录' : 'History'}>
  <h1>{lang === 'zh' ? '历史记录' : 'History'}</h1>
  {readings.length === 0 && <p>{lang === 'zh' ? '暂无记录' : 'No readings yet'}</p>}
  <ul class="history-list">
    {readings.map((r) => (
      <li>
        <p class="history-date">{r.timestamp}</p>
        <p class="history-question">{r.question}</p>
        <p class="history-cards">{r.cards}</p>
        <p class="history-interp">{r.interpretation}</p>
      </li>
    ))}
  </ul>
</Layout>
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. As a free-tier logged-in user, visit `/history` — expect redirect to `/pricing`. After manually setting a `basic`/`pro` row in `subscriptions` (via `wrangler d1 execute inspire-readings --local --command "..."`), visit `/history` again — expect the reading list.

- [ ] **Step 4: Commit**

```bash
git add src/pages/history src/lib/db.ts
git commit -m "feat: add gated reading history page"
```

---

## Post-implementation (not part of this plan's tasks — operator steps)

- Run `wrangler secret put SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO` against the deployed Worker before going live.
- Configure the Stripe webhook endpoint (`https://<deployed-host>/api/stripe/webhook`) in the Stripe Dashboard once deployed, and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
- The spec's deferred item (pruning old `usage_daily` rows via a Workers cron) is out of scope for this plan — file as a follow-up if D1 row growth becomes a concern.
