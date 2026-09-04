import OpenAI from 'openai';
import { SPREADS, type Lang } from './reading';
import { type DrawnVerse } from './scripture';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface InterpretationResult {
  summary: string;
  cards: { text: string; tags: string[] }[];
}

/** Shared parser for the {cards: [...], summary} JSON contract. */
function parseInterpretationResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
  itemCount: number
): InterpretationResult {
  const choice = response.choices[0];
  if (choice.finish_reason === 'length') {
    throw new Error('response truncated (finish_reason=length)');
  }
  const data = JSON.parse(choice.message.content ?? '{}');
  const cards: { text: string; tags: string[] }[] = data.cards ?? [];
  while (cards.length < itemCount) cards.push({ text: '', tags: [] });
  return { summary: (data.summary ?? '').trim(), cards: cards.slice(0, itemCount) };
}

/** Per-verse scripture reflection plus an overall summary. */
export async function generateInterpretation(
  question: string,
  verses: DrawnVerse[],
  lang: Lang = 'en',
  spreadKey = 'single'
): Promise<InterpretationResult> {
  const spread = SPREADS[spreadKey] ?? SPREADS.single;
  const langName = lang === 'zh' ? 'Chinese' : 'English';
  const singleVerse = verses.length === 1;
  const jsonShape = singleVerse
    ? '{"cards": [{"text": "...", "tags": ["...", "...", "..."]}], "summary": ""}'
    : '{"cards": [{"text": "...", "tags": ["...", "...", "..."]}, ...], "summary": "..."}';
  const systemMsg =
    'You are a thoughtful, encouraging companion for Lectio Divina — the ancient practice of ' +
    'slow, prayerful scripture reading. The user has received scripture verses to sit with alongside their question. ' +
    (singleVerse
      ? `Respond ONLY with a single-line, valid, complete JSON object of the form ${jsonShape}. ` +
        "The 'cards' array must have exactly one entry with a brief reflection (1-2 sentences) " +
        "that connects the verse's message to the user's question, plus exactly 3 short keyword tags (1-3 words each). " +
        "Leave 'summary' as an empty string. "
      : `The user is using the '${spread.name.en}' layout, where each verse addresses one aspect of their question. ` +
        `Respond ONLY with a single-line, valid, complete JSON object of the form ${jsonShape}. ` +
        "The 'cards' array must have exactly one entry per drawn verse, in the same order, " +
        'each with a brief reflection (1-2 sentences) that connects the verse\'s message to its position label and the user\'s question, ' +
        'and exactly 3 short keyword tags (1-3 words each). ' +
        "The 'summary' is a short overall reflection (2-4 sentences) that ties the positions together. ") +
    'The tone must be warm, hopeful and respectful. Never predict the future or tell fortunes — ' +
    'this is contemplative reading, not divination. ' +
    'Do not invent or cite Bible references other than the verses given; ' +
    'focus on inspiring self-reflection, comfort and encouragement. ' +
    'Keep every field concise so the JSON always fits within the token limit and is never truncated. ' +
    `Write all text in ${langName}.`;

  let userContent = `User's question: ${question}\nDrawn verses:\n`;
  for (const v of verses) {
    userContent += `- [${v.position ?? ''}] ${v.refEn} (${v.refZh}): "${v.textEn}" / 「${v.textZh}」 — Theme: ${v.themeEn}\n`;
  }

  // Verse text is longer than card meanings, so use a larger per-item budget.
  const maxCompletionTokens = Math.min(4000, 300 + 220 * verses.length);

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_completion_tokens: maxCompletionTokens,
      response_format: { type: 'json_object' },
    });

    return parseInterpretationResponse(response, verses.length);
  } catch (e) {
    return {
      summary: `Error generating interpretation: ${e instanceof Error ? e.message : e}`,
      cards: verses.map(() => ({ text: '', tags: [] })),
    };
  }
}

/** Generate 3 relevant follow-up questions based on the interpretation. */
export async function generateFollowUpQuestions(
  question: string,
  interpretation: string,
  lang: Lang = 'en'
): Promise<string[]> {
  const systemMsg =
    'You are a helpful companion for scripture reflection. ' +
    "Based on the user's original question and the reflection they just read, " +
    'generate 3 relevant follow-up questions that the user might want to ask next, separated by line breaks. ' +
    'These questions should be natural and flow from the previous reflection. ' +
    'Do not include any numbering or bullet points in the questions.';

  const userMsg =
    `Original question: ${question}\nInterpretation: ${interpretation}\n\n` +
    'Generate 3 relevant follow-up questions, separated by line breaks, without numbering or symbols. ' +
    `Please keep one question per line. Please use "I" statement Please respond in ${lang === 'zh' ? 'Chinese' : 'English'}. ` +
    '中文问题请用"我"开头';

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.7,
      max_completion_tokens: 200,
    });
    const text = response.choices[0].message.content?.trim() ?? '';
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^\d/.test(l) && !/^([•\-*]|1\.|2\.|3\.)/.test(l))
      .slice(0, 3);
  } catch (e) {
    console.error('Error generating follow-up questions:', e);
    return [];
  }
}
