// src/pages/api/roblox/explore.ts
// The world's Explore flow: entitlement -> record -> draw from the real
// 148-verse deck -> AI reflection, exactly the site's reading pipeline.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { drawVerses } from '../../../lib/scripture';
import { SPREADS, DEFAULT_QUESTIONS, type Lang } from '../../../lib/reading';
import { generateInterpretation } from '../../../lib/openai';
import { consumeCredit, ensureWelcomeCredits, type CreditBalance } from '../../../lib/credits';
import { getTodayUsage, incrementUsage } from '../../../lib/usage';
import {
  SPREAD_FOR_MODE,
  buildRobloxState,
  errorKeyForReason,
  evaluateRobloxEntitlement,
  getRobloxPlayer,
  guardRobloxRequest,
  json,
  readJsonBody,
  robloxPlayerKey,
  validPlayerId,
} from '../../../lib/roblox';

export const prerender = false;

const MODES = ['daily', 'divina', 'deep'] as const;
type Mode = (typeof MODES)[number];

export const POST: APIRoute = async ({ request }) => {
  const denied = guardRobloxRequest(request);
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body || !validPlayerId(body.playerId)) {
    return json({ ok: false, error: 'invalid_player' }, 400);
  }
  const mode = typeof body.mode === 'string' && (MODES as readonly string[]).includes(body.mode)
    ? (body.mode as Mode)
    : null;
  if (!mode) return json({ ok: false, error: 'invalid_mode' }, 400);
  const lang: Lang = body.lang === 'zh' ? 'zh' : 'en';

  // An empty topic falls back to the site's starter questions, like the
  // website's own empty-input behaviour.
  let topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 300) : '';
  if (!topic) {
    const questions = DEFAULT_QUESTIONS[lang];
    topic = questions[Math.floor(Math.random() * questions.length)];
  }

  const spreadKey = SPREAD_FOR_MODE[mode];
  const spread = SPREADS[spreadKey];
  const playerKey = robloxPlayerKey(body.playerId);
  const player = await getRobloxPlayer(env.DB, playerKey);

  const todayCount = await getTodayUsage(playerKey);
  const credits: CreditBalance = player.registered
    ? await ensureWelcomeCredits(playerKey, env.DB)
    : { '3card': 0, celtic_cross: 0 };
  const verdict = evaluateRobloxEntitlement({
    registered: player.registered,
    todayCount,
    spreadKey,
    credits,
  });
  if (!verdict.ok) {
    return json({ ok: false, errorKey: errorKeyForReason(verdict.reason, spreadKey) });
  }

  // Record like the site does: single draws burn the daily quota, multi-verse
  // layouts burn a welcome credit and leave the daily count alone.
  if (spreadKey === 'single') {
    await incrementUsage(playerKey);
  } else {
    await consumeCredit(playerKey, spreadKey as keyof CreditBalance, env.DB);
  }

  const verses = drawVerses(spread.number);
  verses.forEach((v, i) => {
    // The model ties each reflection to its position label in the requested
    // language; both labels travel so the world can re-render on toggle.
    v.position = spread.positions[lang][i] ?? '';
  });
  const interp = await generateInterpretation(topic, verses, lang, spreadKey);
  const outVerses = verses.map((v, i) => ({
    refEn: v.refEn,
    refZh: v.refZh,
    textEn: v.textEn,
    textZh: v.textZh,
    themeEn: v.themeEn,
    themeZh: v.themeZh,
    positionEn: spread.positions.en[i] ?? '',
    positionZh: spread.positions.zh[i] ?? '',
    interp: interp.cards[i]?.text ?? '',
    tags: interp.cards[i]?.tags ?? [],
  }));

  const state = await buildRobloxState(env.DB, playerKey, player.registered);
  return json({
    ok: true,
    mode,
    topic,
    verses: outVerses,
    summary: interp.summary,
    state,
  });
};
