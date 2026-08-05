import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeck, shuffle, canBeat, ranksOnTable, sortCards,
  nextActiveIdx, refillOrder, throwOrder, maxPairs, canThrowMore,
  botPickAttack, botPickThrow, botPickDefense, findFirstAttacker,
  checkEnd,
} from '../src/shared/game.js';

describe('buildDeck', () => {
  it('36 cards — ranks 6-14', () => {
    const deck = buildDeck(36);
    assert.equal(deck.length, 36);
    const ids = new Set(deck.map(c => c.id));
    assert.equal(ids.size, 36);
  });

  it('52 cards — ranks 2-14', () => {
    const deck = buildDeck(52);
    assert.equal(deck.length, 52);
    const ids = new Set(deck.map(c => c.id));
    assert.equal(ids.size, 52);
  });
});

describe('shuffle', () => {
  it('returns the same number of cards', () => {
    const deck = buildDeck(36);
    const shuffled = shuffle([...deck]);
    assert.equal(shuffled.length, 36);
  });
});

describe('canBeat', () => {
  const trump = '♥';
  it('same suit — higher rank wins', () => {
    assert.ok(canBeat({ rank: 10, suit: '♠' }, { rank: 7, suit: '♠' }, trump));
    assert.equal(canBeat({ rank: 5, suit: '♠' }, { rank: 10, suit: '♠' }, trump), false);
  });
  it('trump beats non-trump', () => {
    assert.ok(canBeat({ rank: 6, suit: '♥' }, { rank: 14, suit: '♣' }, trump));
  });
  it('non-trump cannot beat trump', () => {
    assert.equal(canBeat({ rank: 14, suit: '♠' }, { rank: 6, suit: '♥' }, trump), false);
  });
});

describe('ranksOnTable', () => {
  it('collects ranks from attack and defense pairs', () => {
    const table = [
      { attack: { rank: 6, suit: '♠' }, defense: { rank: 10, suit: '♠' } },
      { attack: { rank: 7, suit: '♦' }, defense: null },
    ];
    const ranks = ranksOnTable(table);
    assert.ok(ranks.has(6));
    assert.ok(ranks.has(10));
    assert.ok(ranks.has(7));
    assert.equal(ranks.size, 3);
  });
});

describe('sortCards', () => {
  it('sorts non-trumps before trumps, then by suit and rank', () => {
    const cards = [
      { id: 'a', suit: '♥', rank: 8 },
      { id: 'b', suit: '♠', rank: 10 },
      { id: 'c', suit: '♥', rank: 6 },
      { id: 'd', suit: '♣', rank: 7 },
    ];
    const sorted = sortCards(cards, '♥');
    assert.equal(sorted[0].id, 'b'); // ♠ (first in SUITS)
    assert.equal(sorted[1].id, 'd'); // ♣ (last in SUITS)
    assert.equal(sorted[2].id, 'c'); // ♥ 6
    assert.equal(sorted[3].id, 'a'); // ♥ 8
  });
});

describe('nextActiveIdx', () => {
  it('skips out players', () => {
    const players = [{ out: false }, { out: true }, { out: false }];
    assert.equal(nextActiveIdx(players, 0), 2);
  });
  it('returns -1 if all out', () => {
    const players = [{ out: true }, { out: true }];
    assert.equal(nextActiveIdx(players, 0), -1);
  });
});

describe('refillOrder', () => {
  it('puts defender last', () => {
    const players = [{ out: false }, { out: false }, { out: false }];
    const order = refillOrder(players, 0, 1);
    assert.deepEqual(order, [0, 2, 1]);
  });
});

describe('throwOrder', () => {
  const players = [
    { out: false, hand: ['a'] },
    { out: false, hand: ['b'] },
    { out: false, hand: [] },
    { out: false, hand: ['d'] },
  ];
  it('throwAll = true includes all non-defender with cards', () => {
    const order = throwOrder(players, 0, 1, true);
    assert.deepEqual(order, [0, 3]); // skipping 2 (no hand) and 1 (defender)
  });
});

describe('maxPairs / canThrowMore', () => {
  it('max 5 with first5, else 6', () => {
    assert.equal(maxPairs(true, true), 5);
    assert.equal(maxPairs(false, true), 6);
  });
  it('cannot throw more than defender hand size', () => {
    assert.equal(canThrowMore([{ a: 1 }, { a: 2 }, { a: 3 }], 2, false, false), false);
    assert.ok(canThrowMore([{ a: 1 }], 3, false, false));
  });
});

describe('findFirstAttacker', () => {
  it('finds the player with lowest trump', () => {
    const players = [
      { hand: [{ suit: '♠', rank: 10 }] },
      { hand: [{ suit: '♥', rank: 7 }, { suit: '♥', rank: 12 }] },
      { hand: [{ suit: '♥', rank: 6 }] },
    ];
    assert.equal(findFirstAttacker(players, '♥'), 2);
  });
});

describe('checkEnd', () => {
  it('returns false when deck has cards', () => {
    assert.equal(checkEnd([{ hand: [], out: false }], 3), false);
  });
  it('returns true when only one player not out and deck empty', () => {
    const players = [
      { hand: [1], out: false },
      { hand: [], out: false },
      { hand: [], out: false },
    ];
    assert.ok(checkEnd(players, 0));
    assert.ok(players[1].out);
    assert.ok(players[2].out);
  });
});

describe('botPickThrow', () => {
  it('returns null when no ranks match', () => {
    const hand = [{ rank: 8, suit: '♠' }];
    const table = [{ attack: { rank: 7, suit: '♦' }, defense: null }];
    assert.equal(botPickThrow(hand, table, '♥', 6, 10), null);
  });
  it('returns low non-trump when possible', () => {
    const hand = [
      { rank: 8, suit: '♠', id: 'a' },
      { rank: 12, suit: '♥', id: 'b' },
    ];
    const table = [{ attack: { rank: 8, suit: '♦' }, defense: null }];
    const c = botPickThrow(hand, table, '♥', 6, 10);
    assert.ok(c);
    assert.equal(c.id, 'a');
  });
});
