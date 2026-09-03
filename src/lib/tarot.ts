// Ported from tarot_draw.py + the SPREADS dict in app.py
import { cardMeanings, deck, type DeckCard } from './deckData';

export type Lang = 'zh' | 'en';

export function cardSlug(cardName: string): string {
  return cardName
    .toLowerCase()
    .replace(/ /g, '_')
    .replace(/'/g, '')
    .replace(/-/g, '_');
}

export function getTarotDeck(): DeckCard[] {
  return deck;
}

export interface DrawnCard {
  zh: string;
  en: string;
  meaning: string;
  reversed: boolean;
  image_url: string;
  position?: string;
  interp_text?: string;
  tags?: string[];
}

/** Build a DrawnCard for a specific card in a specific orientation. */
function toDrawnCard(card: DeckCard, isReversed: boolean, lang: Lang): DrawnCard {
  const meaningEntry = cardMeanings[card.en][lang];
  const meaning = isReversed ? meaningEntry.reversed : meaningEntry.upright;
  const slug = cardSlug(card.en);
  return {
    zh: card.zh,
    en: card.en,
    meaning,
    reversed: isReversed,
    image_url: `/images/${slug}.webp`,
  };
}

export function drawCards(
  sourceDeck: DeckCard[],
  number = 1,
  allowReversed = false,
  lang: Lang = 'en'
): DrawnCard[] {
  const available = [...sourceDeck];
  const drawn: DrawnCard[] = [];
  const count = Math.min(number, available.length);

  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * available.length);
    const card = available.splice(idx, 1)[0];
    const isReversed = allowReversed ? Math.random() < 0.5 : false;
    drawn.push(toDrawnCard(card, isReversed, lang));
  }
  return drawn;
}

/**
 * Build DrawnCards for specific card names, deciding reversal randomly
 * (used when the visitor picked cards from the visual fan).
 */
export function drawCardsFromNames(
  sourceDeck: DeckCard[],
  names: string[],
  allowReversed = false,
  lang: Lang = 'en'
): DrawnCard[] {
  const byName = new Map(sourceDeck.map((c) => [c.en, c]));
  const picked: Array<{ en: string; reversed: boolean }> = [];
  for (const name of names) {
    if (!byName.has(name) || picked.some((p) => p.en === name)) continue;
    picked.push({ en: name, reversed: allowReversed ? Math.random() < 0.5 : false });
  }
  return rebuildDrawnCards(sourceDeck, picked, lang);
}

/**
 * Rebuild DrawnCards from explicit name + orientation pairs (no randomness).
 * Used to restore a pending draw from its signed cookie. Unknown names are
 * skipped so a stale cookie can never inject cards outside the deck.
 */
export function rebuildDrawnCards(
  sourceDeck: DeckCard[],
  picked: Array<{ en: string; reversed: boolean }>,
  lang: Lang = 'en'
): DrawnCard[] {
  const byName = new Map(sourceDeck.map((c) => [c.en, c]));
  const seen = new Set<string>();
  const drawn: DrawnCard[] = [];
  for (const p of picked) {
    const card = byName.get(p.en);
    if (!card || seen.has(p.en)) continue;
    seen.add(p.en);
    drawn.push(toDrawnCard(card, p.reversed, lang));
  }
  return drawn;
}

/**
 * Validate the shuffled deck order embedded in the pick-a-card form.
 * Returns the names when the payload is a permutation of the deck, else null.
 */
export function sanitizeDeckOrder(raw: string, sourceDeck: DeckCard[]): string[] | null {
  if (!raw || raw.length > 4096) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== sourceDeck.length) return null;
  const names = new Set(sourceDeck.map((c) => c.en));
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== 'string' || !names.has(item) || seen.has(item)) return null;
    seen.add(item);
  }
  return arr as string[];
}

/**
 * Validate the visitor's fan picks: exactly `count` distinct, in-range
 * indices, in pick order (first pick = first spread position).
 */
export function sanitizePickedIndices(raw: string, deckSize: number, count: number): number[] | null {
  if (!raw || raw.length > 64) return null;
  const parts = raw.split(',');
  if (parts.length !== count) return null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n >= deckSize || seen.has(n)) return null;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// Tarot spreads, mirroring thefreetarot.com/reading: single card, three card, Celtic Cross
export interface Spread {
  number: number;
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  positions: Record<Lang, string[]>;
}

export const SPREADS: Record<string, Spread> = {
  single: {
    number: 1,
    name: { zh: '单牌占卜', en: 'Single Card' },
    description: { zh: '一张牌揭示当下的核心信息', en: 'One card reveals the core message of the moment' },
    positions: { zh: ['核心信息'], en: ['Core Message'] },
  },
  '3card': {
    number: 3,
    name: { zh: '三牌占卜', en: 'Three Card' },
    description: { zh: '三张牌呈现事物的过去、现在与未来', en: 'Three cards reveal the past, present, and future' },
    positions: { zh: ['过去', '现在', '未来'], en: ['Past', 'Present', 'Future'] },
  },
  celtic_cross: {
    number: 10,
    name: { zh: '凯尔特十字', en: 'Celtic Cross' },
    description: { zh: '经典十牌阵，全面深入解读你的问题', en: 'Classic ten-card spread for a thorough, in-depth reading' },
    positions: {
      zh: ['现状', '挑战', '远因', '近因', '可能的发展', '近期未来', '自身态度', '外在环境', '希望与恐惧', '最终结果'],
      en: [
        'Present Situation', 'Challenge', 'Distant Past', 'Recent Past', 'Best Outcome',
        'Near Future', 'Your Attitude', 'External Influences', 'Hopes and Fears', 'Final Outcome',
      ],
    },
  },
};

export const DEFAULT_QUESTIONS: Record<Lang, string[]> = {
  zh: [
    '最近在事业上会遇到什么机遇？',
    '我的感情生活会有什么变化？',
    '接下来这段时间需要注意什么？',
    '我该如何提升自己的能量？',
    '请问我明天会遇到什么有趣的事？',
  ],
  en: [
    'What career opportunities will I encounter soon?',
    'How will my love life change?',
    'What should I be aware of in the coming period?',
    'How can I enhance my energy?',
    'What interesting things will happen to me tomorrow?',
  ],
};

export interface LibraryCard {
  slug: string;
  en: string;
  zh: string;
  suit: 'major' | 'wands' | 'cups' | 'swords' | 'pentacles';
  image_url: string;
  meaning_zh: { upright: string; reversed: string };
  meaning_en: { upright: string; reversed: string };
}

const SUIT_MAP: Record<string, LibraryCard['suit']> = {
  Wands: 'wands', '权杖': 'wands',
  Cups: 'cups', '圣杯': 'cups',
  Swords: 'swords', '宝剑': 'swords',
  Pentacles: 'pentacles', '星币': 'pentacles',
};

export function getLibraryCards(): LibraryCard[] {
  return deck.map((card) => {
    const slug = cardSlug(card.en);
    let suit: LibraryCard['suit'] = 'major';
    for (const [key, val] of Object.entries(SUIT_MAP)) {
      if (card.en.includes(key)) {
        suit = val;
        break;
      }
    }
    return {
      slug,
      en: card.en,
      zh: card.zh,
      suit,
      image_url: `/images/${slug}.webp`,
      meaning_zh: cardMeanings[card.en].zh,
      meaning_en: cardMeanings[card.en].en,
    };
  });
}
