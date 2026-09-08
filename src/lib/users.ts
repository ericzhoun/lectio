import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword } from './crypto';
import { upsertSubscription } from './subscriptions';
import { grantWelcomeCredits } from './credits';

// users table schema (Google login support):
//   id             TEXT PRIMARY KEY        — internal user id (UUID)
//   email          TEXT NOT NULL UNIQUE    — verified email (Google) or account email
//   password_hash  TEXT                    — password hash; '' for Google-only accounts (never authenticates)
//   google_id      TEXT UNIQUE             — Google subject id; NULL for password accounts
//   name           TEXT                    — display name (from Google profile or NULL)
//   avatar_url     TEXT                    — Google profile picture URL
//   created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
//   last_login_at  DATETIME                — updated on every successful sign-in
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_id TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
)`;

// Migrations applied to databases created before Google login support.
// Each ALTER is idempotent: a "duplicate column" error means it is already applied.
const MIGRATIONS: string[] = [
  'ALTER TABLE users ADD COLUMN google_id TEXT',
  'ALTER TABLE users ADD COLUMN name TEXT',
  'ALTER TABLE users ADD COLUMN avatar_url TEXT',
  'ALTER TABLE users ADD COLUMN last_login_at DATETIME',
  'ALTER TABLE users ADD COLUMN role TEXT',
];

const initializedDbs = new WeakSet<object>();

async function ensureTable(db: D1Database): Promise<void> {
  if (initializedDbs.has(db as object)) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  for (const sql of MIGRATIONS) {
    try {
      await db.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column/i.test(msg)) throw e;
    }
  }
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
  initializedDbs.add(db as object);
}

export interface UserRecord {
  id: string;
  email: string;
  googleId: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
}

export async function createUser(
  email: string,
  password: string,
  db: D1Database = env.DB
): Promise<{ id: string } | { error: 'duplicate' }> {
  await ensureTable(db);
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return { error: 'duplicate' };

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await db
    .prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .bind(id, email, passwordHash)
    .run();
  await upsertSubscription({ userId: id, tier: 'free', status: 'active' });
  await grantWelcomeCredits(id, db); // registration perk: one-time multi-card trial credits
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

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Register or sign in a Google account.
 *
 * Matching order (keeps accounts unique, never duplicates, never overwrites data):
 * 1. existing row with the same google_id  -> update name/avatar/last_login, return it
 * 2. existing row with the same verified email (a password account) -> link google_id to it
 * 3. otherwise create a new user record
 *
 * Returns `isNew: true` only when a brand-new record was created.
 */
export async function upsertGoogleUser(
  profile: GoogleProfile,
  db: D1Database = env.DB
): Promise<{ id: string; isNew: boolean }> {
  await ensureTable(db);

  const byGoogleId = await db
    .prepare('SELECT id FROM users WHERE google_id = ?')
    .bind(profile.googleId)
    .first<{ id: string }>();
  if (byGoogleId) {
    await db
      .prepare("UPDATE users SET name = ?, avatar_url = ?, last_login_at = datetime('now') WHERE id = ?")
      .bind(profile.name, profile.avatarUrl, byGoogleId.id)
      .run();
    return { id: byGoogleId.id, isNew: false };
  }

  const byEmail = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(profile.email)
    .first<{ id: string }>();
  if (byEmail) {
    await db
      .prepare(
        "UPDATE users SET google_id = ?, name = ?, avatar_url = ?, last_login_at = datetime('now') WHERE id = ?"
      )
      .bind(profile.googleId, profile.name, profile.avatarUrl, byEmail.id)
      .run();
    return { id: byEmail.id, isNew: false };
  }

  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO users (id, email, password_hash, google_id, name, avatar_url, last_login_at) VALUES (?, ?, '', ?, ?, ?, datetime('now'))"
      )
      .bind(id, profile.email, profile.googleId, profile.name, profile.avatarUrl)
      .run();
  } catch (e) {
    // Lost a race with a concurrent callback creating the same account: match it instead.
    const raced = await db
      .prepare('SELECT id FROM users WHERE google_id = ? OR email = ?')
      .bind(profile.googleId, profile.email)
      .first<{ id: string }>();
    if (!raced) throw e;
    await db
      .prepare(
        "UPDATE users SET google_id = ?, name = ?, avatar_url = ?, last_login_at = datetime('now') WHERE id = ?"
      )
      .bind(profile.googleId, profile.name, profile.avatarUrl, raced.id)
      .run();
    return { id: raced.id, isNew: false };
  }

  await upsertSubscription({ userId: id, tier: 'free', status: 'active' });
  await grantWelcomeCredits(id, db); // registration perk: one-time multi-card trial credits
  return { id, isNew: true };
}

/** Touch last_login_at after any successful sign-in. */
export async function recordLogin(userId: string, db: D1Database = env.DB): Promise<void> {
  await ensureTable(db);
  await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(userId).run();
}

/** Fetch a single user record (used by the account page and audit paths). */
export async function getUserById(userId: string, db: D1Database = env.DB): Promise<UserRecord | null> {
  return getUserByColumn('id', userId, db);
}

/** Audit query: find a user by email. */
export async function getUserByEmail(email: string, db: D1Database = env.DB): Promise<UserRecord | null> {
  return getUserByColumn('email', email, db);
}

async function getUserByColumn(
  column: 'id' | 'email',
  value: string,
  db: D1Database
): Promise<UserRecord | null> {
  await ensureTable(db);
  const row = await db
    .prepare(
      `SELECT id, email, google_id, name, avatar_url, role, created_at, last_login_at FROM users WHERE ${column} = ?`
    )
    .bind(value)
    .first<{
      id: string;
      email: string;
      google_id: string | null;
      name: string | null;
      avatar_url: string | null;
      role: string | null;
      created_at: string | null;
      last_login_at: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    googleId: row.google_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/** Audit query: list the most recent user records (newest first). */
export async function listUsers(limit = 100, db: D1Database = env.DB): Promise<UserRecord[]> {
  await ensureTable(db);
  const result = await db
    .prepare(
      'SELECT id, email, google_id, name, avatar_url, role, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT ?'
    )
    .bind(limit)
    .all<{
      id: string;
      email: string;
      google_id: string | null;
      name: string | null;
      avatar_url: string | null;
      role: string | null;
      created_at: string | null;
      last_login_at: string | null;
    }>();
  return (result.results ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    googleId: r.google_id,
    name: r.name,
    avatarUrl: r.avatar_url,
    role: r.role,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }));
}

/** Admin dashboard action: grant or revoke the admin role. */
export async function setUserRole(
  userId: string,
  role: 'user' | 'admin',
  db: D1Database = env.DB
): Promise<void> {
  await ensureTable(db);
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
}
