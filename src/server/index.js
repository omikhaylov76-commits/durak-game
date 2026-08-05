import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { GameRoom } from './game-room.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3737', 10);
const HOST = process.env.HOST || '0.0.0.0';

const rooms = new Map();      // code -> GameRoom
const clientInfo = new Map(); // ws -> { id, name, roomCode, seat }

let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except) {
  for (const c of room.clients) {
    if (c !== except) send(c, msg);
  }
}

function broadcastState(room) {
  for (const [ws, info] of clientInfo) {
    if (info.roomCode === room.code && info.seat >= 0) {
      const state = room.getState(info.seat);
      send(ws, { t: 'state', state });
    }
  }
}

function replaceWithBot(room, seat) {
  const p = room.players[seat];
  if (!p || p.bot) return;
  p.bot = true;
  p.id = `bot-${seat}`;
  p.name = `Бот ${seat + 1}`;
  // If it was their turn, auto-resolve
  if (room.wait && room.wait.idx === seat) {
    room._autoResolve();
  }
}

// ---- HTTP server ----
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
  const clientId = `c${nextId++}`;
  clientInfo.set(ws, { id: clientId, name: 'Игрок', roomCode: null, seat: -1 });

  send(ws, { t: 'connected', id: clientId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const info = clientInfo.get(ws);
    if (!info) return;

    switch (msg.t) {

      case 'create': {
        const code = generateCode(5);
        const opts = {
          count: Math.max(2, Math.min(4, msg.count || 3)),
          deck: msg.deck === 52 ? 52 : 36,
          throwAll: msg.throwAll !== false,
          first5: !!msg.first5,
        };
        const room = new GameRoom(code, opts, clientId);
        room.clients = new Set([ws]);
        room.players.push({ id: clientId, name: (msg.name || 'Хост').slice(0, 12), hand: [], out: false, bot: false, seat: 0 });
        rooms.set(code, room);
        info.roomCode = code;
        info.seat = 0;
        info.name = room.players[0].name;
        send(ws, { t: 'room', code, seat: 0, host: true });
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { t: 'error', text: 'Комната не найдена' }); break; }
        if (room.running) { send(ws, { t: 'error', text: 'Игра уже идёт' }); break; }
        // Find free seat
        let seat = -1;
        for (let i = 1; i < room.opts.count; i++) {
          if (!room.players[i] || room.players[i].bot) { seat = i; break; }
        }
        if (seat < 0) { send(ws, { t: 'error', text: 'Нет свободных мест' }); break; }
        
        const name = (msg.name || 'Гость').slice(0, 12);
        info.roomCode = code;
        info.seat = seat;
        info.name = name;
        room.clients.add(ws);
        
        if (!room.players[seat]) {
          room.players[seat] = { id: clientId, name, hand: [], out: false, bot: false, seat };
        } else {
          // Replace bot placeholder
          room.players[seat].id = clientId;
          room.players[seat].name = name;
          room.players[seat].bot = false;
        }
        
        send(ws, { t: 'joined', code, seat });
        broadcast(room, { t: 'playerJoined', seat, name }, ws);
        break;
      }

      case 'start': {
        const room = rooms.get(info.roomCode);
        if (!room || info.seat !== 0) break;
        if (room.running) break;
        try {
          // Fill remaining seats with bots
          for (let i = room.players.length; i < room.opts.count; i++) {
            room.players.push({
              id: `bot-${i}`,
              name: names[i] || `Бот ${i + 1}`,
              hand: [],
              out: false,
              bot: true,
              seat: i,
            });
          }
          room.start(room.players);
          room._onChange = () => broadcastState(room);
          broadcast(room, { t: 'gameStarted' });
          broadcastState(room);
        } catch (e) {
          console.error('start error:', e.message);
          send(ws, { t: 'error', text: 'Ошибка старта: ' + e.message });
        }
        break;
      }

      case 'act': {
        const room = rooms.get(info.roomCode);
        if (!room || !room.running) break;
        room.handleAction(clientId, msg.action || msg);
        break;
      }

      case 'emoji': {
        const room = rooms.get(info.roomCode);
        if (!room) break;
        const emoji = (typeof msg.e === 'string' && msg.e.length <= 2) ? msg.e : '😊';
        broadcast(room, { t: 'emoji', e: emoji, seat: info.seat, name: info.name }, ws);
        break;
      }

      case 'leave': {
        if (info.roomCode) {
          const room = rooms.get(info.roomCode);
          if (room) {
            room.clients.delete(ws);
            if (room.running) {
              replaceWithBot(room, info.seat);
              broadcast(room, { t: 'playerLeft', seat: info.seat });
              broadcastState(room);
            } else {
              // Pre-game: remove player
              if (room.players[info.seat]) {
                room.players[info.seat] = null;
              }
              broadcast(room, { t: 'playerLeft', seat: info.seat });
            }
            if (room.clients.size === 0) rooms.delete(info.roomCode);
          }
        }
        info.roomCode = null;
        info.seat = -1;
        break;
      }

    }
  });

  ws.on('close', () => {
    // Simulate leave
    const info = clientInfo.get(ws);
    if (info && info.roomCode) {
      const room = rooms.get(info.roomCode);
      if (room) {
        room.clients.delete(ws);
        if (room.running) {
          replaceWithBot(room, info.seat);
          broadcast(room, { t: 'playerLeft', seat: info.seat });
          broadcastState(room);
        } else {
          if (room.players[info.seat]) room.players[info.seat] = null;
          broadcast(room, { t: 'playerLeft', seat: info.seat });
        }
        if (room.clients.size === 0) rooms.delete(info.roomCode);
      }
    }
    clientInfo.delete(ws);
  });

  ws.on('error', () => {});
});

// ---- Helpers ----
const names = ['Китти', 'Мелоди', 'Кероппи'];

function generateCode(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let code = '';
  for (let i = 0; i < len; i++) code += chars[bytes[i] % chars.length];
  return code;
}

// Clean up empty rooms
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients && room.clients.size === 0) rooms.delete(code);
  }
}, 5 * 60 * 1000);

httpServer.listen(PORT, HOST, () => {
  console.log(`Дурак сервер запущен: http://${HOST}:${PORT}`);
});
