// synthetic-test.mjs — simulate host+guest game flow
import { WebSocket } from 'ws';

const URL = 'wss://durak-game-production-6365.up.railway.app';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function recv(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(to);
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function main() {
  // ---- Host connects ----
  const host = new WebSocket(URL);
  await new Promise(r => host.on('open', r));
  let msg = await recv(host);
  console.log('Host connected:', msg.t, msg.id);

  host.send(JSON.stringify({ t: 'create', count: 3, deck: 36, name: 'Хост' }));
  msg = await recv(host);
  const code = msg.code;
  console.log('Room:', code);

  // ---- Guest connects ----
  const guest = new WebSocket(URL);
  await new Promise(r => guest.on('open', r));
  msg = await recv(guest);
  console.log('Guest connected:', msg.t);

  guest.send(JSON.stringify({ t: 'join', code, name: 'Гость' }));
  msg = await recv(guest);
  console.log('Guest joined, seat:', msg.seat);
  const guestSeat = msg.seat;

  // Host gets guestJoined
  msg = await recv(host);
  console.log('Host sees guestJoined, seat:', msg.seat);

  // ---- Simulate Qwen startGame with 3 players (1 host + 1 guest + 1 bot) ----
  // Build deck, deal cards, find first attacker
  const suits = ['♠','♥','♦','♣'];
  const ranks36 = [6,7,8,9,10,11,12,13,14];
  const deck = [];
  for (const s of suits) for (const r of ranks36) deck.push({ id: s+r, suit: s, rank: r });
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const trumpCard = deck[0];
  const trumpSuit = trumpCard.suit;

  const players = [
    { name: 'Хост', hand: [], out: false, seat: 0, bot: false },
    { name: 'Гость', hand: [], out: false, seat: 1, bot: false },
    { name: 'Бот 3', hand: [], out: false, seat: 2, bot: true },
  ];

  // Deal 6 cards each
  for (let k = 0; k < 6; k++)
    for (const p of players) p.hand.push(deck.pop());

  // Find first attacker (lowest trump)
  let first = 0, best = 99;
  players.forEach((p, ix) => {
    p.hand.forEach(c => { if (c.suit === trumpSuit && c.rank < best) { best = c.rank; first = ix; } });
  });

  console.log(`\nGame state: ${players.length}p, trump=${trumpSuit}, first=${players[first].name}`);
  console.log(`Host hand: ${players[0].hand.map(c=>c.id).join(' ')}`);
  console.log(`Guest hand: ${players[1].hand.map(c=>c.id).join(' ')}`);
  console.log(`Deck: ${deck.length} cards\n`);

  // ---- Simulate projectFor(guestSeat) ----
  function projectFor(s) {
    const n = players.length;
    const rot = (i) => (i - s + n) % n;
    const pout = [];
    for (let i = 0; i < n; i++) {
      const src = players[(s + i) % n];
      const q = { name: src.name, out: src.out, handSize: src.hand.length };
      q.hand = ((s + i) % n === s) ? src.hand.map(c => ({ id: c.id, suit: c.suit, rank: c.rank })) : new Array(src.hand.length);
      pout.push(q);
    }
    const me = players[s];
    const cards = me.hand.slice();
    const wait = null;
    return {
      players: pout, table: [], discard: [], deckLen: deck.length,
      trumpSuit, trumpCard: null, trumpInDeck: false,
      attackerIdx: rot(first), defenderIdx: -1, turnIdx: rot(first),
      wait, cards,
      opts: { count: 3, deck: 36, throwAll: true, first5: false },
      firstRound: true,
    };
  }

  const stateForGuest = projectFor(guestSeat);
  console.log('projectFor(' + guestSeat + ') output:');
  console.log('  players:', stateForGuest.players.length);
  console.log('  player[0] (guest):', stateForGuest.players[0].name, 'hand:', stateForGuest.players[0].hand.length, 'cards');
  console.log('  player[0] cards:', stateForGuest.players[0].hand.map(c => c.id).join(' '));
  console.log('  player[1] (host):', stateForGuest.players[1].name, 'handSize:', stateForGuest.players[1].handSize, 'hand:', stateForGuest.players[1].hand.length, 'slots');
  console.log('  allCards (visible):', stateForGuest.cards.length, stateForGuest.cards.map(c => c.id).join(' '));
  console.log('  trumpSuit:', stateForGuest.trumpSuit);
  console.log('  attackerIdx:', stateForGuest.attackerIdx, '(rotated)');
  console.log('');

  // ---- Send state to guest via relay ----
  host.send(JSON.stringify({ t: 'state', seat: guestSeat, state: stateForGuest }));
  msg = await recv(guest);
  console.log('Guest received:', msg.t, 'seat:', msg.seat);

  const st = msg.state;
  console.log('Guest state check:');
  console.log('  players:', st.players.length);
  console.log('  player[0] hand:', st.players[0].hand.length, 'cards:', st.players[0].hand.map(c => c.id).join(' '));
  console.log('  trump:', st.trumpSuit);
  console.log('  cards array:', st.cards.length);

  // ---- Now test: can guest send an action? ----
  const firstCard = st.players[0].hand[0];
  console.log(`\nGuest sends play action: ${firstCard.id}`);
  guest.send(JSON.stringify({ t: 'act', kind: 'play', cardId: firstCard.id }));
  msg = await recv(host);
  console.log('Host received:', msg.t, 'kind:', msg.kind, 'cardId:', msg.cardId, 'seat:', msg.seat);

  // Check if guest seat matches
  const isSeatCorrect = msg.seat === guestSeat;
  console.log('\n=== SUMMARY ===');
  console.log('State relay:', st.players[0].hand.length > 0 ? '✅' : '❌');
  console.log('Seat match:', msg.seat === guestSeat ? '✅' : '❌ (got ' + msg.seat + ', expected ' + guestSeat + ')');
  console.log('Action relay:', msg.t === 'act' ? '✅' : '❌');
  console.log('Cards visible:', st.cards.length + ' of ' + players[1].hand.length + ' expected');

  host.close();
  guest.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
