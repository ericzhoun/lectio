// The typical questions the verse library answers on every verse page.
//
// Where the reading flow runs question -> verse, the library runs the other
// way: a visitor arrives on /library/<slug> from a question-shaped search, so
// each verse page carries its own pre-written interpretation for each of these
// questions, and an entry point for the reader's own question.
//
// The wording is deliberately identical to the first four entries of
// DEFAULT_QUESTIONS in ./reading (the home page's suggested questions), so a
// question means the same thing everywhere on the site. Changing one without
// the other would fork the vocabulary; verseQuestions.test.ts pins the link.
//
// Pre-written interpretations live in ./verseInterpretations.<lang>.json,
// keyed by verse slug then by these question slugs.

export interface TypicalQuestion {
  /** Stable id: URL anchor, JSON key, and analytics prop. */
  slug: string;
  /** The question as the reader would type it, per language. */
  questionEn: string;
  questionZh: string;
  /** Short label for the inline table of contents and cross-verse links. */
  labelEn: string;
  labelZh: string;
}

export const TYPICAL_QUESTIONS: readonly TypicalQuestion[] = [
  {
    slug: 'pressure-at-work',
    questionEn: 'How do I face this season of pressure at work?',
    questionZh: '我该如何面对工作中的这段压力？',
    labelEn: 'Pressure at work',
    labelZh: '工作中的压力',
  },
  {
    slug: 'loving-better',
    questionEn: 'I want to learn to love better in this relationship.',
    questionZh: '我想在这段关系里学会更好地去爱。',
    labelEn: 'Learning to love better',
    labelZh: '学会更好地去爱',
  },
  {
    slug: 'letting-go',
    questionEn: 'What do I need to let go of in the coming weeks?',
    questionZh: '接下来这段时间，我需要放下什么？',
    labelEn: 'What to let go of',
    labelZh: '需要放下什么',
  },
  {
    slug: 'stillness',
    questionEn: 'How can I find stillness in a busy life?',
    questionZh: '我该如何在忙碌中安静下来？',
    labelEn: 'Finding stillness',
    labelZh: '在忙碌中安静',
  },
];

/** A typical question by its slug, or null when the slug is unknown. */
export function getTypicalQuestion(slug: string): TypicalQuestion | null {
  return TYPICAL_QUESTIONS.find((q) => q.slug === slug) ?? null;
}
