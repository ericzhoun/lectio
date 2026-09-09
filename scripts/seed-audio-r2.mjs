#!/usr/bin/env node
// Seeds the R2 bucket (lectio-audio) with every prebuilt clip the manifests
// promise, so /audio/* and /api/tts can serve them and a deploy never needs
// the audio corpus on the build machine.
//
// Source priority per clip: a local public/audio file first (the machine that
// synthesized them), then the currently deployed site, which holds a complete
// copy. Uploads go through `wrangler r2 object put`, which uses your existing
// wrangler login - no extra credentials.
//
// Resumable: uploaded keys are recorded in scripts/.audio-r2-state.json
// (gitignored), so re-runs upload only what is missing. Keys that are done
// are written to src/lib/audioR2Manifest.json, which check-build-output.mjs
// gates deploys on.
//
// Flags:
//   --dry-run            list what would be uploaded, change nothing
//   --only <prefix>      limit to keys starting with <prefix> (e.g. steps/)
//   --concurrency <n>    parallel uploads (default 8)
//   --force              re-upload keys already recorded as done
//   --source <url>       site to fetch clips from when absent locally
//                        (default: https://enjoyhim.org)
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'lectio-audio';
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const STATE_FILE = join(ROOT, 'scripts/.audio-r2-state.json');
const OUT_MANIFEST = join(ROOT, 'src/lib/audioR2Manifest.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dryRun = flag('dry-run');
const force = flag('force');
const only = value('only', '');
const concurrency = Math.max(1, parseInt(value('concurrency', '8'), 10) || 8);
const sourceBase = (value('source', 'https://enjoyhim.org') || '').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// 1. Expected keys, straight from the manifests (the source of truth).
// ---------------------------------------------------------------------------
const steps = JSON.parse(readFileSync(join(ROOT, 'src/lib/audioSteps.json'), 'utf8'));
const days = JSON.parse(readFileSync(join(ROOT, 'src/lib/audioDays.json'), 'utf8'));
const expected = [];
for (const clips of Object.values(steps.steps)) {
  for (const clip of Object.values(clips)) {
    if (clip) expected.push(clip.file.replace(/^\/audio\//, ''));
  }
}
for (const [day, langs] of Object.entries(days.days)) {
  for (const lang of langs) expected.push(`days/${lang}/${day}.mp3`);
}

// ---------------------------------------------------------------------------
// 2. What still needs uploading.
// ---------------------------------------------------------------------------
let done = new Set();
if (existsSync(STATE_FILE) && !force) {
  try {
    done = new Set(JSON.parse(readFileSync(STATE_FILE, 'utf8')).done);
  } catch {
    done = new Set(); // corrupt state: start over
  }
}
const todo = expected.filter((key) => key.startsWith(only) && (force || !done.has(key)));

console.log(
  `manifests promise ${expected.length} clips; ` +
    `${done.size} recorded as uploaded; ` +
    `${todo.length} to upload${only ? ` (filtered by --only "${only}")` : ''}` +
    `${dryRun ? ' [dry run]' : ''}`
);
if (dryRun) {
  for (const key of todo.slice(0, 20)) console.log(`  would upload ${key}`);
  if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);
  process.exit(0);
}
if (todo.length === 0) {
  writeManifest(done);
  console.log('nothing to upload; audioR2Manifest.json is up to date');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3. Upload queue: download (local disk first, then the live site), then
//    `wrangler r2 object put`. Retries each clip up to 3 times.
// ---------------------------------------------------------------------------
const tmpDir = mkdtempSync(join(tmpdir(), 'lectio-audio-'));
let completed = 0;
let failed = 0;
const failures = [];

async function uploadOne(key) {
  const local = join(ROOT, 'public/audio', key);
  let tmp = null;
  try {
    let from = local;
    if (!existsSync(local)) {
      const res = await fetch(`${sourceBase}/audio/${key}`);
      if (!res.ok) throw new Error(`source ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('audio/')) throw new Error(`source content-type "${type}"`);
      tmp = join(tmpDir, key.replaceAll('/', '__'));
      writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      from = tmp;
    }
    await runWranglerPut(key, from);
    done.add(key);
    completed++;
    if (completed % 50 === 0 || completed === todo.length) {
      console.log(`  ${completed}/${todo.length} uploaded`);
    }
  } finally {
    if (tmp) rmSync(tmp, { force: true });
  }
}

function runWranglerPut(key, file) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(
      process.execPath,
      // --remote is required: without it wrangler writes to the local miniflare
      // simulation, and the deployed Worker sees an empty bucket.
      [WRANGLER, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', 'audio/mpeg', '--remote'],
      { stdio: ['ignore', 'ignore', 'pipe'], cwd: ROOT },
    );
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', rejectP);
    child.on('exit', (code) =>
      code === 0 ? resolveP() : rejectP(new Error(`wrangler exit ${code}: ${stderr.slice(-300)}`)),
    );
  });
}

async function withRetries(key) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await uploadOne(key);
      return;
    } catch (err) {
      if (attempt === 3) {
        failed++;
        failures.push({ key, error: String(err?.message ?? err).slice(0, 300) });
        console.error(`  FAILED ${key}: ${String(err?.message ?? err).slice(0, 200)}`);
      } else {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
}

let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const key = todo[cursor++];
    await withRetries(key);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

// ---------------------------------------------------------------------------
// 4. Persist progress + the deploy-gating manifest.
// ---------------------------------------------------------------------------
mkdirSync(dirname(STATE_FILE), { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify({ done: [...done].sort() }, null, 2));
writeManifest(done);
rmSync(tmpDir, { recursive: true, force: true });

console.log(`done: ${completed} uploaded, ${failed} failed, ${done.size} total recorded`);
if (failures.length > 0) {
  console.error('\nFailed keys (re-run this script to retry):');
  for (const f of failures) console.error(`  - ${f.key}`);
  process.exit(1);
}

function writeManifest(doneSet) {
  // The manifest mirrors reality: only keys that are in the current manifests
  // AND recorded as uploaded. check-build-output.mjs gates deploys on it.
  const keys = expected.filter((key) => doneSet.has(key)).sort();
  writeFileSync(
    OUT_MANIFEST,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        bucket: BUCKET,
        keys,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${OUT_MANIFEST} (${keys.length} keys)`);
}
