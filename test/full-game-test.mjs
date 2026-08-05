// full-game-test.mjs — test complete durak game mechanics via relay
import { WebSocket } from 'ws';

const URL = 'wss://durak-game-production-6365.up.railway.app';
const SUITS = ['♠','♥','♦','♣'];
const R36 = [6,7,8,9,10,11,12,13,14];
const RLBL = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'В',12:'Д',13:'К',14:'Т'};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function recv(ws, t=3000) { return new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),t);ws.once('message',d=>{clearTimeout(to);res(JSON.parse(d.toString()));});});}

// ---- Game Engine (extracted from Qwen, no DOM) ----
function buildDeck36() { const d=[]; for(const s of SUITS) for(const r of R36) d.push({id:s+r,suit:s,rank:r}); return d; }
function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function canBeat(d,a,trump){return d.suit===a.suit?d.rank>a.rank:d.suit===trump;}
function findLowestTrump(players,trump){let first=0,best=99;players.forEach((p,i)=>p.hand.forEach(c=>{if(c.suit===trump&&c.rank<best){best=c.rank;first=i;}}));return first;}
function sortCards(h,trump){return h.slice().sort((a,b)=>{const ta=a.suit===trump?1:0,tb=b.suit===trump?1:0;if(ta!==tb)return ta-tb;if(a.suit!==b.suit)return SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit);return a.rank-b.rank;});}

// ---- Test ----
async function main() {
  const host = new WebSocket(URL); await new Promise(r=>host.on('open',r)); await recv(host);
  const guest = new WebSocket(URL); await new Promise(r=>guest.on('open',r)); await recv(guest);

  host.send(JSON.stringify({t:'create',count:2,deck:36,name:'H'}));
  const room = await recv(host);
  console.log('Room:', room.code);

  guest.send(JSON.stringify({t:'join',code:room.code,name:'G'}));
  const joined = await recv(guest);
  console.log('Guest seat:', joined.seat);
  await recv(host); // guestJoined

  // ---- Start game ----
  const deck = shuffle(buildDeck36());
  const trumpCard = deck[0], trumpSuit = trumpCard.suit;
  const players = [
    {name:'H',hand:[],out:false,bot:false,seat:0},
    {name:'G',hand:[],out:false,bot:false,seat:1}
  ];
  for(let k=0;k<6;k++) for(const p of players) p.hand.push(deck.pop());
  for(const p of players) p.hand = sortCards(p.hand, trumpSuit);
  const first = findLowestTrump(players, trumpSuit);
  
  console.log(`\nGame: trump=${trumpSuit}(${RLBL[trumpCard.rank]}) first=${players[first].name} deck=${deck.length}`);
  console.log(`Host hand: ${players[0].hand.map(c=>c.id).join(' ')}`);
  console.log(`Guest hand: ${players[1].hand.map(c=>c.id).join(' ')}`);

  let attackerIdx = first, defenderIdx = -1, table = [];
  let gameRunning = true, roundAttacker = first, turnIdx = first;

  function projectFor(s) {
    const n = players.length;
    const rot = i => (i - s + n) % n;
    const pout = [];
    for(let i=0;i<n;i++){
      const src = players[(s+i)%n];
      const q = {name:src.name, out:src.out, handSize:src.hand.length};
      q.hand = ((s+i)%n===s) ? src.hand.map(c=>({id:c.id,suit:c.suit,rank:c.rank})) : new Array(src.hand.length);
      pout.push(q);
    }
    const me = players[s];
    const cards = me.hand.slice();
    for(const e of table){cards.push(e.attack);if(e.defense)cards.push(e.defense);}
    for(const c of deck.slice(-Math.min(deck.length,8))) cards.push(c); // some deck visibility
    return {players:pout,table,discard:[],deckLen:deck.length,trumpSuit,
      trumpCard:trumpCard,trumpInDeck:deck.length>0,attackerIdx:rot(attackerIdx),
      defenderIdx:defenderIdx<0?-1:rot(defenderIdx),turnIdx:rot(turnIdx),wait:null,
      cards,opts:{count:2,deck:36,throwAll:true},firstRound:true};
  }

  function sendState() {
    const stateForGuest = projectFor(1);
    host.send(JSON.stringify({t:'state',seat:1,state:stateForGuest}));
  }

  // Send initial state
  sendState();
  let msg = await recv(guest);
  let st = msg.state;
  console.log(`\nGuest state: players=${st.players.length} hand=${st.players[0].hand.length} trump=${st.trumpSuit}`);
  console.log(`Guest sees cards: ${st.players[0].hand.map(c=>c.id).join(' ')}`);
  
  if(st.players[0].hand.length !== 6) throw new Error('Guest should have 6 cards!');

  // ---- Simulate a round ----
  defenderIdx = (attackerIdx + 1) % players.length;
  turnIdx = attackerIdx;
  table = [];
  console.log(`\n--- Round: ${players[attackerIdx].name} attacks ${players[defenderIdx].name} ---`);

  // Attack: host plays first card
  const attackCard = players[attackerIdx].hand[0]; // lowest non-trump
  players[attackerIdx].hand = players[attackerIdx].hand.filter(c=>c.id!==attackCard.id);
  table.push({attack:attackCard,defense:null});
  sendState();
  msg = await recv(guest);
  console.log(`Attack: ${attackCard.id} → table has ${msg.state.table.length} cards`);
  if(msg.state.table.length !== 1) throw new Error('Table should have 1 card!');

  // Defend: guest (seat 1) defends
  const defendCard = players[defenderIdx].hand.find(c=>canBeat(c,attackCard,trumpSuit));
  if(defendCard){
    players[defenderIdx].hand = players[defenderIdx].hand.filter(c=>c.id!==defendCard.id);
    table[0].defense = defendCard;
    sendState();
    msg = await recv(guest);
    console.log(`Defend: ${defendCard.id} → table defended: ${msg.state.table[0].defense!==null}`);
    if(!msg.state.table[0].defense) throw new Error('Defense not applied!');
  } else {
    // Take cards
    const taken = [];
    for(const e of table){taken.push(e.attack);if(e.defense)taken.push(e.defense);}
    players[defenderIdx].hand.push(...taken);
    players[defenderIdx].hand = sortCards(players[defenderIdx].hand, trumpSuit);
    table = [];
    sendState();
    msg = await recv(guest);
    console.log(`Take: ${taken.length} cards taken, table has ${msg.state.table.length} cards`);
    console.log(`Guest hand now: ${msg.state.players[0].hand.length} cards`);
    if(msg.state.table.length !== 0) throw new Error('Table should be empty after take!');
  }

  // ---- Test action relay (guest plays a card) ----
  const guestCard = players[1].hand[0];
  console.log(`\n--- Action test: guest plays ${guestCard.id} ---`);
  guest.send(JSON.stringify({t:'act',kind:'play',cardId:guestCard.id}));
  msg = await recv(host);
  console.log(`Host received action: t=${msg.t} kind=${msg.kind} cardId=${msg.cardId} seat=${msg.seat}`);
  if(msg.t!=='act'||msg.kind!=='play'||msg.cardId!==guestCard.id) throw new Error('Action relay failed!');

  console.log('\n✅ ALL TESTS PASSED');
  host.close(); guest.close();
}

main().catch(e=>{console.error('❌',e.message);process.exit(1);});
