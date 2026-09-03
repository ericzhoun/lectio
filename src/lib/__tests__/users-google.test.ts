import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
  recordLogin,
  upsertGoogleUser,
} from '../users';
import { verifyPassword } from '../crypto';

let db: D1Memory;

beforeAll(() => {
  db = new D1Memory();
});

afterAll(() => {
  db.close();
});

describe('users table (Google login support)', () => {
  it('creates the table with all Google fields (fresh database)', async () => {
    await getUserByEmail('nobody@example.com', db as never); // triggers ensureTable
    const cols = db.dump('PRAGMA table_info(users)') as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['avatar_url', 'created_at', 'email', 'google_id', 'id', 'last_login_at', 'name', 'password_hash']);
  });

  it('registers a new Google user with a complete record', async () => {
    const { id, isNew } = await upsertGoogleUser(
      { googleId: 'google-111', email: 'alice@gmail.com', name: 'Alice', avatarUrl: 'https://a/p.png' },
      db as never
    );
    expect(isNew).toBe(true);

    const row = await getUserById(id, db as never);
    expect(row).toMatchObject({
      id,
      email: 'alice@gmail.com',
      googleId: 'google-111',
      name: 'Alice',
      avatarUrl: 'https://a/p.png',
    });
    expect(row?.createdAt).toBeTruthy();
    expect(row?.lastLoginAt).toBeTruthy();
  });

  it('does not create duplicates on repeated sign-ins; updates last login only', async () => {
    const first = await getUserByEmail('alice@gmail.com', db as never);
    const createdBefore = first?.createdAt;

    const { id, isNew } = await upsertGoogleUser(
      { googleId: 'google-111', email: 'alice@gmail.com', name: 'Alice Renamed', avatarUrl: null },
      db as never
    );
    expect(isNew).toBe(false);
    expect(id).toBe(first?.id);

    const rows = db.dump("SELECT * FROM users WHERE google_id = 'google-111'") as Array<{
      id: string;
      created_at: string;
      last_login_at: string;
      name: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBe(createdBefore); // created_at never changes
    expect(rows[0].name).toBe('Alice Renamed'); // profile refresh is fine
    expect(rows[0].last_login_at >= createdBefore!).toBe(true);
  });

  it('links a Google account to an existing password account by verified email', async () => {
    const created = await createUser('bob@gmail.com', 'password-123', db as never);
    const id = 'id' in created ? created.id : '';
    expect(id).toBeTruthy();

    const { id: linkedId, isNew } = await upsertGoogleUser(
      { googleId: 'google-222', email: 'bob@gmail.com', name: 'Bob', avatarUrl: null },
      db as never
    );
    expect(isNew).toBe(false);
    expect(linkedId).toBe(id);

    const rows = db.dump("SELECT * FROM users WHERE email = 'bob@gmail.com'") as unknown[];
    expect(rows).toHaveLength(1); // still one account, no duplicate
    const row = rows[0] as { google_id: string | null };
    expect(row.google_id).toBe('google-222');
  });

  it('handles concurrent registrations of the same Google account without duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        upsertGoogleUser(
          { googleId: 'google-333', email: 'carol@gmail.com', name: 'Carol', avatarUrl: null },
          db as never
        )
      )
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const rows = db.dump("SELECT * FROM users WHERE google_id = 'google-333'") as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('recordLogin updates last_login_at', async () => {
    const user = await getUserByEmail('carol@gmail.com', db as never);
    const before = user?.lastLoginAt;
    await recordLogin(user!.id, db as never);
    const after = (await getUserById(user!.id, db as never))?.lastLoginAt;
    expect(after).toBeTruthy();
    expect(after! >= before!).toBe(true);
  });

  it('Google-only accounts cannot authenticate with a password (empty hash is inert)', async () => {
    const row = db.dump("SELECT password_hash FROM users WHERE email = 'alice@gmail.com'") as Array<{
      password_hash: string;
    }>;
    expect(row[0].password_hash).toBe('');
    expect(await verifyPassword('anything', row[0].password_hash)).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });

  it('lists users for audit with newest first', async () => {
    const users = await listUsers(100, db as never);
    expect(users.length).toBeGreaterThanOrEqual(3);
    const createdAt = users.map((u) => u.createdAt ?? '');
    const sorted = [...createdAt].sort().reverse();
    expect(createdAt).toEqual(sorted);
    const alice = users.find((u) => u.email === 'alice@gmail.com');
    expect(alice?.googleId).toBe('google-111');
  });
});
