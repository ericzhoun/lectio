// getbible.net, the source behind bibleChapters.json, strips the WEB's original
// line breaks without leaving a space behind - so "one smallest letter\nor one
// tiny pen stroke" once shipped to readers as "one smallest letteror one".
// scripts/fetch-bible-context.mjs now restores those spaces from bible-api.com,
// and this guards the shipped data against a regeneration that skipped the
// repair (bible-api.com being down, say) putting the glued words back.
import { describe, expect, it } from 'vitest';
import bibleChapters from '../bibleChapters.json';

const chapters = bibleChapters as Record<string, { en: string[]; zh: string[] }>;

/** One repaired verse per shape of the defect, keyed '<bookNumber>:<chapter>'. */
const REPAIRED: ReadonlyArray<[string, number, string]> = [
  ['40:5', 18, 'one smallest letter or one tiny pen stroke'], // Matthew 5:18
  ['40:24', 34, 'this generation will not pass away'], //        Matthew 24:34
  ['40:27', 46, 'lima sabachthani?'], //                         Matthew 27:46
  ['43:3', 8, 'The wind blows where it wants to'], //            John 3:8
  ['43:16', 3, 'these things because they have not known'], //   John 16:3
  ['42:6', 26, 'Woe, when men speak well of you'], //            Luke 6:26
  ['41:13', 30, 'this generation will not pass away'], //        Mark 13:30
];

describe('bibleChapters.json', () => {
  it('keeps the space that the upstream source drops at a line break', () => {
    for (const [key, verse, expected] of REPAIRED) {
      expect(chapters[key]?.en[verse - 1], `${key} v${verse}`).toContain(expected);
    }
  });

  it('has no verse where a word ran into the next one', () => {
    // Every glued word the audit found was a lowercase letter butting straight
    // into a capital or a second word; these are the ones that shipped.
    const glued =
      /\b(letteror|generationwill|limasabachthani|windblows|thingsbecause|whenmen|hourhe|beyour|takesof|sonor|fringesof|measuresof|batosof|corsof|Gehennaof|Gehennaas|Counselorhas|Hadeswill|Hownarrow|momentto|disregardhis|drachmacoins|denariusa|amhe)\b/;
    const offenders: string[] = [];
    for (const [key, chapter] of Object.entries(chapters)) {
      chapter.en.forEach((text, i) => {
        if (glued.test(text)) offenders.push(`${key} v${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
