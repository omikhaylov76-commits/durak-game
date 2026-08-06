import { WebSocket } from 'ws';

const URL = 'wss://durak-game-production-6365.up.railway.app';

function waitMsg(ws, timeout = 5000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), timeout);
    ws.once('message', d => { clearTimeout(t); res(JSON.parse(d.toString())); });
  });
}

async function main() {
  const host = new WebSocket(URL);
  await new Promise(r => host.on('open', r));
  await waitMsg(host); // connected
  
  host.send(JSON.stringify({ t: 'create', count: 2, deck: 36, name: 'H' }));
  const room = await waitMsg(host);
  const code = room.code;
  console.log('ROOM:', code);
  
  const guest = new WebSocket(URL);
  await new Promise(r => guest.on('open', r));
  await waitMsg(guest); // connected
  
  guest.send(JSON.stringify({ t: 'join', code, name: 'G' }));
  const joined = await waitMsg(guest);
  console.log('JOINED seat:', joined.seat);
  await waitMsg(host); // playerJoined
  
  host.send(JSON.stringify({ t: 'start' }));
  
  const gs = await waitMsg(guest);
  console.log('GUEST got:', gs.t);
  
  if (gs.t === 'gameStarted') {
    const st = await waitMsg(guest);
    console.log('STATE players:', st.state.players.length);
    console.log('P0 hand:', st.state.players[0].hand?.length, 'name:', st.state.players[0].name);
    console.log('P1 handSize:', st.state.players[1].handSize, 'name:', st.state.players[1].name);
    console.log('trump:', st.state.trumpSuit);
    console.log('wait:', st.state.wait?.type || 'none');
    console.log('OK');
  } else {
    console.log('UNEXPECTED:', gs.t, gs.text || '');
  }
  
  host.close(); guest.close();
}

main().catch(e => { console.log('FAIL:', e.message); process.exit(1); });
