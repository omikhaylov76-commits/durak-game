import { WebSocket } from 'ws';

const HOST = 'ws://127.0.0.1:3737';

async function runGame(count, deck) {
  console.log(`--- ${count}p/${deck}c ---`);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HOST);
    let states = 0;
    const startTime = Date.now();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`TIMEOUT after ${states} states`));
    }, 120000);

    ws.on('open', () => {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'state') {
          states++;
          if (m.state.over !== undefined) {
            clearTimeout(timer);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const fool = m.state.over;
            const foolName = fool === 0 ? 'Тестер' : (fool === null ? 'ничья' : m.state.players[fool]?.name || `игрок ${fool}`);
            console.log(`  ✓ ${elapsed}s, ${states} states, дурак: ${foolName}`);
            ws.close();
            resolve({ success: true, elapsed: parseFloat(elapsed), states, fool });
            return;
          }
          const w = m.state.wait;
          if (w?.type === 'attack' && w.valid?.length) {
            ws.send(JSON.stringify({ t: 'act', action: { kind: 'play', cardId: w.valid[0] } }));
          } else if (w?.type === 'throw' && w.valid?.length) {
            ws.send(JSON.stringify({ t: 'act', action: { kind: 'play', cardId: w.valid[0] } }));
          } else if (w?.type === 'throw' && (!w.valid || !w.valid.length)) {
            ws.send(JSON.stringify({ t: 'act', action: { kind: 'pass' } }));
          } else if (w?.type === 'defend') {
            ws.send(JSON.stringify({ t: 'act', action: { kind: 'take' } }));
          }
        } else if (m.t === 'room') {
          ws.send(JSON.stringify({ t: 'start' }));
        } else if (m.t === 'connected') {
          ws.send(JSON.stringify({ t: 'create', name: 'Тестер', count, deck, throwAll: true }));
        }
      });
    });
  });
}

const results = [];
for (const count of [2, 3, 4]) {
  for (const deck of [36, 52]) {
    try {
      const r = await runGame(count, deck);
      results.push({ count, deck, ...r });
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      results.push({ count, deck, success: false });
    }
  }
}

console.log('\n=== RESULTS ===');
const failures = results.filter(r => !r.success);
for (const r of results) {
  console.log(`${r.count}p ${r.deck}c: ${r.success ? `✓ ${r.elapsed}s` : '✗ FAIL'}`);
}
process.exit(failures.length ? 1 : 0);
