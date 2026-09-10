// Preserve the publisher's explicit verse numbers: some translations omit verses.
import { readdir, mkdir, access, writeFile } from 'node:fs/promises';
const source = new URL('../downloads/TheSingingBible-English-Male-Praise/', import.meta.url);
const cache = new URL('../.tts-work/music/text/', import.meta.url);
await mkdir(cache, { recursive: true });
const queue = [];
for (const folder of await readdir(source, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;
  for (const file of await readdir(new URL(`${folder.name}/`, source))) {
    if (file.endsWith('.mp3')) queue.push(`${folder.name}/${file.replace('.mp3', '.json')}`);
  }
}
let count = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const relative = queue.shift();
    if (!relative) return;
    const output = new URL(relative.replace('/', '-'), cache);
    if (await access(output).then(() => true, () => false)) continue;
    const response = await fetch(`https://thesinging.bible/text/sbe/${relative}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.verses) || !data.verses.length) throw new Error(`Missing verses: ${relative}`);
    await writeFile(output, JSON.stringify(data));
    count++;
  }
}));
console.log(`Cached ${count} numbered chapter texts.`);
