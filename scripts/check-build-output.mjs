// Guards the deploy against shipping an app whose manifests promise clips
// that exist nowhere. Prebuilt clips live in R2 (bucket lectio-audio) and are
// served by /audio/* and /api/tts from the AUDIO binding - they are no longer
// bundled into dist/. scripts/seed-audio-r2.mjs uploads them and records what
// it uploaded in src/lib/audioR2Manifest.json, which this check reads.
//
// A clip counts as covered when either of these holds:
//   - its key is listed in src/lib/audioR2Manifest.json (the R2 state), or
//   - the file exists in dist/client (legacy: clips bundled as static assets).
// Anything uncovered fails the deploy, because those clips would silently
// fall back to Workers AI speech in production.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const client = new URL('dist/client/', root);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const problems = [];
const asset = (url) => new URL(`.${url}`, client);

// The cron Worker (lectio-daily-invitation-cron, wrangler.cron.jsonc) is a
// separate auxiliary Worker built alongside the site's own - see
// astro.config.mjs. A missing bundle here must fail the build BEFORE the
// site deploys, not surface later as an hourly cron that silently never
// fires.
const cronEntry = new URL('lectio_daily_invitation_cron/entry.mjs', new URL('dist/', root));
if (!existsSync(fileURLToPath(cronEntry))) {
  problems.push(
    'dist/lectio_daily_invitation_cron/entry.mjs is missing - the Daily Invitation cron Worker did not build.'
  );
}

if (!existsSync(fileURLToPath(new URL('index.html', client))) && !existsSync(fileURLToPath(client))) {
  problems.push('dist/client is missing - the build did not run, or it failed after emptying dist/.');
} else {
  let r2Keys = null;
  try {
    const manifest = read('src/lib/audioR2Manifest.json');
    r2Keys = new Set(manifest.keys);
  } catch {
    problems.push(
      'src/lib/audioR2Manifest.json is missing - run `node scripts/seed-audio-r2.mjs` to upload the prebuilt clips to R2.'
    );
  }

  const steps = read('src/lib/audioSteps.json');
  const days = read('src/lib/audioDays.json');
  const music = read('src/lib/singingBibleClips.json');

  let expected = 0;
  const uncovered = [];
  const check = (url, label) => {
    expected++;
    // TTS keys drop "/audio/"; music keys keep their prefix and drop only "/".
    const key = url.startsWith('/audio/') ? url.slice('/audio/'.length) : url.slice(1);
    const inR2 = r2Keys?.has(key);
    const inDist = existsSync(fileURLToPath(asset(url)));
    if (!inR2 && !inDist) uncovered.push(label);
  };

  for (const [lang, clips] of Object.entries(steps.steps)) {
    for (const [step, clip] of Object.entries(clips)) {
      check(clip.file, `step clip ${lang}/${step}`);
    }
  }
  for (const [day, langs] of Object.entries(days.days)) {
    for (const lang of langs) {
      check(`/audio/days/${lang}/${day}.mp3`, `day clip ${lang}/${day}`);
    }
  }
  for (const [passage, clip] of Object.entries(music)) {
    check(clip.file, `music clip ${passage}`);
  }

  if (uncovered.length > 0) {
    problems.push(
      `${uncovered.length} of ${expected} manifest clips are neither in R2 nor in dist/client` +
        ` (first few: ${uncovered.slice(0, 5).join(', ')})`
    );
  } else if (problems.length === 0) {
    console.log(
      `build output ok - all ${expected} prebuilt clips covered (${r2Keys.size} in R2)` +
        ` - run \`node scripts/seed-audio-r2.mjs\` after adding clips.`
    );
  }
}

if (problems.length > 0) {
  const shown = problems.slice(0, 10);
  console.error('\nBuild output does not match the audio manifests:\n');
  for (const p of shown) console.error(`  - ${p}`);
  if (problems.length > shown.length) console.error(`  ... and ${problems.length - shown.length} more`);
  console.error(
    '\nPrebuilt clips are served from R2 (bucket lectio-audio). Seed or update\n' +
      'the bucket with `node scripts/seed-audio-r2.mjs` (resumable; it fills\n' +
      'src/lib/audioR2Manifest.json), then rebuild.\n'
  );
  process.exit(1);
}
