import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3737', 10);
const HOST = process.env.HOST || '0.0.0.0';

const rooms = new Map();      // code -> { code, clients: Set<ws> }
const clients = new Map();    // ws -> { id, name, roomCode, seat }

let nextClientId = 1;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
        info.roomCode = code;
        info.seat = 0;
        info.name = (msg.name || 'Хост').slice(0, 12);
        // Relay-mode room: no server-side GameRoom, just message forwarding
        rooms.set(code, { code, opts: { count: msg.count||3, deck: msg.deck||36 }, clients: new Set([ws]) });
        send(ws, { t: 'room', code, seat: 0 });
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { t: 'error', text: 'Комната не найдена' }); break; }
        info.roomCode = code;
        info.seat = room.clients.size;
        info.name = (msg.name || 'Гость').slice(0, 12);
        room.clients.add(ws);
        send(ws, { t: 'joined', code, seat: info.seat });
        // Notify host
        for (const c of room.clients) {
          if (c !== ws) send(c, { t: 'guestJoined', seat: info.seat, name: info.name });
        }
        break;
      }

      case 'bye':
      case 'leave': {
        if (info.roomCode) {
          const room = rooms.get(info.roomCode);
          if (room) {
            room.clients.delete(ws);
            if (room.clients.size === 0) rooms.delete(info.roomCode);
            else for (const c of room.clients) send(c, { t: 'peerLeft', seat: info.seat });
          }
        }
        info.roomCode = null;
        info.seat = -1;
        break;
      }

      case 'emoji': {
        const emoji = (typeof msg.e === 'string' && msg.e.length <= 2) ? msg.e : '😊';
        // Relay to all room members
        const room = rooms.get(info.roomCode);
        if (room) {
          for (const c of room.clients) {
            if (c !== ws) send(c, { t: 'emoji', e: emoji, seat: info.seat, name: info.name });
          }
        }
        break;
      }

      default: {
        // Relay mode: forward any other message to all room members except sender
        if (info.roomCode) {
          const room = rooms.get(info.roomCode);
          if (room) {
            const relayMsg = { ...msg, seat: info.seat };
            for (const c of room.clients) {
              if (c !== ws) send(c, relayMsg);
            }
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info && info.roomCode) {
      const room = rooms.get(info.roomCode);
      if (room) {
        room.clients.delete(ws);
        if (room.clients.size === 0) rooms.delete(info.roomCode);
        else for (const c of room.clients) send(c, { t: 'peerLeft', seat: info.seat });
      }
    }
    clients.delete(ws);
  });

  ws.on('error', () => {});
});

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) code += chars[bytes[i] % chars.length];
  return code;
}

httpServer.listen(PORT, HOST, () => {
  console.log(`Дурак сервер запущен: http://${HOST}:${PORT}`);
});

// Clean up empty rooms periodically
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients.size === 0) rooms.delete(code);
  }
}, 5 * 60 * 1000);
