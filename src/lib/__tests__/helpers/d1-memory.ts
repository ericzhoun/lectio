// In-memory D1Database-compatible shim backed by node:sqlite.
// Lets users.ts / subscriptions.ts run real SQL in vitest (node environment).
import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | null | bigint | Uint8Array;

const toSqlValue = (a: unknown): SqlValue => (a === undefined ? null : (a as SqlValue));

export class D1Memory {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
  }

  close() {
    this.db.close();
  }

  async exec(sql: string): Promise<{ success: boolean }> {
    this.db.exec(sql);
    return { success: true };
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    const raw = (...args: unknown[]) => {
      const clean = args.map((a) => {
        if (a === undefined) return null;
        if (typeof a === 'boolean') return a ? 1 : 0;
        return a as SqlValue;
      });
      return stmt.run(...clean);
    };
    return {
      bind: (...args: unknown[]) => ({
        first: async <T = Record<string, unknown>>(): Promise<T | null> => {
          const rows = this.db.prepare(sql).all(...args.map(toSqlValue)) as Array<
            Record<string, unknown>
          >;
          return (rows[0] as T) ?? null;
        },
        run: async () => {
          const info = raw(...args);
          return { success: true, meta: { changes: Number(info.changes) } };
        },
        all: async <T = Record<string, unknown>>() => {
          const rows = this.db.prepare(sql).all(...args.map(toSqlValue)) as T[];
          return { success: true, results: rows, meta: {} };
        },
      }),
      run: (...args: unknown[]) => {
        const info = raw(...args);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
      first: <T = Record<string, unknown>>(...args: unknown[]) => {
        const rows = this.db.prepare(sql).all(...args.map(toSqlValue)) as Array<
          Record<string, unknown>
        >;
        return (rows[0] as T) ?? null;
      },
      all: <T = Record<string, unknown>>(...args: unknown[]) => {
        return this.db.prepare(sql).all(...args.map(toSqlValue)) as T[];
      },
    };
  }

  async batch(statements: Array<{ run: (...args: never[]) => Promise<unknown> }>) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results.map(() => ({ success: true }));
  }

  dump(sql: string): unknown[] {
    return this.db.prepare(sql).all() as unknown[];
  }
}
