import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/server/game-room.js';

describe('GameRoom — single bot game', () => {
  it('completes a 2-player 36-card game', async () => {
    const room = new GameRoom('TEST', { count: 2, deck: 36, throwAll: true, first5: false }, 'host1');
    room.players = [
      { id: 'host1', name: 'Хост', hand: [], out: false, bot: false, seat: 0 },
    ];
    room.start(room.players);

    // Intercept _askPlayer for the human to auto-play
    const origAsk = room._askPlayer.bind(room);
    room._askPlayer = async function (idx, type) {
      if (idx === 0 && !this.players[0].bot) {
        // Auto-play: pick first valid card
        if (type === 'defend') {
          const pend = this._pendingAttack();
          const c = this.players[0].hand.find(c => pend && c.suit === pend.suit ? c.rank > pend.rank : c.suit === this.trumpSuit);
          return c ? { card: c } : { take: true };
        }
        if (type === 'attack') {
          return { card: this.players[0].hand[0] };
        }
        if (type === 'throw') {
          const ranks = new Set(this.table.map(e => e.attack.rank).filter(Boolean));
          const c = this.players[0].hand.find(c => ranks.has(c.rank));
          return c ? { card: c } : null; // pass
        }
      }
      return origAsk(idx, type);
    };

    // Wait for game to end
    const maxWait = 15000;
    const start = Date.now();
    while (room.running && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 50));
    }

    assert.equal(room.running, false, 'game should finish');
    assert.ok(room.over !== undefined, 'over should be set');
    console.log(`  Game over: fool=${room.over}, deck=${room.deck.length}, discard=${room.discard.length}`);
  });

  it('completes a 3-player 36-card game', async () => {
    const room = new GameRoom('TEST3', { count: 3, deck: 36, throwAll: true, first5: false }, 'host1');
    room.players = [
      { id: 'host1', name: 'Хост', hand: [], out: false, bot: false, seat: 0 },
    ];
    room.start(room.players);

    const origAsk = room._askPlayer.bind(room);
    room._askPlayer = async function (idx, type) {
      if (idx === 0 && !this.players[0].bot) {
        if (type === 'defend') {
          const pend = this._pendingAttack();
          const c = this.players[0].hand.find(c => pend && c.suit === pend.suit ? c.rank > pend.rank : c.suit === this.trumpSuit);
          return c ? { card: c } : { take: true };
        }
        if (type === 'attack') return { card: this.players[0].hand[0] };
        if (type === 'throw') {
          const ranks = new Set(this.table.map(e => e.attack.rank));
          const c = this.players[0].hand.find(c => ranks.has(c.rank));
          return c ? { card: c } : null;
        }
      }
      return origAsk(idx, type);
    };

    const start = Date.now();
    while (room.running && Date.now() - start < 30000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(room.running, false);
    console.log(`  3p game over: fool=${room.over}`);
  });

  it('completes a 4-player 52-card game', async () => {
    const room = new GameRoom('TEST4', { count: 4, deck: 52, throwAll: true, first5: false }, 'host1');
    room.players = [
      { id: 'host1', name: 'Хост', hand: [], out: false, bot: false, seat: 0 },
    ];
    room.start(room.players);

    const origAsk = room._askPlayer.bind(room);
    room._askPlayer = async function (idx, type) {
      if (idx === 0 && !this.players[0].bot) {
        if (type === 'defend') {
          const pend = this._pendingAttack();
          const c = this.players[0].hand.find(c => pend && c.suit === pend.suit ? c.rank > pend.rank : c.suit === this.trumpSuit);
          return c ? { card: c } : { take: true };
        }
        if (type === 'attack') return { card: this.players[0].hand[0] };
        if (type === 'throw') {
          const ranks = new Set(this.table.map(e => e.attack.rank));
          const c = this.players[0].hand.find(c => ranks.has(c.rank));
          return c ? { card: c } : null;
        }
      }
      return origAsk(idx, type);
    };

    const start = Date.now();
    while (room.running && Date.now() - start < 60000) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(room.running, false);
    console.log(`  4p 52c game over: fool=${room.over}`);
  });
});
