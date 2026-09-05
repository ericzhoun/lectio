// The six movements. Order, progress, and the copy shown at each step.
import type { Lang } from './reading';

export type Step =
  | 'silencio' | 'lectio' | 'meditatio' | 'oratio' | 'contemplatio' | 'actio';

export const STEP_ORDER = [
  'silencio', 'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
] as const satisfies readonly Step[];

/** The steps that take the reader's own words. Contemplatio is deliberately absent. */
export const WRITING_STEPS = ['meditatio', 'oratio', 'actio'] as const satisfies readonly Step[];

export function isStep(v: unknown): v is Step {
  return typeof v === 'string' && (STEP_ORDER as readonly string[]).includes(v);
}

export function stepIndex(step: Step): number {
  return STEP_ORDER.indexOf(step);
}

export function nextStep(step: Step): Step | null {
  const i = stepIndex(step);
  return i === STEP_ORDER.length - 1 ? null : STEP_ORDER[i + 1];
}

export function progressPercent(reached: Step): number {
  return Math.round(((stepIndex(reached) + 1) / STEP_ORDER.length) * 100);
}

export interface StepCopy {
  name: Record<Lang, string>;
  prompt: Record<Lang, string>;
}

export const STEP_COPY: Record<Step, StepCopy> = {
  silencio: {
    name: { en: 'Silencio', zh: '静默' },
    prompt: {
      en: 'Be still. Let the noise settle before you read.',
      zh: '安静下来。在诵读之前，让心中的喧嚣沉淀。',
    },
  },
  lectio: {
    name: { en: 'Lectio', zh: '诵读' },
    prompt: {
      en: 'Read it slowly, twice. There is no hurry.',
      zh: '慢慢地读两遍。不用急。',
    },
  },
  meditatio: {
    name: { en: 'Meditatio', zh: '默想' },
    prompt: {
      en: 'What word or phrase caught you?',
      zh: '哪一个词、哪一句话触动了你？',
    },
  },
  oratio: {
    name: { en: 'Oratio', zh: '祈祷' },
    prompt: {
      en: 'What do you want to say to God about it?',
      zh: '关于这句话，你想对神说什么？',
    },
  },
  contemplatio: {
    name: { en: 'Contemplatio', zh: '默观' },
    prompt: {
      en: 'Nothing more to do now. Rest here a while.',
      zh: '现在无需再做什么。在这里安歇片刻。',
    },
  },
  actio: {
    name: { en: 'Actio', zh: '践行' },
    prompt: {
      en: 'One thing you will do today.',
      zh: '今天你要做的一件事。',
    },
  },
};
