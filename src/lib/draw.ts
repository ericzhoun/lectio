// One reading, drawn once. The home page POST and the assistant's
// start_reading tool both call this, so entitlement, reflection, logging and
// quota accounting cannot drift between the two entry points. Cookies are the
// caller's business: this returns the reading, it does not remember it.
import { canDraw, recordDraw } from './entitlements';
import { drawVerses, type DrawnVerse } from './scripture';
import { SPREADS, type Lang } from './reading';
import { generateInterpretation, generateFollowUpQuestions } from './openai';
import { logReading } from './db';

export interface DrawInput {
  question: string;
  spreadKey: string;
  lang: Lang;
  /** Entitlement subject: the signed-in user id, else the anonymous cookie id. */
  userId: string;
  registered: boolean;
  ipAddress: string | null;
}

export type DrawOutcome =
  | {
      kind: 'reading';
      readingId: string;
      spreadKey: string;
      verses: DrawnVerse[];
      summary: string;
      followUps: string[];
    }
  /** Anonymous multi-verse flow: the page shows the verses and gates the reflection. */
  | { kind: 'gated' }
  | { kind: 'blocked'; reason: string };

export async function performDraw(input: DrawInput): Promise<DrawOutcome> {
  const spreadKey = input.spreadKey in SPREADS ? input.spreadKey : 'single';
  const entitlement = await canDraw(input.userId, spreadKey, input.registered);
  if (!entitlement.ok) return { kind: 'blocked', reason: entitlement.reason ?? 'quota' };
  if (entitlement.gated) return { kind: 'gated' };

  const spread = SPREADS[spreadKey] ?? SPREADS.single;
  const verses = drawVerses(spread.number);
  const positions = spread.positions[input.lang];
  verses.forEach((v, i) => {
    v.position = positions[i] ?? '';
  });

  const interp = await generateInterpretation(input.question, verses, input.lang, spreadKey);
  verses.forEach((v, i) => {
    v.interp_text = interp.cards[i]?.text ?? '';
    v.tags = interp.cards[i]?.tags ?? [];
  });
  const followUps = await generateFollowUpQuestions(
    input.question,
    interp.summary || verses.map((v) => v.interp_text).join(' '),
    input.lang
  );

  await logReading(
    input.question,
    verses.map((v) => ({ en: v.refEn, zh: v.refZh })),
    interp.summary,
    input.ipAddress,
    input.userId
  );
  await recordDraw(input.userId, spreadKey, input.registered);

  return {
    kind: 'reading',
    readingId: crypto.randomUUID(),
    spreadKey,
    verses,
    summary: interp.summary,
    followUps,
  };
}
