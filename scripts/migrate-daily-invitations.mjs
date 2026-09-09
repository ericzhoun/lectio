// Adds tz, status and last_sent to an existing daily_invitations table.
// SQLite has no ADD COLUMN IF NOT EXISTS, so read the table first and add only
// what is missing. Safe to run more than once.
//
// Usage: node scripts/migrate-daily-invitations.mjs [--local]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DB = 'lectio-readings';
const local = process.argv.includes('--local');

// `npx`/`wrangler` resolve to .cmd shims on Windows, and Node refuses to
// spawnSync a .cmd file directly (EINVAL) without shell: true - but shell:
// true then hands the SQL string to cmd.exe, which splits it on the
// parentheses and spaces in "PRAGMA table_info(daily_invitations)" before
// wrangler ever sees it as one argument. Invoking wrangler's own entry
// script through `node` sidesteps both problems: it is a plain .js file, so
// it spawns without a shell on every platform, and each element of `args`
// reaches wrangler exactly as written, with no shell re-splitting it.
const WRANGLER_JS = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  'node_modules', 'wrangler', 'bin', 'wrangler.js'
);

function d1(sql) {
  const args = [WRANGLER_JS, 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql];
  return execFileSync(process.execPath, args, { encoding: 'utf8' });
}

const COLUMNS = [
  ["tz", "ALTER TABLE daily_invitations ADD COLUMN tz TEXT NOT NULL DEFAULT 'America/Los_Angeles'"],
  ["status", "ALTER TABLE daily_invitations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ["last_sent", "ALTER TABLE daily_invitations ADD COLUMN last_sent TEXT"],
];

const info = JSON.parse(d1('PRAGMA table_info(daily_invitations)'));
const existing = new Set((info[0]?.results ?? []).map((row) => row.name));

if (existing.size === 0) {
  console.error('daily_invitations does not exist yet; the signup route creates it on first use.');
  process.exit(1);
}

const done = [];
const remaining = COLUMNS.map(([name]) => name).filter((name) => !existing.has(name));

for (const [name, sql] of COLUMNS) {
  if (existing.has(name)) {
    console.log(`ok: ${name} already present`);
    continue;
  }
  try {
    d1(sql);
  } catch (e) {
    // A crash here leaves the table in a perfectly resumable state: the next
    // run's PRAGMA read will see exactly the columns that landed and skip
    // them. An operator watching this against live data needs that spelled
    // out, not a bare stack trace.
    console.error(`failed adding column: ${name}`);
    console.error(e.message ?? e);
    console.error(`completed this run: ${done.length ? done.join(', ') : '(none)'}`);
    console.error(`still missing: ${remaining.join(', ')}`);
    console.error('The table is left in a valid, resumable state. Re-run this script; ' +
      'it only adds columns that are still missing, so it is safe to run again.');
    process.exit(1);
  }
  done.push(name);
  remaining.splice(remaining.indexOf(name), 1);
  console.log(`added: ${name}`);
}

console.log(d1('SELECT email, lang, tz, status, last_sent FROM daily_invitations'));
