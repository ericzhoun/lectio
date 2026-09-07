// Guards the deploy against shipping a build that does not match the manifests.
//
// The prebuilt-audio manifests in src/lib are the source of truth for what
// /api/tts will try to serve from the ASSETS binding, but the clips themselves
// are gitignored and only exist on the machine that synthesized them. A build
// made without them still succeeds - the endpoint just falls back to Workers AI
// and nobody notices until the voice is wrong in production. Worse, `astro
// build` can fail after emptying dist/, and a plain `wrangler deploy` then
// happily ships whatever stale output is left behind.
//
// So before every deploy: assert the build output exists and contains a clip
// for every entry the manifests promise.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const client = new URL('dist/client/', root);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const problems = [];
const asset = (url) => new URL(`.${url}`, client);

if (!existsSync(fileURLToPath(new URL('index.html', client))) && !existsSync(fileURLToPath(client))) {
  problems.push('dist/client is missing - the build did not run, or it failed after emptying dist/.');
} else {
  const steps = read('src/lib/audioSteps.json');
  const days = read('src/lib/audioDays.json');

  let expected = 0;
  for (const [lang, clips] of Object.entries(steps.steps)) {
    for (const [step, clip] of Object.entries(clips)) {
      expected++;
      if (!existsSync(fileURLToPath(asset(clip.file)))) {
        problems.push(`missing step clip ${lang}/${step}: dist/client${clip.file}`);
      }
    }
  }
  for (const [day, langs] of Object.entries(days.days)) {
    for (const lang of langs) {
      expected++;
      const file = `/audio/days/${lang}/${day}.mp3`;
      if (!existsSync(fileURLToPath(asset(file)))) problems.push(`missing day clip: dist/client${file}`);
    }
  }
  if (problems.length === 0) console.log(`build output ok - ${expected} prebuilt clips present in dist/client`);
}

if (problems.length > 0) {
  const shown = problems.slice(0, 10);
  console.error('\nBuild output does not match the audio manifests:\n');
  for (const p of shown) console.error(`  - ${p}`);
  if (problems.length > shown.length) console.error(`  ... and ${problems.length - shown.length} more`);
  console.error(
    '\nRun `npm run build` and check it completed. Prebuilt clips live in the\n' +
      'gitignored public/audio/; regenerate them with `npm run tts:steps` and\n' +
      '`npm run tts:passages`, or deploy from the machine that has them.\n' +
      'Deploying now would silently fall back to Workers AI speech.\n'
  );
  process.exit(1);
}
