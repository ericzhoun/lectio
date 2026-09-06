// Shared plumbing for the Lectio TTS scripts.
//
// The synthesis itself runs under the local Chatterbox venv (scripts/tts/synth.py,
// CUDA). Node owns everything around it: which jobs are pending, hashing,
// MP3 encoding via ffmpeg, and the committed manifests under src/lib/.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Where the Chatterbox venv lives (installed by the local TTS toolbox). */
export const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'D:\\workplace\\TTS\\chatterbox\\.venv\\Scripts\\python.exe';

/** Where the Kokoro venv lives (same toolbox, engine for the fast backlog run). */
export const KOKORO_PYTHON =
  process.env.KOKORO_PYTHON ?? 'D:\\workplace\\TTS\\kokoro\\.venv\\Scripts\\python.exe';

export type Engine = 'chatterbox' | 'kokoro' | 'openai';

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNTH = join(HERE, 'synth.py');
const SYNTH_KOKORO = join(HERE, 'synth_kokoro.py');

const WORKERS: Record<Exclude<Engine, 'openai'>, { py: string; script: string }> = {
  chatterbox: { py: CHATTERBOX_PYTHON, script: SYNTH },
  kokoro: { py: KOKORO_PYTHON, script: SYNTH_KOKORO },
};

// OpenAI TTS runs straight from Node (no venv). Per-language model choice is
// deliberate: tts-1-hd garbles Mandarin - ASR round-trip shows English
// phonemes leaking in - so Chinese goes through gpt-4o-mini-tts, which also
// accepts delivery instructions. Override via OPENAI_VOICE_EN / OPENAI_VOICE_ZH.
const OPENAI_MODELS: Record<Lang, string> = { en: 'tts-1-hd', zh: 'gpt-4o-mini-tts' };
const OPENAI_VOICES: Record<Lang, string> = { en: 'onyx', zh: 'shimmer' };

/** The identity of an OpenAI clip for one language (part of the file hash). */
export function openaiClipIdentity(lang: Lang): string {
  const model = OPENAI_MODELS[lang];
  const voice = process.env[`OPENAI_VOICE_${lang.toUpperCase()}`] ?? OPENAI_VOICES[lang];
  return `${model}|${voice}`;
}

async function openaiSynthesizeJob(job: Job): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const lang = job.lang;
  const model = OPENAI_MODELS[lang];
  const voice = process.env[`OPENAI_VOICE_${lang.toUpperCase()}`] ?? OPENAI_VOICES[lang];
  const body: Record<string, unknown> = { model, voice, input: job.text, response_format: 'wav' };
  if (model === 'gpt-4o-mini-tts') {
    body.instructions =
      'Speak slowly, calmly and reverently, like a quiet retreat guide reading scripture. ' +
      '咬字清晰，语速平缓，庄重安详。';
  }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`openai tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  writeFileSync(job.wav, Buffer.from(await res.arrayBuffer()));
}

/** Temp wavs + job files; never committed. */
export const WORK = join(ROOT, '.tts-work');
export const PUBLIC_AUDIO = join(ROOT, 'public', 'audio');
export const STEPS_MANIFEST = join(ROOT, 'src', 'lib', 'audioSteps.json');
export const DAYS_MANIFEST = join(ROOT, 'src', 'lib', 'audioDays.json');

export type Lang = 'en' | 'zh';

export const sha8 = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 8);

export interface Job {
  id: string;
  lang: Lang;
  text: string;
  wav: string;
  mp3: string;
}

export interface SynthOptions {
  engine?: Engine;
  exaggeration?: number;
  cfg?: number;
}

function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) if (line) onLine?.(line);
    });
    child.stderr.on('data', (chunk: string) => {
      err += chunk;
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`));
    });
    child.on('error', reject);
  });
}

/**
 * Synthesize pending jobs and encode them to MP3. WAVs are written to the
 * work dir and deleted after encoding, so a crash never leaves half files in
 * public/. Progress lines from the worker are relayed verbatim.
 */
export async function synthesize(
  jobs: Job[],
  { engine = 'chatterbox', exaggeration = 0.3, cfg = 0.5 }: SynthOptions = {},
): Promise<{ ok: Job[]; failed: { job: Job; error: string }[] }> {
  const ok: Job[] = [];
  const failed: { job: Job; error: string }[] = [];
  if (jobs.length === 0) return { ok, failed };

  mkdirSync(WORK, { recursive: true });

  let current: Job | undefined;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const encoded = new Set<string>();
  const encodePromises: Promise<void>[] = [];

  // Encode each clip the moment its wav lands, so an interrupted run loses at
  // most the clip being synthesized - not everything since the run started.
  const startEncode = (job: Job): void => {
    if (encoded.has(job.id)) return;
    encoded.add(job.id);
    mkdirSync(dirname(job.mp3), { recursive: true });
    encodePromises.push(
      run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', job.wav,
        '-codec:a', 'libmp3lame', '-b:a', '48k', '-ac', '1', '-ar', '24000',
        job.mp3,
      ])
        .then(() => {
          rmSync(job.wav, { force: true });
          ok.push(job);
        })
        .catch((e: unknown) => {
          failed.push({ job, error: e instanceof Error ? e.message : String(e) });
        }),
    );
  };

  if (engine === 'openai') {
    // Node-side engine: no venv worker, one API call per clip, sequential to
    // stay gentle with the API.
    for (const job of jobs) {
      try {
        await openaiSynthesizeJob(job);
        console.log(`  [synth] done ${job.id}`);
        startEncode(job);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push({ job, error: msg });
        console.error(`  [synth] FAILED ${job.id}: ${msg}`);
      }
    }
  } else {
    const worker = WORKERS[engine];
    const jobsFile = join(WORK, `jobs-${Date.now()}.jsonl`);
    writeFileSync(
      jobsFile,
      jobs.map((j) => JSON.stringify({ id: j.id, lang: j.lang, text: j.text, out: j.wav })).join('\n'),
    );
    // Each worker takes only the flags it understands.
    const workerArgs = engine === 'kokoro'
      ? [worker.script, '--jobs', jobsFile]
      : [worker.script, '--jobs', jobsFile, '--exaggeration', String(exaggeration), '--cfg', String(cfg)];

    await run(
      worker.py,
      workerArgs,
      (line) => {
        let event: { event?: string; id?: string; error?: string };
        try {
          event = JSON.parse(line);
        } catch {
          console.log(`  [synth] ${line}`);
          return;
        }
        const job = event.id ? byId.get(event.id) : current;
        if (event.event === 'chunk') {
          current = job;
          return;
        }
        if (event.event === 'done' && job) {
          console.log(`  [synth] done ${job.id}`);
          startEncode(job);
        } else if (event.event === 'error' && job) {
          failed.push({ job, error: event.error ?? 'unknown' });
          console.error(`  [synth] FAILED ${job.id}: ${event.error}`);
        }
      },
    );
    rmSync(jobsFile, { force: true });
  }

  // Safety net: a wav that exists but whose done event was missed still gets
  // encoded; a job with neither wav nor event is reported as failed.
  for (const job of jobs) {
    if (existsSync(job.wav)) startEncode(job);
    else if (!encoded.has(job.id)) failed.push({ job, error: 'worker produced no file' });
  }
  await Promise.all(encodePromises);
  return { ok, failed };
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

/** mp3 files currently on disk under public/audio/<kind>/<lang>/ */
export function listMp3s(kind: 'steps' | 'days', lang: Lang): string[] {
  const dir = join(PUBLIC_AUDIO, kind, lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
}
