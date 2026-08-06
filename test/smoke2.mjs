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
  
  const guest = new WebSocket(URL);
  await new Promise(r => guest.on('open', r));
  await waitMsg(guest);
  guest.send(JSON.stringify({ t: 'join', code: room.code, name: 'G' }));
  await waitMsg(guest);
  await waitMsg(host);
  
  // Collect ALL messages guest receives after start
  const msgs = [];
  guest.on('message', d => msgs.push(JSON.parse(d.toString())));
  
  host.send(JSON.stringify({ t: 'start' }));
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('Guest received', msgs.length, 'messages:');
  for (const m of msgs) {
    if (m.t === 'state') {
      const p0 = m.state.players[0];
      console.log(`  state: P0=${p0.name} hand=${p0.hand?.length} seat=${p0.seat} wait=${m.state.wait?.type||'none'}`);
    } else {
      console.log(`  ${m.t}:`, JSON.stringify(m).slice(0, 100));
    }
  }
  
  host.close(); guest.close();
}

main().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
