import { WebSocket } from 'ws';

async function runGame(label, count, deck) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:3737');
    let states = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`${label}: TIMEOUT after ${states} states`));
    }, 120000);

    ws.on('open', () => {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'state') {
          states++;
          if (m.state.over !== undefined) {
            clearTimeout(timer);
            console.log(`${label}: DONE ${states} states, fool=${m.state.over}`);
            ws.close();
            resolve();
            return;
          }
          const w = m.state.wait;
          if (w?.type === 'attack' && w.valid?.length) ws.send(JSON.stringify({t:'act', action:{kind:'play', cardId: w.valid[0]}}));
          else if (w?.type === 'throw' && w.valid?.length) ws.send(JSON.stringify({t:'act', action:{kind:'play', cardId: w.valid[0]}}));
          else if (w?.type === 'throw' && (!w.valid || !w.valid.length)) ws.send(JSON.stringify({t:'act', action:{kind:'pass'}}));
          else if (w?.type === 'defend') ws.send(JSON.stringify({t:'act', action:{kind:'take'}}));
        } else if (m.t === 'room') {
          ws.send(JSON.stringify({t:'start'}));
        } else if (m.t === 'connected') {
          ws.send(JSON.stringify({t:'create', name: 'Test', count, deck, throwAll: true}));
        }
      });
    });
  });
}

// Run 52-card games FIRST to see if they work standalone
console.log('=== 52c games first ===');
await runGame('2p/52c', 2, 52);
await runGame('3p/52c', 3, 52);
await runGame('4p/52c', 4, 52);

// Then run 36-card games
console.log('\n=== 36c games ===');
await runGame('2p/36c', 2, 36);
await runGame('3p/36c', 3, 36);
await runGame('4p/36c', 4, 36);

console.log('\nALL PASSED');
process.exit(0);
