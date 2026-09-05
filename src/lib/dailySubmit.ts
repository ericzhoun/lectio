// One writing step submitted: save what the reader wrote, ask the model to
// respond, and move the session on.
import type { D1Database } from '@cloudflare/workers-types';
import type { Lang } from './reading';
import { nextStep, type Step } from './dailySteps';
import { generateStepResponse, type WritingStep } from './dailyReflection';
import {
  getStepEntries, saveStepEntry, advanceTo, completeSession,
} from './dailySession';

export interface StepSubmitInput {
  userId: string;
  day: string;
  step: WritingStep;
  userText: string;
  passage: { ref: string; text: string };
  lang: Lang;
  db?: D1Database;
}

export interface StepSubmitResult {
  next: Step | null;
  aiText: string | null;
  error?: 'empty';
}

export const STEP_TEXT_MAX_CHARS = 2000;

export async function handleStepSubmit(input: StepSubmitInput): Promise<StepSubmitResult> {
  const userText = input.userText.trim().slice(0, STEP_TEXT_MAX_CHARS);
  if (!userText) return { next: null, aiText: null, error: 'empty' };

  const entries = await getStepEntries(input.userId, input.day, input.db);
  const existing = entries.find((e) => e.step === input.step);

  // An unchanged resubmit (double tap, refresh) must not spend another call.
  if (existing && existing.userText === userText && existing.aiText) {
    return { next: nextStep(input.step), aiText: existing.aiText };
  }

  const priorSteps = entries
    .filter((e) => e.step !== input.step)
    .map((e) => ({ step: e.step, userText: e.userText }));

  const { text } = await generateStepResponse({
    step: input.step,
    passage: input.passage,
    userText,
    priorSteps,
    lang: input.lang,
  });

  // Save unconditionally: the reader's words survive a model outage, and a null
  // reply is a normal state the page knows how to render.
  await saveStepEntry(input.userId, input.day, input.step, userText, text, input.db);

  const next = nextStep(input.step);
  if (next) await advanceTo(input.userId, input.day, next, input.db);
  else await completeSession(input.userId, input.day, input.db);

  return { next, aiText: text };
}
