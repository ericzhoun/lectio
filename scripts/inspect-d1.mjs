// Inspect a local D1 sqlite file (dev-only debug helper)
import { DatabaseSync } from 'node:sqlite';
const file = process.argv[2];
const db = new DatabaseSync(file, { readOnly: true });
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('tables:', JSON.stringify(tables));
  for (const t of tables) {
    if (t.name.startsWith('sqlite_')) continue;
    try {
      const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
      console.log(`\n[${t.name}] cols:`, JSON.stringify(cols.map((c) => c.name)));
      const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 20`).all();
      console.log(`[${t.name}] rows:`, JSON.stringify(rows, null, 1));
    } catch (e) {
      console.log(`[${t.name}] ERR`, e.message);
    }
  }
} finally {
  db.close();
}
