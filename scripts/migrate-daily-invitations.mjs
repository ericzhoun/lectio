// Adds tz, status and last_sent to an existing daily_invitations table.
// SQLite has no ADD COLUMN IF NOT EXISTS, so read the table first and add only
// what is missing. Safe to run more than once.
//
// Usage: node scripts/migrate-daily-invitations.mjs [--local]
import { execFileSync } from 'node:child_process';

const DB = 'lectio-readings';
const local = process.argv.includes('--local');

const COLUMNS = [
  ["tz", "ALTER TABLE daily_invitations ADD COLUMN tz TEXT NOT NULL DEFAULT 'America/Los_Angeles'"],
  ["status", "ALTER TABLE daily_invitations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ["last_sent", "ALTER TABLE daily_invitations ADD COLUMN last_sent TEXT"],
];

function d1(sql) {
  const args = ['wrangler', 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql];
  return execFileSync('npx', args, { encoding: 'utf8' });
}

const info = JSON.parse(d1('PRAGMA table_info(daily_invitations)'));
const existing = new Set((info[0]?.results ?? []).map((row) => row.name));

if (existing.size === 0) {
  console.error('daily_invitations does not exist yet; the signup route creates it on first use.');
  process.exit(1);
}

for (const [name, sql] of COLUMNS) {
  if (existing.has(name)) {
    console.log(`ok: ${name} already present`);
    continue;
  }
  d1(sql);
  console.log(`added: ${name}`);
}

console.log(d1('SELECT email, lang, tz, status, last_sent FROM daily_invitations'));
