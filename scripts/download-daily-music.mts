// Downloads public chapter songs needed by the bundled daily lectionary.
// Existing originals are retained. Failed requests are reported and never saved as MP3s.
import { mkdir, access, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseReference } from '../src/lib/passage.ts';
import { BOOK_NR } from '../src/lib/scripture.ts';
import days from '../src/lib/lectionaryDays.json';

const root = new URL('../downloads/TheSingingBible-English-Male-Praise/', import.meta.url);
const chapters = new Set<string>();
for (const day of Object.values(days)) {
  const ref = parseReference(day.readings[day.focus as keyof typeof day.readings] ?? day.readings.gospel);
  if (!ref) continue;
  const book = BOOK_NR[ref.book];
  if (!book) throw new Error(`Unknown book ${ref.book}`);
  for (let c = ref.from.chapter; c <= ref.to.chapter; c++) {
    chapters.add(`${String(book).padStart(2, '0')}-${ref.book.toLowerCase().replaceAll(' ', '-')}/${String(c).padStart(3, '0')}.mp3`);
  }
}
let downloaded = 0, existing = 0;
const failures: string[] = [];
const queue = [...chapters];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const relative = queue.shift();
    if (!relative) return;
    const destination = new URL(relative, root);
    if (await access(destination).then(() => true, () => false)) { existing++; continue; }
    try {
      const response = await fetch(`https://audio.thesinging.bible/sbe/male/adult/praise/${relative}`, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224))) {
        throw new Error('Response is not an MP3');
      }
      await mkdir(new URL('./', destination), { recursive: true });
      const partial = fileURLToPath(destination) + '.partial';
      await writeFile(partial, bytes);
      await rename(partial, destination);
      downloaded++;
      console.log(`Downloaded ${relative}`);
    } catch (error) { failures.push(`${relative}: ${error}`); }
  }
}));
console.log(JSON.stringify({ downloaded, existing, failures }, null, 2));
if (failures.length) process.exitCode = 1;
