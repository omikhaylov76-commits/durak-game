import { WebSocket } from 'ws';

const HOST = 'ws://127.0.0.1:3737';
const TIMEOUT_MS = 120000; // 2 minutes per game

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HOST);
    const timer = setTimeout(() => { ws.close(); reject(new Error('connect timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function autoplay(count, deck) {
  console.log(`\n--- autoplay: ${count} players, ${deck} cards ---`);
  const startTime = Date.now();
  const ws = await connect();

  let stateCount = 0;
  let overSeen = null;
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'state') {
      stateCount++;
      if (msg.state.over !== undefined) {
        overSeen = msg.state;
        resolveDone();
      }
      // Auto-play: if it's our turn, pick the first valid card
      const wait = msg.state.wait;
      if (wait && wait.valid && wait.valid.length > 0) {
        const cardId = wait.valid[0];
        ws.send(JSON.stringify({ t: 'act', action: { kind: 'play', cardId } }));
      } else if (wait && wait.type === 'defend') {
        // For defend, just take (we can't see valid cards)
        ws.send(JSON.stringify({ t: 'act', action: { kind: 'take' } }));
      } else if (wait && (wait.type === 'attack' || wait.type === 'throw')) {
        // No valid cards — pass
        ws.send(JSON.stringify({ t: 'act', action: { kind: 'pass' } }));
      }
    } else if (msg.t === 'room') {
      ws.send(JSON.stringify({ t: 'start' }));
    } else if (msg.t === 'connected') {
      ws.send(JSON.stringify({
        t: 'create',
        name: 'Тестер',
        count,
        deck,
        throwAll: true,
        first5: false,
      }));
    }
  });

  // Timeout
  const timer = setTimeout(() => {
    if (!overSeen) {
      console.log(`  TIMEOUT after ${((Date.now() - startTime) / 1000).toFixed(1)}s, ${stateCount} states`);
      resolveDone();
    }
  }, TIMEOUT_MS);

  await done;
  clearTimeout(timer);
  ws.close();

  const elapsed = (Date.now() - startTime) / 1000;
  if (overSeen) {
    const fool = overSeen.over;
    const foolName = fool === 0 ? 'Тестер' : (fool === null ? 'ничья' : overSeen.players[fool]?.name || `игрок ${fool}`);
    console.log(`  ✓ finished in ${elapsed.toFixed(1)}s, ${stateCount} states, дурак: ${foolName}`);
    return { success: true, elapsed, stateCount, fool };
  } else {
    console.log(`  ✗ timeout after ${elapsed.toFixed(1)}s, ${stateCount} states`);
    return { success: false, elapsed, stateCount };
  }
}

// Run all combinations
const results = [];
for (const count of [2, 3, 4]) {
  for (const deck of [36, 52]) {
    const r = await autoplay(count, deck);
    results.push({ count, deck, ...r });
  }
}

console.log('\n=== RESULTS ===');
for (const r of results) {
  console.log(`${r.count}p ${r.deck}c: ${r.success ? `✓ ${r.elapsed.toFixed(1)}s` : '✗ TIMEOUT'}`);
}

const failures = results.filter(r => !r.success);
if (failures.length) {
  console.error(`\n${failures.length} failure(s) — check game loop`);
  process.exit(1);
}
console.log('\nAll games completed successfully!');
