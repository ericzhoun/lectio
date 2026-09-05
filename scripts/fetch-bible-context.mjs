// One-off generator for src/lib/bibleChapters.json — the chapter context data
// that lets anonymous visitors read drawn Bible verses "in a real Bible page"
// (neighbouring verses included).
//
// Sources (both public domain):
//  - English: World English Bible via api.getbible.net (translation `web`),
//    normalized "Yahweh" -> "the LORD" to match the deck's WEB rendering.
//  - Chinese: 和合本 (CUV, 神版) via api.getbible.net (translation `cus`).
//
// Run: node scripts/fetch-bible-context.mjs
// Validates every deck verse against the fetched chapters and reports gaps.

import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/lib/scripture.ts', import.meta.url), 'utf8');

// ---- 1. Extract the deck's English references ------------------------------
const enRefs = [...src.matchAll(/ref: '([A-Za-z0-9 :\-]+?)',/g)].map((m) => m[1]);
const parsed = enRefs.map((ref) => {
  const m = ref.match(/^((?:[1-3] )?[A-Za-z]+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`Unparseable ref: ${ref}`);
  return { ref, book: m[1], chapter: Number(m[2]), start: Number(m[3]), end: m[4] ? Number(m[4]) : Number(m[3]) };
});

const BOOK_NR = {
  Genesis: 1, Exodus: 2, Leviticus: 3, Numbers: 4, Deuteronomy: 5, Joshua: 6, Judges: 7, Ruth: 8,
  '1 Samuel': 9, '2 Samuel': 10, '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
  Ezra: 15, Nehemiah: 16, Esther: 17, Job: 18, Psalms: 19, Psalm: 19, Proverbs: 20, Ecclesiastes: 21,
  Isaiah: 23, Jeremiah: 24, Lamentations: 25, Ezekiel: 26, Daniel: 27, Hosea: 28, Joel: 29, Amos: 30,
  Obadiah: 31, Jonah: 32, Micah: 33, Nahum: 34, Zephaniah: 36, Zechariah: 38, Malachi: 39,
  Matthew: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Romans: 45, '1 Corinthians': 46,
  '2 Corinthians': 47, Galatians: 48, Ephesians: 49, Philippians: 50, Colossians: 51,
  '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55, Titus: 56,
  Philemon: 57, Hebrews: 58, James: 59, '1 Peter': 60, '2 Peter': 61, '1 John': 62, Jude: 65,
  Revelation: 66,
};

// Unique chapters (Psalm is the deck's spelling; getbible uses book numbers)
const chapters = new Map();
for (const p of parsed) {
  if (!BOOK_NR[p.book]) throw new Error(`Unknown book: ${p.book}`);
  chapters.set(`${BOOK_NR[p.book]}:${p.chapter}`, { book: p.book, chapter: p.chapter });
}
console.log(`${parsed.length} deck refs -> ${chapters.size} unique chapters`);

// ---- 1b. Add the chapters the daily lectionary reads ----------------------
// The daily flow renders one focus reading per day, always the gospel. Those
// span far fewer chapters than the whole Bible, so they live in the same
// bundled file rather than needing a store of their own.
const deckOnly = chapters.size;
let lectionaryDays;
try {
  lectionaryDays = JSON.parse(
    readFileSync(new URL('../src/lib/lectionaryDays.json', import.meta.url), 'utf8')
  );
} catch {
  console.log('no lectionaryDays.json yet; run scripts/build-lectionary.mjs first');
  lectionaryDays = {};
}

const ABBREV = {
  matt: 'Matthew', mat: 'Matthew', mk: 'Mark', lk: 'Luke', jn: 'John', rom: 'Romans',
};

for (const entry of Object.values(lectionaryDays)) {
  const ref = entry.readings?.gospel;
  if (!ref) continue;
  const m = ref.match(/^\s*((?:[1-3]\s+)?[A-Za-z][A-Za-z\s.]*?)\s+(\d+\s*:.*)$/);
  if (!m) throw new Error(`Unparseable lectionary ref: ${ref}`);
  const rawBook = m[1].trim().replace(/\.$/, '');
  const book = ABBREV[rawBook.toLowerCase()] ?? rawBook;
  if (!BOOK_NR[book]) throw new Error(`Unknown lectionary book: ${book} (from ${ref})`);
  // A reading may cross a chapter boundary ('John 7:53--8:11'); take every
  // chapter it touches.
  const anchors = [...m[2].matchAll(/(\d+)\s*:\s*\d+/g)].map((a) => Number(a[1]));
  for (let ch = Math.min(...anchors); ch <= Math.max(...anchors); ch++) {
    chapters.set(`${BOOK_NR[book]}:${ch}`, { book, chapter: ch });
  }
}
console.log(`+ lectionary -> ${chapters.size} unique chapters (${chapters.size - deckOnly} added)`);

// ---- 2. Fetch both translations per chapter --------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchChapter(translation, nr, ch, attempt = 1) {
  const url = `https://api.getbible.net/v2/${translation}/${nr}/${ch}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const verses = (j.verses ?? []).map((v) => ({ num: v.verse, text: String(v.text ?? '').trim().replace(/\s+/g, ' ') }));
    if (verses.length === 0) throw new Error('empty chapter');
    return verses;
  } catch (e) {
    if (attempt < 3) {
      await sleep(800 * attempt);
      return fetchChapter(translation, nr, ch, attempt + 1);
    }
    throw new Error(`${translation}/${nr}/${ch}: ${e.message}`);
  }
}

const normalizeEn = (t) =>
  t.replace(/\bYahweh\b/g, (m, offset, s) => {
    const before = s.slice(0, offset);
    const sentenceStart = before.length === 0 || /[.!?]\s*$/.test(before);
    return sentenceStart ? 'The LORD' : 'the LORD';
  });

const out = {};
const failures = [];
for (const [key, { book, chapter }] of chapters) {
  const nr = BOOK_NR[book];
  try {
    const en = await fetchChapter('web', nr, chapter);
    await sleep(250);
    const zh = await fetchChapter('cus', nr, chapter);
    await sleep(250);
    // Align by verse number (sources are ordered but never trust order blindly)
    const enMap = new Map(en.map((v) => [v.num, normalizeEn(v.text)]));
    const zhMap = new Map(zh.map((v) => [v.num, v.text]));
    const maxNum = Math.max(...en.map((v) => v.num), ...zh.map((v) => v.num));
    const enArr = [], zhArr = [];
    for (let n = 1; n <= maxNum; n++) {
      enArr.push(enMap.get(n) ?? '');
      zhArr.push(zhMap.get(n) ?? '');
    }
    out[key] = { en: enArr, zh: zhArr };
    process.stdout.write(`ok ${book} ${chapter} (${maxNum} verses)\n`);
  } catch (e) {
    failures.push(`${book} ${chapter}: ${e.message}`);
    process.stdout.write(`FAIL ${book} ${chapter}: ${e.message}\n`);
  }
}
if (failures.length > 0) {
  console.error(`\n${failures.length} chapters failed:\n` + failures.join('\n'));
  process.exit(1);
}

// ---- 3. Validate every deck verse against the fetched chapters -------------
const norm = (s) => s.replace(/[\s「」『』""''.,;:!?()[\]　]/g, '');
let enOk = 0, zhOk = 0, checked = 0;
const mismatches = [];
// Pair each EN ref with the deck's own en/zh text by walking the source entries
const entryRe = /ref: '([A-Za-z0-9 :\-]+?)',\s*text: '([^']+)',[\s\S]*?ref: '([^']+)',\s*text: '([^']+)'/g;
for (const m of src.matchAll(entryRe)) {
  const [, refEn, textEn, , textZh] = m;
  checked++;
  const p = parsed.find((x) => x.ref === refEn);
  if (!p) continue;
  const key = `${BOOK_NR[p.book]}:${p.chapter}`;
  const ch = out[key];
  if (!ch) continue;
  let enJoined = '', zhJoined = '';
  for (let n = p.start; n <= p.end; n++) {
    enJoined += ch.en[n - 1] ?? '';
    zhJoined += ch.zh[n - 1] ?? '';
  }
  if (norm(enJoined).includes(norm(textEn)) || norm(textEn).includes(norm(enJoined))) enOk++;
  else mismatches.push(`EN ${refEn}\n  deck: ${textEn.slice(0, 80)}\n  chap: ${enJoined.slice(0, 80)}`);
  if (norm(zhJoined).includes(norm(textZh)) || norm(textZh).includes(norm(zhJoined))) zhOk++;
  else mismatches.push(`ZH ${refEn}\n  deck: ${textZh.slice(0, 60)}\n  chap: ${zhJoined.slice(0, 60)}`);
}
console.log(`\nvalidation: ${checked} deck verses — EN match ${enOk}/${checked}, ZH match ${zhOk}/${checked}`);
if (mismatches.length > 0) {
  console.log('mismatches (context data kept, deck text still used for readings):\n' + mismatches.join('\n'));
}

writeFileSync(new URL('../src/lib/bibleChapters.json', import.meta.url), JSON.stringify(out));
const bytes = JSON.stringify(out).length;
console.log(`\nwrote src/lib/bibleChapters.json (${(bytes / 1024).toFixed(0)} KB, ${Object.keys(out).length} chapters)`);
