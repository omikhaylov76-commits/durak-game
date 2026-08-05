import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameRoom } from './game-room.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3737', 10);
const HOST = process.env.HOST || '0.0.0.0';

const rooms = new Map();      // code -> GameRoom
const clients = new Map();    // ws -> { id, name, roomCode, seat }

let nextClientId = 1;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastRoom(code, msg) {
  for (const [ws, info] of clients) {
    if (info.roomCode === code) send(ws, msg);
  }
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const [ws, info] of clients) {
    if (info.roomCode === code && info.seat >= 0) {
      send(ws, { t: 'state', state: room.getState(info.seat) });
    }
  }
}

function pushState(code) {
  // Use setImmediate to batch state updates
  if (!pushState._pending) pushState._pending = new Set();
  pushState._pending.add(code);
  if (!pushState._scheduled) {
    pushState._scheduled = setImmediate(() => {
      const pending = pushState._pending;
      pushState._pending = new Set();
      pushState._scheduled = null;
      for (const c of pending) broadcastState(c);
    });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

const httpServer = createServer((req, res) => {
  let path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  if (path.includes('..')) { res.writeHead(403); res.end(); return; }
  const filePath = join(__dirname, '..', '..', 'client', path);
  try {
    const data = readFileSync(filePath);
    const ext = '.' + path.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const clientId = `c${nextClientId++}`;
  clients.set(ws, { id: clientId, name: 'Игрок', roomCode: null, seat: -1 });

  send(ws, { t: 'connected', id: clientId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const info = clients.get(ws);
    if (!info) return;

    switch (msg.t) {
      case 'create': {
        const code = generateCode();
        const opts = {
          count: Math.max(2, Math.min(4, msg.count || 3)),
          deck: msg.deck === 52 ? 52 : 36,
          throwAll: msg.throwAll !== false,
          first5: !!msg.first5,
        };
        const room = new GameRoom(code, opts, clientId);
        rooms.set(code, room);
        info.roomCode = code;
        info.seat = 0;
        info.name = (msg.name || 'Хост').slice(0, 12);
        // Add host as player 0
        room.players.push({ id: clientId, name: info.name, hand: [], out: false, bot: false, seat: 0 });
        send(ws, { t: 'room', code, seat: 0 });
        pushState(code);
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { t: 'error', text: 'Комната не найдена' }); break; }
        if (room.running) { send(ws, { t: 'error', text: 'Игра уже идёт' }); break; }
        // Find a free seat
        let seat = -1;
        for (let i = 1; i < room.opts.count; i++) {
          if (!room.players[i] || room.players[i].bot) { seat = i; break; }
        }
        if (seat < 0) { send(ws, { t: 'error', text: 'Нет свободных мест' }); break; }
        info.roomCode = code;
        info.seat = seat;
        info.name = (msg.name || 'Гость').slice(0, 12);
        if (!room.players[seat]) {
          room.players[seat] = { id: clientId, name: info.name, hand: [], out: false, bot: false, seat };
        } else {
          room.players[seat].id = clientId;
          room.players[seat].name = info.name;
          room.players[seat].bot = false;
        }
        send(ws, { t: 'joined', code, seat });
        pushState(code);
        break;
      }

      case 'start': {
        const room = rooms.get(info.roomCode);
        if (!room || info.seat !== 0) break;
        try {
          for (let i = room.players.length; i < room.opts.count; i++) {
            room.players.push({
              id: `bot-${i}`,
              name: `Бот ${i + 1}`,
              hand: [],
              out: false,
              bot: true,
              seat: i,
            });
          }
          room.start(room.players);
          room._onChange = () => pushState(info.roomCode);
          pushState(info.roomCode);
        } catch (e) {
          console.error('start error:', e.message);
          send(ws, { t: 'error', text: 'Ошибка старта: ' + e.message });
        }
        break;
      }

      case 'act': {
        const room = rooms.get(info.roomCode);
        if (!room) break;
        room.handleAction(clientId, msg.action || msg);
        break;
      }

      case 'emoji': {
        const emoji = (typeof msg.e === 'string' && msg.e.length <= 2) ? msg.e : '😊';
        broadcastRoom(info.roomCode, { t: 'emoji', e: emoji, seat: info.seat, name: info.name });
        break;
      }

      case 'leave': {
        if (info.roomCode) leaveRoom(ws, info);
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info && info.roomCode) leaveRoom(ws, info);
    clients.delete(ws);
  });

  ws.on('error', () => {});
});

function leaveRoom(ws, info) {
  const room = rooms.get(info.roomCode);
  if (room && room.running) {
    room.playerLeft(info.id);
    pushState(info.roomCode);
  }
  info.roomCode = null;
  info.seat = -1;
}

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
  return code;
}

httpServer.listen(PORT, HOST, () => {
  console.log(`Дурак сервер запущен: http://${HOST}:${PORT}`);
});

// Clean up empty rooms periodically
setInterval(() => {
  for (const [code, room] of rooms) {
    const active = [...clients.values()].some(info => info.roomCode === code);
    if (!active) rooms.delete(code);
  }
}, 5 * 60 * 1000);
