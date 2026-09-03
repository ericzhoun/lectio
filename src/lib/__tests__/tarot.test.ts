import { describe, it, expect } from 'vitest';
import { getTarotDeck, drawCardsFromNames, rebuildDrawnCards, sanitizeDeckOrder, sanitizePickedIndices } from '../tarot';

const deck = getTarotDeck();
const names = deck.map((c) => c.en);

describe('sanitizeDeckOrder', () => {
  it('accepts a permutation of the deck', () => {
    const shuffled = [...names].reverse();
    expect(sanitizeDeckOrder(JSON.stringify(shuffled), deck)).toEqual(shuffled);
  });

  it('rejects payloads that are not a deck permutation', () => {
    expect(sanitizeDeckOrder('', deck)).toBeNull();
    expect(sanitizeDeckOrder('not json', deck)).toBeNull();
    expect(sanitizeDeckOrder(JSON.stringify(names.slice(0, 10)), deck)).toBeNull();
    expect(sanitizeDeckOrder(JSON.stringify([...names, names[0]]), deck)).toBeNull();
    expect(sanitizeDeckOrder(JSON.stringify(names.map((n) => n + '??')), deck)).toBeNull();
  });
});

describe('sanitizePickedIndices', () => {
  it('accepts distinct in-range indices in pick order', () => {
    expect(sanitizePickedIndices('3,77,0', names.length, 3)).toEqual([3, 77, 0]);
  });

  it('rejects malformed picks', () => {
    expect(sanitizePickedIndices('1,2', names.length, 3)).toBeNull();
    expect(sanitizePickedIndices('1,2,2', names.length, 3)).toBeNull();
    expect(sanitizePickedIndices('1,2,-1', names.length, 3)).toBeNull();
    expect(sanitizePickedIndices('1,2,78', names.length, 3)).toBeNull();
    expect(sanitizePickedIndices('a,b,c', names.length, 3)).toBeNull();
    expect(sanitizePickedIndices('', names.length, 3)).toBeNull();
  });
});

describe('drawCardsFromNames', () => {
  it('returns exactly the requested cards, never duplicates or unknown names', () => {
    const drawn = drawCardsFromNames(deck, [names[5], names[10], 'Not A Card', names[5]], false, 'en');
    expect(drawn.map((c) => c.en)).toEqual([names[5], names[10]]);
    expect(drawn.every((c) => c.reversed === false)).toBe(true);
  });

  it('respects allowReversed', () => {
    const many = drawCardsFromNames(deck, names.slice(0, 40), true, 'en');
    expect(many.length).toBe(40);
    expect(many.some((c) => c.reversed)).toBe(true);
  });
});

describe('rebuildDrawnCards', () => {
  it('restores exact orientations and skips unknown names', () => {
    const drawn = rebuildDrawnCards(
      deck,
      [
        { en: names[7], reversed: true },
        { en: names[9], reversed: false },
        { en: 'Made Up Card', reversed: true },
      ],
      'zh'
    );
    expect(drawn).toHaveLength(2);
    expect(drawn[0].reversed).toBe(true);
    expect(drawn[1].reversed).toBe(false);
    expect(drawn.every((c) => c.zh && c.image_url && c.meaning)).toBe(true);
  });

  it('deduplicates repeated names', () => {
    const drawn = rebuildDrawnCards(deck, [{ en: names[0], reversed: false }, { en: names[0], reversed: true }], 'en');
    expect(drawn).toHaveLength(1);
  });
});
