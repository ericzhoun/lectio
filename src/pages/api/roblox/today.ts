// src/pages/api/roblox/today.ts
// The church-calendar "Today's reading" for the world: the day's lectionary
// focus passage resolved to per-verse steps in both languages. Free — it
// never consumes the daily quota, matching the website.
import type { APIRoute } from 'astro';
import { getLectionaryDay, focusReference } from '../../../lib/lectionary';
import { parseReference } from '../../../lib/passage';
import { BOOK_NR } from '../../../lib/scripture';
import { BOOK_ZH } from '../../../lib/passage';
import bibleChapters from '../../../lib/bibleChapters.json';
import { guardRobloxRequest, json } from '../../../lib/roblox';

export const prerender = false;

/** Long gospel readings are walked verse by verse; cap the walk. */
const MAX_STEPS = 50;

export const POST: APIRoute = async ({ request }) => {
  const denied = guardRobloxRequest(request);
  if (denied) return denied;

  const day = new Date().toISOString().slice(0, 10);
  const lectionaryDay = getLectionaryDay(day);
  const focus = focusReference(lectionaryDay);
  const parsed = parseReference(focus);
  if (!parsed) return json({ ok: false, errorKey: 'backendError' });

  const nr = BOOK_NR[parsed.book];
  const store = bibleChapters as Record<string, { en: string[]; zh: string[] }>;
  const zhBook = BOOK_ZH[parsed.book] ?? parsed.book;

  const steps: Array<{ refEn: string; refZh: string; en: string; zh: string }> = [];
  for (let chapter = parsed.from.chapter; chapter <= parsed.to.chapter && steps.length < MAX_STEPS; chapter++) {
    const data = store[`${nr}:${chapter}`];
    // Like resolvePassage: a chapter we cannot fully serve means no passage
    // rather than half a passage.
    if (!data) return json({ ok: false, errorKey: 'backendError' });
    const first = chapter === parsed.from.chapter ? parsed.from.verse : 1;
    const last = chapter === parsed.to.chapter
      ? Math.min(parsed.to.verse, data.en.length)
      : data.en.length;
    for (let v = first; v <= last && steps.length < MAX_STEPS; v++) {
      const en = data.en[v - 1];
      const zh = data.zh[v - 1];
      if (!en && !zh) continue;
      steps.push({
        refEn: `${parsed.book} ${chapter}:${v}`,
        refZh: `${zhBook} ${chapter}:${v}`,
        en: en ?? '',
        zh: zh ?? '',
      });
    }
  }
  if (steps.length === 0) return json({ ok: false, errorKey: 'backendError' });

  return json({
    ok: true,
    day,
    titleEn: lectionaryDay.title.en,
    titleZh: lectionaryDay.title.zh,
    weekEn: lectionaryDay.week,
    weekZh: lectionaryDay.weekZh,
    focus,
    steps,
  });
};
