// Generate the twelve static step-guidance clips (6 steps x 2 languages) with
// the local Chatterbox model, and write the manifest the app reads.
//
//   npm run tts:steps
//
// Content-hashed filenames: text that has not changed is never re-synthesized,
// so re-running after a copy tweak only regenerates the changed clips. Orphaned
// mp3s from previous hashes are deleted, and the manifest is written to
// src/lib/audioSteps.json (committed, so builds on other machines need no GPU).
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_COPY, STEP_ORDER } from '../../src/lib/dailySteps';
import {
  listMp3s, openaiClipIdentity, PUBLIC_AUDIO, readJson, sha8, STEPS_MANIFEST, synthesize,
  writeJson, type Engine, type Job, type Lang,
} from './lib.mts';

const LANGS: Lang[] = ['en', 'zh'];
const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ENGINE = (value('--engine') ?? 'chatterbox') as Engine;
if (ENGINE !== 'chatterbox' && ENGINE !== 'kokoro' && ENGINE !== 'openai') {
  console.error(`unknown engine: ${ENGINE} (expected chatterbox | kokoro | openai)`);
  process.exit(1);
}

interface StepClip { file: string; hash: string; text: string; engine: string; model?: string }
type StepsManifest = {
  generator: string;
  steps: Record<Lang, Record<string, StepClip>>;
};

const existing = readJson<StepsManifest | null>(STEPS_MANIFEST, null);

const clipText = (lang: Lang, step: string): string => {
  const copy = STEP_COPY[step as keyof typeof STEP_COPY];
  return lang === 'zh'
    ? `${copy.name.zh}。${copy.prompt.zh}`
    : `${copy.name.en}. ${copy.prompt.en}`;
};

const manifest: StepsManifest = { generator: ENGINE, steps: { en: {}, zh: {} } };
const pending: Job[] = [];

for (const lang of LANGS) {
  for (const step of STEP_ORDER) {
    const text = clipText(lang, step);
    // The hash covers the whole artifact identity: a different engine, model
    // or voice must land in a new file, never silently overwrite the old one
    // (which edge caches may still hold under the same URL).
    const model = ENGINE === 'openai' ? openaiClipIdentity(lang).split('|')[0] : undefined;
    const identity = ENGINE === 'openai'
      ? `${ENGINE}|${openaiClipIdentity(lang)}|${text}`
      : `${ENGINE}|${text}`;
    const hash = sha8(identity);
    const file = `/audio/steps/${lang}/${step}-${hash}.mp3`;
    const previous = existing?.steps[lang]?.[step];
    const mp3 = join(PUBLIC_AUDIO, 'steps', lang, `${step}-${hash}.mp3`);
    manifest.steps[lang][step] = { file, hash, text, engine: ENGINE, ...(model ? { model } : {}) };
    if (
      previous?.hash === hash && previous.engine === ENGINE &&
      existsSync(join(PUBLIC_AUDIO, previous.file.slice(1)))
    ) continue;
    if (existsSync(mp3)) continue; // same artifact, manifest was lost
    pending.push({
      id: `${lang}-${step}`, lang, text,
      wav: join(HERE, '..', '..', '.tts-work', `${lang}-${step}.wav`),
      mp3,
    });
  }
}

if (pending.length === 0) {
  console.log('tts:steps — all 12 clips up to date, nothing to synthesize.');
} else {
  console.log(`tts:steps — synthesizing ${pending.length} clip(s) ...`);
  const started = Date.now();
  const { ok, failed } = await synthesize(pending, { engine: ENGINE });
  for (const f of failed) console.error(`FAILED ${f.job.id}: ${f.error}`);
  console.log(`tts:steps — ${ok.length} clip(s) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (failed.length > 0) process.exitCode = 1;
}

// Drop clips from older text hashes so public/ only ever holds the current twelve.
for (const lang of LANGS) {
  const keep = new Set(Object.values(manifest.steps[lang]).map((c) => c.file.split('/').pop()));
  for (const file of listMp3s('steps', lang)) {
    if (!keep.has(file)) rmSync(join(PUBLIC_AUDIO, 'steps', lang, file), { force: true });
  }
}

writeJson(STEPS_MANIFEST, manifest);
console.log(`tts:steps — manifest written: ${STEPS_MANIFEST}`);
