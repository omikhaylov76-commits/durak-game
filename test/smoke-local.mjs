import { WebSocket } from 'ws';

const URL = 'ws://localhost:3740';

function waitMsg(ws, timeout = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), timeout);
    ws.once('message', d => { clearTimeout(t); res(JSON.parse(d.toString())); });
  });
}

async function main() {
  const host = new WebSocket(URL);
  await new Promise(r => host.on('open', r));
  await waitMsg(host);
  
  host.send(JSON.stringify({ t: 'create', count: 2, deck: 36, name: 'H' }));
  const room = await waitMsg(host);
  const code = room.code;
  console.log('ROOM:', code);
  
  const guest = new WebSocket(URL);
  await new Promise(r => guest.on('open', r));
  await waitMsg(guest);
  
  guest.send(JSON.stringify({ t: 'join', code, name: 'G' }));
  const joined = await waitMsg(guest);
  console.log('JOINED seat:', joined.seat);
  await waitMsg(host);
  
  host.send(JSON.stringify({ t: 'start' }));
  
  const gs = await waitMsg(guest);
  console.log('GUEST got:', gs.t);
  
  let passed = 0, failed = 0;
  
  if (gs.t === 'gameStarted') {
    passed++;
    const st = await waitMsg(guest);
    const p0 = st.state.players[0];
    const p1 = st.state.players[1];
    
    console.log('P0:', p0.name, 'hand:', p0.hand?.length, 'seat:', p0.seat);
    console.log('P1:', p1.name, 'handSize:', p1.handSize, 'seat:', p1.seat);
    
    // P0 must be the guest with their hand
    if (p0.name === 'G' && p0.hand?.length === 6 && p0.seat === 0) {
      console.log('ROTATION: OK');
      passed++;
    } else {
      console.log('ROTATION: FAILED — P0 should be guest with hand, got:', p0.name, p0.hand?.length);
      failed++;
    }
    
    if (p1.name === 'H' && p1.handSize === 6 && p1.seat === 1) {
      console.log('OPPONENT: OK');
      passed++;
    } else {
      console.log('OPPONENT: FAILED');
      failed++;
    }
  } else {
    failed++;
    console.log('UNEXPECTED:', gs.t);
  }
  
  console.log(`\n${passed} passed, ${failed} failed`);
  host.close(); guest.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
