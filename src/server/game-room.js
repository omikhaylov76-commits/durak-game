import {
  buildDeck, shuffle, canBeat, sortCards, nextActiveIdx,
  refillOrder, throwOrder, canThrowMore,
  botPickAttack, botPickThrow, botPickDefense,
  findFirstAttacker, checkEnd, ranksOnTable,
} from '../shared/game.js';

/**
 * Authoritative game room. All game logic runs here on the server.
 * Each client only receives their own masked state.
 */
export class GameRoom {
  constructor(code, opts, hostId) {
    this.code = code;
    this.opts = opts;          // { count, deck: 36|52, throwAll, first5 }
    this.hostId = hostId;
    this.players = [];         // [{ id, name, hand, out, bot, seat }]
    this.deck = [];
    this.trumpCard = null;
    this.trumpSuit = null;
    this.trumpInDeck = false;
    this.discard = [];
    this.table = [];           // [{ attack: card, defense: card|null }]
    this.attackerIdx = 0;
    this.defenderIdx = -1;
    this.nextAttacker = 0;
    this.roundAttacker = 0;
    this.turnIdx = -1;
    this.running = false;
    this.over = undefined;
    this.firstRound = true;
    this.quickNext = false;
    this.wait = null;          // { idx, type, valid: Set, deadline, resolve }
    this.timer = null;
    this.stateVersion = 0;
    this._onChange = null; // set by server
  }

  _changed() {
    this.stateVersion++;
    if (this._onChange) this._onChange();
  }

  /** Start a new game. If players is null, fill remaining seats with bots. */
  start(players) {
    this.players = players || [];
    const names = ['Китти'];
    for (let i = this.players.length; i < this.opts.count; i++) {
      this.players.push({
        id: `bot-${i}`,
        name: names[i - this.players.length] || `Бот ${i + 1}`,
        hand: [],
        out: false,
        bot: true,
        seat: i,
      });
    }
    // Deal cards
    this.deck = shuffle(buildDeck(this.opts.deck));
    this.trumpCard = this.deck[0];
    this.trumpSuit = this.trumpCard.suit;
    this.trumpInDeck = true;
    this.discard = [];
    this.table = [];
    this.firstRound = true;
    this.over = undefined;
    for (let k = 0; k < 6; k++)
      for (const p of this.players) p.hand.push(this.deck.pop());
    for (const p of this.players) p.hand = sortCards(p.hand, this.trumpSuit);

    this.attackerIdx = findFirstAttacker(this.players, this.trumpSuit);
    this.running = true;
    this._changed();
    this.quickNext = false;
    this._nextStep();
  }

  /** Connect a human player (guest) to a seat. */
  addPlayer(id, name, seat) {
    if (seat < 1 || seat >= this.opts.count) return false;
    for (const p of this.players) {
      if (p.seat === seat && !p.bot) return false; // already taken
    }
    this.players[seat] = { id, name, hand: [], out: false, bot: false, seat };
    return true;
  }

  /** Replace a disconnected human with a bot. */
  playerLeft(id) {
    const p = this.players.find(p => p.id === id);
    if (p) { p.bot = true; p.id = `bot-${p.seat}`; }
    // If it was the waiting player's turn and they disconnected, auto-resolve
    if (this.wait && this.wait.idx === p?.seat && p?.bot) {
      this._autoResolve();
    }
  }

  /** Process an action from a network player. */
  handleAction(playerId, action) {
    const w = this.wait;
    if (!w) return;
    const p = this.players[w.idx];
    if (!p || p.id !== playerId || p.bot) return;

    if (w.type === 'defend') {
      if (action.kind === 'take') w.resolve({ take: true });
      else if (action.cardId) {
        const card = p.hand.find(c => c.id === action.cardId);
        const pending = this._pendingAttack();
        if (card && pending && canBeat(card, pending, this.trumpSuit))
          w.resolve({ card });
      }
    } else {
      if (action.kind === 'pass') w.resolve(null);
      else if (action.cardId) {
        const card = p.hand.find(c => c.id === action.cardId);
        if (card && w.valid.has(card.id)) w.resolve({ card });
      }
    }
  }

  /** Get masked state for a specific seat (player index). */
  getState(forSeat) {
    const n = this.players.length;
    const rot = (i) => (i - forSeat + n) % n;

    // Rotate so the requesting player is always at index 0
    const players = [];
    for (let k = 0; k < n; k++) {
      const srcIdx = (forSeat + k) % n;
      const src = this.players[srcIdx];
      const isMe = k === 0;
      players.push({
        name: src.name,
        out: src.out,
        handSize: src.hand.length,
        hand: isMe ? src.hand.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })) : [],
        bot: src.bot,
        seat: k,
      });
    }

    // Collect all cards this seat can see for identity mapping in the client
    const allCards = [];
    // my own hand
    const myPlayer = this.players[forSeat];
    if (myPlayer) allCards.push(...myPlayer.hand);
    // table cards
    for (const entry of this.table) {
      allCards.push(entry.attack);
      if (entry.defense) allCards.push(entry.defense);
    }
    // discard
    allCards.push(...this.discard);
    // trump card if visible
    if (!this.trumpInDeck && this.trumpCard) allCards.push(this.trumpCard);

    const wait = this.wait && this.wait.idx === forSeat ? {
      type: this.wait.type,
      valid: this.wait.type !== 'defend' ? Array.from(this.wait.valid) : null, // don't leak valid cards for defend
    } : null;

    return {
      players,
      table: this.table,
      discardLen: this.discard.length,
      deckLen: this.deck.length,
      trumpSuit: this.trumpSuit,
      trumpInDeck: this.trumpInDeck,
      trumpCardId: this.trumpInDeck ? null : this.trumpCard?.id,
      attackerIdx: rot(this.attackerIdx),
      defenderIdx: this.defenderIdx < 0 ? -1 : rot(this.defenderIdx),
      turnIdx: rot(this.turnIdx),
      wait,
      opts: this.opts,
      firstRound: this.firstRound,
      over: this.over !== undefined ? rot(this.over) : undefined,
      allCards, // all visible cards for identity linking
      version: this.stateVersion,
    };
  }

  // ---- internal game loop ----

  _pendingAttack() {
    return this.table.find(e => !e.defense)?.attack || null;
  }

  _nextStep() {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    // Bot-only autoplay: move fast
    const currentPlayer = this.wait ? this.players[this.wait.idx] : null;
    if (currentPlayer?.bot && this.wait) {
      this.timer = setTimeout(() => this._autoResolve(), 300);
      return;
    }

    // If no wait, advance the game loop
    if (!this.wait) {
      this.timer = setTimeout(() => this._gameStep(), 200);
    }
    // If wait is on a human, set a 30-second timeout
    if (this.wait && !this.players[this.wait.idx]?.bot) {
      this.wait.deadline = Date.now() + 30000;
      this.timer = setTimeout(() => this._autoResolve(), 30000);
      this._changed();
    }
  }

  _autoResolve() {
    const w = this.wait;
    if (!w) return;
    const p = this.players[w.idx];
    if (!p || !p.bot) return;

    if (w.type === 'defend') {
      const c = botPickDefense(p.hand, this._pendingAttack(), this.trumpSuit, this.deck.length, this.table.length);
      w.resolve(c ? { card: c } : { take: true });
    } else if (w.type === 'attack') {
      w.resolve({ card: botPickAttack(p.hand, this.trumpSuit) });
    } else {
      w.resolve(null);
    }
  }

  async _askPlayer(idx, type) {
    const p = this.players[idx];
    this.turnIdx = idx;
    this._changed();

    if (p.bot) {
      return new Promise(resolve => {
        this.wait = { idx, type, valid: null, resolve };
        this._nextStep();
      });
    }

    // Human player
    let valid = null;
    if (type === 'attack') {
      valid = new Set(p.hand.map(c => c.id));
    } else if (type === 'throw') {
      const ranks = ranksOnTable(this.table);
      valid = new Set();
      for (const c of p.hand) if (ranks.has(c.rank)) valid.add(c.id);
      if (!valid.size) {
        this._changed(); // signal "no cards to throw"
        return null;
      }
    }

    return new Promise(resolve => {
      this.wait = { idx, type, valid, resolve };
      this._nextStep();
    });
  }

  _applyAttack(idx, card) {
    const p = this.players[idx];
    p.hand = p.hand.filter(c => c.id !== card.id);
    this.table.push({ attack: card, defense: null });
    if (idx === 0) p.hand = sortCards(p.hand, this.trumpSuit);
  }

  _applyDefense(card) {
    const p = this.players[this.defenderIdx];
    p.hand = p.hand.filter(c => c.id !== card.id);
    const entry = this.table.find(e => !e.defense);
    if (entry) entry.defense = card;
    if (this.defenderIdx === 0) p.hand = sortCards(p.hand, this.trumpSuit);
  }

  _applyTake() {
    const p = this.players[this.defenderIdx];
    const cards = [];
    for (const e of this.table) {
      cards.push(e.attack);
      if (e.defense) cards.push(e.defense);
    }
    p.hand.push(...cards);
    p.hand = sortCards(p.hand, this.trumpSuit);
    this.quickNext = true;
    this.table = [];
    this.nextAttacker = nextActiveIdx(this.players, this.defenderIdx);
    if (this.nextAttacker < 0) this.nextAttacker = this.defenderIdx;
  }

  _applyBito() {
    for (const e of this.table) {
      this.discard.push(e.attack);
      if (e.defense) this.discard.push(e.defense);
    }
    this.table = [];
    this.nextAttacker = this.defenderIdx;
  }

  _refill() {
    const order = refillOrder(this.players, this.roundAttacker, this.defenderIdx);
    for (const idx of order) {
      const p = this.players[idx];
      while (p.hand.length < 6 && this.deck.length) {
        const c = this.deck.pop();
        if (c === this.trumpCard) this.trumpInDeck = false;
        p.hand.push(c);
      }
      if (idx === 0) p.hand = sortCards(p.hand, this.trumpSuit);
    }
  }

  async _defendOnce() {
    const res = await this._askPlayer(this.defenderIdx, 'defend');
    if (!this.running) return true;
    if (!res || res.take) {
      this._applyTake();
      this._changed();
      return true;
    }
    this._applyDefense(res.card);
    this._changed();
    return false;
  }

  async _throwLoop() {
    const order = throwOrder(this.players, this.attackerIdx, this.defenderIdx, this.opts.throwAll);
    let passes = 0;
    let i = 0;

    while (this.running) {
      if (!canThrowMore(this.table, this.players[this.defenderIdx].hand.length, this.firstRound, this.opts.first5)
          || passes >= order.length)
        return false;

      const idx = order[i % order.length];
      const act = await this._askPlayer(idx, 'throw');
      if (!this.running) return true;
      if (!act || !act.card) {
        passes++;
        i++;
        continue;
      }
      passes = 0;
      this._applyAttack(idx, act.card);
      this._changed();
      const took = await this._defendOnce();
      if (took) return true;
      i++;
    }
    return false;
  }

  async _gameStep() {
    try {
    if (!this.running) return;
    this.wait = null;

    // Determine defender
    this.defenderIdx = nextActiveIdx(this.players, this.attackerIdx);
    if (this.defenderIdx < 0 || this.defenderIdx === this.attackerIdx) {
      this.defenderIdx = nextActiveIdx(this.players, this.attackerIdx);
    }
    this.turnIdx = this.attackerIdx;
    this.table = [];
    this.roundAttacker = this.attackerIdx;
    this._changed();

    // First attack
    const a1 = await this._askPlayer(this.attackerIdx, 'attack');
    if (!this.running) return;
    if (!a1 || !a1.card) { this._roundDone(); return; }
    this._applyAttack(this.attackerIdx, a1.card);
    this._changed();

    // Defend
    const took = await this._defendOnce();
    if (!this.running) return;
    if (took) { this._roundDone(); return; }

    // Throw loop
    const stopped = await this._throwLoop();
    if (!this.running) return;
    if (stopped) { this._roundDone(); return; }

    this.nextAttacker = this.defenderIdx;
    this._applyBito();
    this._changed();
    this._roundDone();
    } catch (e) {
      console.error('_gameStep error:', e.message);
      this.running = false;
      this._changed();
    }
  }

  _roundDone() {
    if (!this.running) return;
    this.wait = null;
    this._refill();
    if (checkEnd(this.players, this.deck.length)) {
      const alive = this.players.findIndex(p => !p.out);
      this.over = alive >= 0 ? alive : null;
      this.running = false;
      this._changed();
      return;
    }
    let na = this.nextAttacker;
    if (na < 0 || this.players[na].out) na = nextActiveIdx(this.players, Math.max(na, 0));
    if (na < 0) { checkEnd(this.players, 0); this.running = false; return; }
    this.attackerIdx = na;
    this.firstRound = false;
    this._nextStep();
  }
}
