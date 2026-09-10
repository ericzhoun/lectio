// src/lib/assistantLoop.ts
// One assistant turn: let the model consult read tools, then let it speak.
// Write tools are proposals, never actions - they leave here as signed cards
// and only /api/assistant/act can redeem one.
import type OpenAI from 'openai';
import { getTool, validateArgs, toolSchemasFor, type CardSummary, type ToolContext } from './assistantTools';
import { signCardToken } from './assistantCards';

/** Hard cap: a model that keeps asking for tools gets cut off, not indulged. */
export const MAX_TOOL_HOPS = 3;

// Everything inside a tool result is data written by users. The rule text is
// defined in assistant.ts (where the system prompt is assembled) and re-exported
// here, so the loop and the prompt can never drift apart.
export { TOOL_DATA_RULE } from './assistant';

export interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelReply {
  toolCalls: ModelToolCall[];
}

export type LoopEvent =
  | { t: 'text'; v: string }
  | { t: 'card'; id: string; tool: string; token: string; summary: CardSummary };

type Messages = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

export async function* runAssistantTurn(opts: {
  messages: Messages;
  ctx: ToolContext;
  secret: string;
  callModel(messages: Messages, tools: unknown[]): Promise<ModelReply>;
  streamModel(messages: Messages): Promise<AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>>;
  onFirstText?(): Promise<void>;
}): AsyncGenerator<LoopEvent> {
  const messages: Messages = [...opts.messages];
  const tools = toolSchemasFor(opts.ctx);
  const cards: LoopEvent[] = [];

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop += 1) {
    const reply = await opts.callModel(messages, tools);
    if (reply.toolCalls.length === 0) break;

    let ranRead = false;
    for (const call of reply.toolCalls) {
      const tool = getTool(call.name);
      if (!tool) {
        messages.push(toolResult(call, { error: 'unknown_tool' }));
        ranRead = true;
        continue;
      }
      if (tool.auth === 'user' && !opts.ctx.userId) {
        messages.push(toolResult(call, { error: 'sign_in_required' }));
        ranRead = true;
        continue;
      }
      const validated = validateArgs(tool, call.args);
      if (!validated.ok) {
        messages.push(toolResult(call, { error: validated.error }));
        ranRead = true;
        continue;
      }
      // normalize, summarize and signing are all fallible; a throw anywhere in
      // here must become a tool result, not the end of the visitor's turn.
      try {
        const args = tool.normalize ? tool.normalize(validated.args, opts.ctx) : validated.args;

        if (tool.kind === 'write') {
          // Proposal only. The card carries the normalized args, so what the
          // visitor confirms is exactly what runs.
          const summary = tool.summarize!(args, opts.ctx);
          const token = await signCardToken(
            { tool: tool.name, args, visitorKey: opts.ctx.visitorKey },
            opts.secret
          );
          cards.push({ t: 'card', id: call.id, tool: tool.name, token, summary });
          messages.push(
            toolResult(call, {
              proposed: true,
              note: 'A confirmation card has been shown to the visitor. Tell them briefly what it will do and ask them to confirm. Do not claim it has happened.',
            })
          );
          continue;
        }

        ranRead = true;
        messages.push(toolResult(call, await tool.run(args, opts.ctx)));
      } catch (e) {
        console.error(`assistant tool ${tool.name} failed:`, e);
        messages.push(toolResult(call, { error: 'tool_failed' }));
        // A failed write never produced a card, so the model still needs a hop
        // to say so.
        ranRead = true;
      }
    }
    if (!ranRead) break;
  }

  let first = true;
  const stream = await opts.streamModel(messages);
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (!delta) continue;
    if (first) {
      first = false;
      await opts.onFirstText?.();
    }
    yield { t: 'text', v: delta };
  }
  for (const card of cards) yield card;
}

function toolResult(call: ModelToolCall, result: unknown): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  return {
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify(result),
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}
