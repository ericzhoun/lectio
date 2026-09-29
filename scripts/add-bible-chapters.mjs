// One-off helper: add specific chapters to src/lib/bibleChapters.json without
// regenerating the whole file (scripts/fetch-bible-context.mjs regenerates it
// from every deck + lectionary chapter; this scopes the same pipeline to the
// chapters a deck change newly needs).
//
// Same sources and normalization as the full generator:
//  - English: World English Bible via api.getbible.net (`web`), "Yahweh" ->
//    "the LORD", missing-space repair via bible-api.com and
//    scripts/lib/restore-whitespace.mjs.
//  - Chinese: 和合本 (CUS) via api.getbible.net (`cus`).
//
// Existing entries are preserved; a chapter is skipped when its key already
// exists unless --force is passed.
//
// Usage:
//   node scripts/add-bible-chapters.mjs "Genesis 1" "Romans 6"
//   node scripts/add-bible-chapters.mjs --force "Proverbs 30"
//   node scripts/add-bible-chapters.mjs            # default set below

import { readFileSync, writeFileSync } from 'node:fs';
import { collapse, restoreWhitespace } from './lib/restore-whitespace.mjs';

const DEFAULTS = ['Genesis 1', 'Romans 6', 'Proverbs 30', '2 Corinthians 10'];

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

async function repairChapter(book, chapter, verses) {
  const slug = `${book.toLowerCase().replace(/ /g, '+')}+${chapter}`;
  let reference;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://bible-api.com/${slug}?translation=web`);
      if (res.status === 429) { await sleep(4000 * attempt); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reference = await res.json();
      break;
    } catch (e) {
      if (attempt === 3) {
        console.warn(`  ! repair check unavailable for ${book} ${chapter}: ${e.message}`);
        return verses;
      }
      await sleep(1500 * attempt);
    }
  }
  if (!reference?.verses) return verses;
  const byNum = new Map(reference.verses.map((v) => [v.verse, collapse(v.text)]));
  return verses.map((v) => {
    const text = restoreWhitespace(v.text, byNum.get(v.num));
    return text === v.text ? v : { ...v, text };
  });
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const chapters = args.filter((a) => !a.startsWith('--'));
const list = chapters.length > 0 ? chapters : DEFAULTS;

const fileUrl = new URL('../src/lib/bibleChapters.json', import.meta.url);
const raw = readFileSync(fileUrl, 'utf8');
const out = JSON.parse(raw);
let added = 0;

for (const spec of list) {
  const m = spec.match(/^(.+?)\s+(\d+)$/);
  if (!m) throw new Error(`Unparseable chapter spec: ${spec}`);
  const book = m[1].trim();
  const ch = Number(m[2]);
  const nr = BOOK_NR[book];
  if (!nr) throw new Error(`Unknown book: ${book}`);
  const key = `${nr}:${ch}`;
  if (out[key] && !force) {
    console.log(`skip ${book} ${ch} (${key} already present)`);
    continue;
  }
  let en = await fetchChapter('web', nr, ch);
  await sleep(250);
  en = await repairChapter(book, ch, en);
  await sleep(1500);
  const zh = await fetchChapter('cus', nr, ch);
  const enMap = new Map(en.map((v) => [v.num, normalizeEn(v.text)]));
  const zhMap = new Map(zh.map((v) => [v.num, v.text]));
  const maxNum = Math.max(...en.map((v) => v.num), ...zh.map((v) => v.num));
  const enArr = [], zhArr = [];
  for (let n = 1; n <= maxNum; n++) {
    enArr.push(enMap.get(n) ?? '');
    zhArr.push(zhMap.get(n) ?? '');
  }
  out[key] = { en: enArr, zh: zhArr };
  added++;
  console.log(`ok ${book} ${ch} (${key}, ${maxNum} verses)`);
}

writeFileSync(fileUrl, JSON.stringify(out));
console.log(`\nadded ${added} chapter(s); wrote src/lib/bibleChapters.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB, ${Object.keys(out).length} chapters)`);
