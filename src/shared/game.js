/**
 * Shared game logic: cards, deck, rules.
 * Pure functions — no DOM, no network.
 */

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANK_LABELS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };

/** Build a deck: 36 cards (rank 6-14) or 52 cards (rank 2-14). */
export function buildDeck(size = 36) {
  const ranks = size === 52 ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
                             : [6, 7, 8, 9, 10, 11, 12, 13, 14];
  return SUITS.flatMap(suit => ranks.map(rank => ({ id: suit + rank, suit, rank })));
}

/** Fisher-Yates shuffle in place. Returns the same array. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Can `def` beat `atk` given the trump suit? */
export function canBeat(def, atk, trumpSuit) {
  if (def.suit === atk.suit) return def.rank > atk.rank;
  return def.suit === trumpSuit;
}

/** Set of all ranks currently on the table. */
export function ranksOnTable(table) {
  const s = new Set();
  for (const entry of table) {
    s.add(entry.attack.rank);
    if (entry.defense) s.add(entry.defense.rank);
  }
  return s;
}

/** Sort hand: non-trumps first by suit/rank, trumps last by rank. */
export function sortCards(hand, trumpSuit) {
  return hand.slice().sort((a, b) => {
    const ta = a.suit === trumpSuit ? 1 : 0;
    const tb = b.suit === trumpSuit ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    return a.rank - b.rank;
  });
}

/** Find the next active player index (clockwise, skipping `out` players). */
export function nextActiveIdx(players, from) {
  const n = players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!players[i].out) return i;
  }
  return -1;
}

/** Refill order: attackers first (clockwise from roundAttacker), defender last. */
export function refillOrder(players, attackerIdx, defenderIdx) {
  const n = players.length;
  const order = [];
  for (let k = 0; k < n; k++) {
    const i = (attackerIdx + k) % n;
    if (!players[i].out && i !== defenderIdx) order.push(i);
  }
  if (!players[defenderIdx].out) order.push(defenderIdx);
  return order;
}

/** Throw-in order: all active non-defender players (filtered later by throwAll/nb). */
export function throwOrder(players, attackerIdx, defenderIdx, throwAll) {
  const n = players.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const idx = (attackerIdx + k) % n;
    const p = players[idx];
    if (idx === defenderIdx || p.out || !p.hand.length) continue;
    if (!throwAll) {
      const nb = idx === attackerIdx
        || nextActiveIdx(players, idx) === defenderIdx
        || nextActiveIdx(players, defenderIdx) === idx;
      if (!nb) continue;
    }
    out.push(idx);
  }
  return out;
}

/** Maximum pairs on the table (5 in first round with first5 option, otherwise 6). */
export function maxPairs(firstRound, first5) {
  return firstRound && first5 ? 5 : 6;
}

/** How many more pairs can be added given the current table and the defender's hand size. */
export function canThrowMore(table, defenderHandSize, firstRound, first5) {
  return table.length < maxPairs(firstRound, first5) && defenderHandSize > 0
    && table.length < defenderHandSize; // classic rule: no more than defender can beat
}

/** Bot: pick the lowest card to attack with. */
export function botPickAttack(hand, trumpSuit) {
  const s = sortCards(hand, trumpSuit);
  return s.length ? s[0] : null;
}

/** Bot: pick a non-trump card to throw in, or null if risky. */
export function botPickThrow(hand, table, trumpSuit, defenderHandSize, deckSize) {
  const ranks = ranksOnTable(table);
  if (!ranks.size) return null;
  const nonT = hand
    .filter(c => ranks.has(c.rank) && c.suit !== trumpSuit)
    .sort((a, b) => a.rank - b.rank);
  if (!nonT.length) return null;
  const c = nonT[0];
  if (c.rank <= 9) return c;
  if (deckSize === 0) return c;
  if (defenderHandSize >= 4 && c.rank <= 11) return c;
  return null;
}

/** Bot: pick the cheapest card to beat the attack, or null to take. */
export function botPickDefense(hand, atk, trumpSuit, deckSize, tableSize) {
  if (!atk) return null;
  const beaters = hand
    .filter(c => canBeat(c, atk, trumpSuit))
    .sort((a, b) => {
      const ta = a.suit === trumpSuit ? 1 : 0;
      const tb = b.suit === trumpSuit ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return a.rank - b.rank;
    });
  if (!beaters.length) return null;
  const b = beaters[0];
  // Strategic: don't waste a high trump on a weak card early in the game
  if (b.suit === trumpSuit && atk.suit !== trumpSuit && b.rank >= 11 && atk.rank <= 8 && deckSize > 3 && tableSize <= 2)
    return null;
  return b;
}

/** Find who has the lowest trump — they attack first. */
export function findFirstAttacker(players, trumpSuit) {
  let first = 0;
  let best = 99;
  players.forEach((p, ix) => {
    p.hand.forEach(c => {
      if (c.suit === trumpSuit && c.rank < best) {
        best = c.rank;
        first = ix;
      }
    });
  });
  return first;
}

/** Check if the game is over. Marks players with empty hand as `out`. */
export function checkEnd(players, deckSize) {
  if (deckSize > 0) return false;
  for (const p of players) {
    if (!p.hand.length) p.out = true;
  }
  const alive = players.filter(p => !p.out);
  return alive.length <= 1;
}
