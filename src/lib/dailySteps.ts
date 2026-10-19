// The six movements. Order, progress, and the copy shown at each step.
import type { Lang } from './reading';

export type Step =
  'lectio' | 'meditatio' | 'oratio' | 'contemplatio' | 'actio';

/**
 * The walk opens at Lectio. It used to open with a timed Silencio, which asked
 * for a minute of stillness before a word had been read; the reading now opens
 * the sitting itself, so nobody has to be talked into the quiet first.
 */
export const STEP_ORDER = [
  'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
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
  /** Rough minutes this step takes, self-paced — shown so a newcomer knows the cost before starting. */
  minutes: number;
}

/**
 * The whole walk, self-paced. Roughly the guided session's length (its pauses
 * alone run several minutes) plus writing time at the three reflection steps.
 */
export const TOTAL_WALK_MINUTES = 14;

export const STEP_COPY: Record<Step, StepCopy> = {
  lectio: {
    name: { en: 'Lectio', zh: '诵读' },
    prompt: {
      en: 'Read it slowly, twice. There is no hurry.',
      zh: '慢慢地读两遍。不用急。',
    },
    minutes: 3,
  },
  meditatio: {
    name: { en: 'Meditatio', zh: '默想' },
    prompt: {
      en: 'What word or phrase caught you?',
      zh: '哪一个词、哪一句话触动了你？',
    },
    minutes: 3,
  },
  oratio: {
    name: { en: 'Oratio', zh: '祈祷' },
    prompt: {
      en: 'What do you want to say to God about it?',
      zh: '关于这句话，你想对神说什么？',
    },
    minutes: 3,
  },
  contemplatio: {
    name: { en: 'Contemplatio', zh: '默观' },
    prompt: {
      en: 'Nothing more to do now. Stop producing words and remain with God \u2014 the silence is not the destination; he is.',
      zh: '现在无需再做什么。停止言语，停留在神面前——安静不是终点，神才是。',
    },
    minutes: 3,
  },
  actio: {
    name: { en: 'Actio', zh: '践行' },
    prompt: {
      en: 'One thing you will do today.',
      zh: '今天你要做的一件事。',
    },
    minutes: 2,
  },
};
