// The model's part in the daily reading. One short reply per writing step,
// always in response to the reader's own words.
import OpenAI from 'openai';
import type { Lang } from './reading';
import { STEP_COPY, type Step } from './dailySteps';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type WritingStep = 'meditatio' | 'oratio' | 'actio';

export interface StepResponseInput {
  step: WritingStep;
  passage: { ref: string; text: string };
  userText: string;
  priorSteps: { step: Step; userText: string }[];
  lang: Lang;
}

const BASE = (langName: string) =>
  'You are a quiet companion to someone praying Lectio Divina - the ancient practice of slow, ' +
  'prayerful scripture reading. They have just written something of their own. Respond to what ' +
  'they actually wrote. ' +
  'Be warm, hopeful and unhurried. Never predict the future or tell fortunes; this is ' +
  'contemplative reading, not divination. Never quote or cite any scripture other than the ' +
  'passage given. Do not explain what the passage "really means" - they are not asking for a ' +
  'commentary. ' +
  'Stay pastoral rather than clinical: do not diagnose, and if they signal that they are in ' +
  'crisis, respond gently and encourage them to reach for real human help rather than trying to ' +
  'counsel them yourself. ' +
  `Write in ${langName}. ` +
  'Respond ONLY with a single-line, valid JSON object of the form {"text": "..."}.';

const PER_STEP: Record<WritingStep, string> = {
  meditatio:
    ' Reflect back what they noticed, and open it one turn deeper with a single gentle ' +
    'observation or question. Two to three sentences.',
  oratio:
    " Receive what they have said to God. Do not answer on God's behalf and do not speak as God. " +
    'Affirm what they brought, and at most offer words for something they seemed to be reaching ' +
    'for. Two to three sentences.',
  actio:
    ' Take their intention seriously. If it is vague, help them make it smaller and more ' +
    'concrete. One to two sentences, and never a list of further tasks.',
};

export function buildStepMessages(
  input: StepResponseInput
): { role: 'system' | 'user'; content: string }[] {
  const langName = input.lang === 'zh' ? 'Chinese' : 'English';
  const system = BASE(langName) + PER_STEP[input.step];

  let user = `Passage - ${input.passage.ref}: "${input.passage.text}"\n`;
  for (const prior of input.priorSteps) {
    user += `Earlier, at ${STEP_COPY[prior.step].name.en}, they wrote: "${prior.userText}"\n`;
  }
  user += `Now, at ${STEP_COPY[input.step].name.en}, they write: "${input.userText}"`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export async function generateStepResponse(
  input: StepResponseInput
): Promise<{ text: string | null }> {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: buildStepMessages(input),
      temperature: 0.7,
      max_completion_tokens: 200,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices[0];
    if (choice.finish_reason === 'length') return { text: null };
    const data = JSON.parse(choice.message.content ?? '{}');
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    return { text: text || null };
  } catch (e) {
    // The reader's words are saved by the caller regardless. Losing the
    // model's comment is acceptable; losing a prayer is not.
    console.error(
      `daily step reflection failed (${input.step}):`,
      e instanceof Error ? e.message : String(e)
    );
    return { text: null };
  }
}
