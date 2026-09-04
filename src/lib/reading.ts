// Core reading vocabulary for Lectio: languages, layouts, and starter prompts.
// A "layout" is how many verses are drawn and what each one is there to do.
// Layout keys are stable (`single` / `3card` / `celtic_cross`) because
// entitlements, quotas, and the welcome-credit columns are keyed by them.

export type Lang = 'zh' | 'en';

export interface Spread {
  number: number;
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  positions: Record<Lang, string[]>;
}

export const SPREADS: Record<string, Spread> = {
  single: {
    number: 1,
    name: { zh: '每日经文', en: 'Daily Word' },
    description: { zh: '一节经文，为当下带来领受与亮光', en: 'One verse to sit with for this moment' },
    positions: { zh: ['今日的话'], en: ['The Word for Today'] },
  },
  '3card': {
    number: 3,
    name: { zh: '圣言诵读', en: 'Lectio Divina' },
    description: {
      zh: '三节经文，走过诵读、默想、祈祷三个步骤',
      en: 'Three verses walking the movements of reading, reflection, and response',
    },
    positions: {
      zh: ['诵读 · 经文', '默想 · 触动你的', '祈祷 · 你的回应'],
      en: ['Lectio · Read', 'Meditatio · Reflect', 'Oratio · Respond'],
    },
  },
  celtic_cross: {
    number: 10,
    name: { zh: '深度诵读', en: 'Deep Lectio' },
    description: {
      zh: '十节经文的完整默观之路，全面陪伴你的问题',
      en: 'A ten-verse contemplative path through your question',
    },
    positions: {
      zh: [
        '经文', '触动你的', '你的处境', '你的重担', '所赐的',
        '一份邀请', '你的回应', '周遭的声音', '渴望与惧怕', '安息于恩典',
      ],
      en: [
        'The Word', 'What Stirs You', 'Where You Stand', 'What Weighs on You', 'What Is Offered',
        'An Invitation', 'Your Response', 'Voices Around You', 'Longing and Fear', 'Resting in Grace',
      ],
    },
  },
};

export function getSpreadName(spreadKey: string, lang: Lang): string {
  return (SPREADS[spreadKey] ?? SPREADS.single).name[lang];
}

export const DEFAULT_QUESTIONS: Record<Lang, string[]> = {
  zh: [
    '我该如何面对工作中的这段压力？',
    '我想在这段关系里学会更好地去爱。',
    '接下来这段时间，我需要放下什么？',
    '我该如何在忙碌中安静下来？',
    '我想知道今天可以为什么感恩。',
  ],
  en: [
    'How do I face this season of pressure at work?',
    'I want to learn to love better in this relationship.',
    'What do I need to let go of in the coming weeks?',
    'How can I find stillness in a busy life?',
    'What might I be grateful for today?',
  ],
};
