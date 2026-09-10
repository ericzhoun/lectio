// Convert alignment evidence to numbered verse timings, then render passage MP3s.
// Re-encoding (not stream copy) gives sample-accurate cuts; browsers need no offsets.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { musicKey, type MusicCatalog } from '../src/lib/singingBible';
import { planMusicCuts, numberLyricLines, type Timings } from './lib/musicPreparation';
import days from '../src/lib/lectionaryDays.json';

const root = new URL('../', import.meta.url);
const work = new URL('.tts-work/music/', root);
const source = new URL('downloads/TheSingingBible-English-Male-Praise/', root);
const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8'));
const timings: Timings = {};
const rejected: { reference: string; reason: string }[] = [];
for (const name of readdirSync(work).filter(n => n.endsWith('.mp3.json'))) {
  const data = read(new URL(name, work));
  const textFile = new URL(`text/${data.file.replace('/', '-').replace('.mp3', '.json')}`, work);
  if (!existsSync(textFile)) continue;
  const text = read(textFile).verses as { v: number; t: string }[];
  // Empty entries represent verses omitted by the source translation.
  const numbers = numberLyricLines(data.verses.map((v: { lyrics: string }) => v.lyrics), text);
  if (!numbers) {
    rejected.push({ reference: data.file, reason: 'Embedded lyrics do not match numbered source text.' });
    continue;
  }
  const [book, chapter] = data.file.split('/');
  const key = `${Number(book.split('-')[0])}:${Number(chapter.replace('.mp3', ''))}`;
  timings[key] = { file: data.file, sha256: data.sha256, duration: data.duration, verses: {} };
  for (const [i, number] of numbers.entries()) {
    const { start, end, score } = data.verses[i];
    timings[key].verses[number] = { start, end, score };
  }
}
writeFileSync(new URL('scripts/data/singing-bible-timings.json', root), JSON.stringify(timings, null, 2) + '\n');

const references = new Set<string>();
const csv = readFileSync(new URL('verse-song-index.csv', source), 'utf8');
for (const line of csv.trim().split(/\r?\n/).slice(1)) {
  const match = line.match(/^"((?:[^"]|"")*)",/);
  if (!match) throw new Error(`Invalid verse index row: ${line}`);
  references.add(match[1].replaceAll('""', '"'));
}
for (const day of Object.values(days)) references.add(day.readings[day.focus as keyof typeof day.readings] ?? day.readings.gospel);
const destination = new URL('public/music/singing-bible/', root);
mkdirSync(destination, { recursive: true });
const manifest: MusicCatalog = {};
const evidence: Record<string, unknown> = {};
const checked = new Set<string>();
let rendered = 0;
for (const reference of references) {
  const key = musicKey(reference);
  const cuts = planMusicCuts(reference, timings);
  if (!key || !cuts) {
    rejected.push({ reference, reason: 'Missing verses, missing chapter, or alignment confidence below 0.65.' });
    continue;
  }
  if (manifest[key]) continue;
  for (const cut of cuts) {
    if (!checked.has(cut.file)) {
      const hash = createHash('sha256').update(readFileSync(new URL(cut.file, source))).digest('hex');
      if (hash !== cut.sha256) throw new Error(`Source changed; realign ${cut.file}`);
      checked.add(cut.file);
    }
  }
  const hash = createHash('sha256').update(JSON.stringify({ cuts, encoder: 'libmp3lame-160k-pad12-25-v1' })).digest('hex').slice(0, 12);
  const filename = `${key.replace(/[^0-9]/g, '-')}-${hash}.mp3`;
  const output = new URL(filename, destination);
  if (!existsSync(output)) {
    const args = ['-v', 'error', '-y'];
    for (const cut of cuts) args.push('-ss', String(cut.start), '-t', String(cut.end - cut.start), '-i', fileURLToPath(new URL(cut.file, source)));
    const filters = cuts.map((cut, i) => `[${i}:a]atrim=duration=${cut.end - cut.start},asetpts=PTS-STARTPTS[a${i}]`);
    filters.push(`${cuts.map((_, i) => `[a${i}]`).join('')}concat=n=${cuts.length}:v=0:a=1[out]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-map_metadata', '-1',
      '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100', '-metadata', `title=${reference}`,
      '-metadata', 'artist=The Singing Bible', fileURLToPath(output));
    const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Could not render ${reference}: ${result.stderr}`);
    rendered++;
  }
  const result = spawnSync('ffprobe', ['-v', 'quiet', '-show_format', '-of', 'json', fileURLToPath(output)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not verify ${reference}`);
  const duration = Number(JSON.parse(result.stdout).format.duration);
  const expected = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  if (!Number.isFinite(duration) || Math.abs(duration - expected) > .15) throw new Error(`Duration mismatch: ${reference}`);
  manifest[key] = { file: `/music/singing-bible/${filename}`, duration };
  evidence[key] = { reference, cuts, duration };
}
writeFileSync(new URL('src/lib/singingBibleClips.json', root), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(new URL('scripts/data/singing-bible-cuts.json', root), JSON.stringify(evidence, null, 2) + '\n');
writeFileSync(new URL('preparation-report.json', work), JSON.stringify({ chapters: Object.keys(timings).length, clips: Object.keys(manifest).length, rendered, rejected }, null, 2));
console.log(JSON.stringify({ chapters: Object.keys(timings).length, clips: Object.keys(manifest).length, rendered, rejected: rejected.length }));
