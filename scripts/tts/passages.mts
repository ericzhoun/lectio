// Batch-generate the day's-passage audio for the lectionary with the local
// Chatterbox model. Resumable: anything already on disk is skipped, so this is
// run repeatedly to chew through the backlog (next few days first, then fill
// the rest whenever the GPU is free).
//
//   npm run tts:passages -- --next 7              # from today, a week ahead
//   npm run tts:passages -- --from 2026-10-01 --days 30
//   npm run tts:passages -- --all --yes           # the whole 1826-day table
//
// Output: public/audio/days/<lang>/<day>.mp3, committed, plus the manifest
// src/lib/audioDays.json that tells the app which days already have audio.
// Days without a clip fall back to the on-demand Workers AI endpoint.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getLectionaryDay, hasLectionaryDay } from '../../src/lib/lectionary';
import { focusReference } from '../../src/lib/lectionary';
import { resolvePassage } from '../../src/lib/passage';
import {
  DAYS_MANIFEST, listMp3s, PUBLIC_AUDIO, readJson, synthesize, WORK, writeJson,
  type Engine, type Job, type Lang,
} from './lib.mts';

const LANGS: Lang[] = ['en', 'zh'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
mkdirSync(WORK, { recursive: true });

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ENGINE = (value('--engine') ?? 'chatterbox') as Engine;
if (ENGINE !== 'chatterbox' && ENGINE !== 'kokoro') {
  console.error(`unknown engine: ${ENGINE} (expected chatterbox | kokoro)`);
  process.exit(1);
}

function dateShift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Which days to cover, soonest first.
let days: string[] = [];
const from = value('--from');
const nextN = value('--next');
if (flag('--all')) {
  if (!flag('--yes')) {
    console.error('refusing to synthesize the whole 1826-day table without --yes');
    process.exit(1);
  }
  const table = (await import('../../src/lib/lectionaryDays.json', { with: { type: 'json' } }))
    .default as Record<string, unknown>;
  const keys = Object.keys(table).sort();
  // Future days first - they are the ones the app can still play as "today".
  // Days already past follow, so an interrupted run has always spent its GPU
  // time on something usable.
  const today = new Date().toISOString().slice(0, 10);
  const splitAt = keys.findIndex((d) => d >= today);
  const future = splitAt >= 0 ? keys.slice(splitAt) : [];
  const past = splitAt >= 0 ? keys.slice(0, splitAt) : keys;
  days = [...future, ...past];
} else if (from && DAY_RE.test(from)) {
  days = Array.from({ length: Number(value('--days') ?? 1) }, (_, i) => dateShift(from, i));
} else if (nextN !== undefined || flag('--next')) {
  const today = new Date().toISOString().slice(0, 10);
  days = Array.from({ length: Number(nextN ?? 1) }, (_, i) => dateShift(today, i));
} else {
  console.error('usage: tts:passages [--next N | --from YYYY-MM-DD --days N | --all --yes]');
  process.exit(1);
}
// Filter to real dates. Deliberately NOT re-sorted: --all hands over
// future-first ordering, which must survive to the synthesis queue.
days = days.filter((d) => DAY_RE.test(d));

interface Pending { job: Job; day: string; lang: Lang }
const pending: Pending[] = [];
const skippedText: string[] = [];

for (const day of days) {
  if (!hasLectionaryDay(day)) {
    skippedText.push(`${day} (not in lectionary table)`);
    continue;
  }
  for (const lang of LANGS) {
    const passage = resolvePassage(focusReference(getLectionaryDay(day)), lang);
    if (!passage?.text) {
      skippedText.push(`${day} ${lang} (no resolvable passage text)`);
      continue;
    }
    const mp3 = join(PUBLIC_AUDIO, 'days', lang, `${day}.mp3`);
    if (existsSync(mp3)) continue;
    pending.push({
      day, lang,
      job: {
        id: `${lang}-${day}`, lang, text: passage.text,
        wav: join(WORK, `day-${lang}-${day}.wav`), mp3,
      },
    });
  }
}

console.log(
  `tts:passages — window ${days[0]}..${days[days.length - 1]} (${days.length} days): ` +
  `${pending.length} clip(s) to synthesize, ${days.length * 2 - pending.length - skippedText.length} already on disk, ${skippedText.length} without text`,
);
for (const s of skippedText) console.log(`  skip ${s}`);
if (pending.length === 0) {
  writeDaysManifest(ENGINE, new Set());
  console.log(`tts:passages — nothing to do [${ENGINE}].`);
  process.exit(0);
}

const started = Date.now();
const { ok, failed } = await synthesize(pending.map((p) => p.job), { engine: ENGINE });
const elapsed = (Date.now() - started) / 1000;
for (const f of failed) console.error(`FAILED ${f.job.id}: ${f.error}`);
console.log(`tts:passages [${ENGINE}] — ${ok.length}/${pending.length} clip(s) in ${(elapsed / 60).toFixed(1)} min ` +
  `(≈${(elapsed / Math.max(ok.length, 1) / 60).toFixed(2)} min/clip)`);

const fresh = new Set(ok.map((j) => `${j.lang}/${j.id.slice(j.lang.length + 1)}`));
writeDaysManifest(ENGINE, fresh);
console.log(`tts:passages — manifest written: ${DAYS_MANIFEST}`);
if (failed.length > 0) process.exitCode = 1;

/** The manifest is always rebuilt from disk, so it can never claim a file that is not there. */
function writeDaysManifest(engine: Engine, fresh: Set<string>): void {
  const previous = readJson<{ engines?: Record<string, string> }>(DAYS_MANIFEST, {});
  const daysMap: Record<string, Lang[]> = {};
  const engines: Record<string, string> = {};
  for (const lang of LANGS) {
    for (const file of listMp3s('days', lang)) {
      const day = file.slice(0, -'.mp3'.length);
      (daysMap[day] ??= []).push(lang);
      // Provenance: clips synthesized this run get its engine; older files keep
      // whatever the previous manifest recorded (all-chatterbox before --engine).
      engines[`${lang}/${day}`] = fresh.has(`${lang}/${day}`)
        ? engine
        : previous.engines?.[`${lang}/${day}`] ?? 'chatterbox';
    }
  }
  for (const langs of Object.values(daysMap)) langs.sort();
  writeJson(DAYS_MANIFEST, {
    generator: 'lectio-tts',
    days: Object.fromEntries(Object.entries(daysMap).sort(([a], [b]) => a.localeCompare(b))),
    engines: Object.fromEntries(Object.entries(engines).sort(([a], [b]) => a.localeCompare(b))),
  });
}
