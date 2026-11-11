import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 20000 });
const root = path.dirname(fileURLToPath(import.meta.url));
const rooms = new Map();
const CODE_RE = /^\d{6}$/;
const send = (socket, message) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  next();
});
app.use('/vendor', express.static(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision'), { immutable: true, maxAge: '7d', setHeaders(res, file) { if (file.endsWith('.mjs')) res.setHeader('Content-Type','text/javascript; charset=utf-8'); } }));
app.use(express.static(path.join(root, 'public'), { maxAge: '1h', extensions: ['html'] }));
app.get('/tv', (_, res) => res.sendFile(path.join(root, 'public', 'tv.html')));
app.get('/celular', (_, res) => res.sendFile(path.join(root, 'public', 'celular.html')));
app.get('/api/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/qr', async (req, res) => {
  const code = String(req.query.codigo || '');
  if (!CODE_RE.test(code) || !rooms.has(code)) return res.status(404).end();
  // QR contains only the phone page of this service and a temporary room code.
  const hostname = req.get('host');
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const destination = `${proto}://${hostname}/celular?codigo=${code}`;
  try {
    const svg = await QRCode.toString(destination, { type: 'svg', margin: 1, width: 240, color: { dark: '#142143', light: '#ffffff' } });
    res.set('Cache-Control', 'no-store').type('image/svg+xml').send(svg);
  } catch {
    res.status(500).end();
  }
});

function newRoomCode() {
  for (let attempts = 0; attempts < 40; attempts++) {
    const code = String(crypto.randomInt(100000, 1000000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('Não foi possível gerar um código.');
}
function disconnect(socket) {
  if (!socket.roomCode) return;
  const room = rooms.get(socket.roomCode);
  if (!room) return;
  if (socket.role === 'tv' && room.tv === socket) {
    send(room.phone, { type: 'tv_disconnected' });
    rooms.delete(socket.roomCode);
  } else if (socket.role === 'phone' && room.phone === socket) {
    room.phone = null;
    send(room.tv, { type: 'phone_disconnected' });
  }
  socket.roomCode = null;
  socket.role = null;
}

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url || '/', 'http://localhost').pathname !== '/ws') return socket.destroy();
  // Browser clients must originate from this same website.
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) return socket.destroy();
    } catch { return socket.destroy(); }
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.role = null;
  ws.roomCode = null;
  ws.failedJoins = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buffer) => {
    let msg;
    try { msg = JSON.parse(buffer.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'create_room' && !ws.role) {
      const code = newRoomCode();
      rooms.set(code, { tv: ws, phone: null, createdAt: Date.now() });
      ws.roomCode = code;
      ws.role = 'tv';
      return send(ws, { type: 'room_created', code });
    }
    if (msg.type === 'join_room' && !ws.role) {
      const code = String(msg.code || '');
      const room = rooms.get(code);
      if (!CODE_RE.test(code) || !room || room.tv.readyState !== WebSocket.OPEN) {
        ws.failedJoins++;
        if (ws.failedJoins > 12) return ws.close(1008, 'Muitas tentativas');
        return send(ws, { type: 'error', message: 'Código não encontrado. Confira o número na TV.' });
      }
      if (room.phone?.readyState === WebSocket.OPEN) return send(ws, { type: 'error', message: 'Essa TV já está usando outro celular.' });
      room.phone = ws;
      ws.role = 'phone';
      ws.roomCode = code;
      send(ws, { type: 'joined', code });
      send(room.tv, { type: 'phone_connected' });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.role === 'phone' && room.phone === ws) {
      if (msg.type === 'camera_status') {
        send(room.tv, { type: 'camera_status', ready: msg.ready === true, detected: Math.max(0, Math.min(2, Number(msg.detected) || 0)) });
      } else if (msg.type === 'pose' && Array.isArray(msg.players) && msg.players.length <= 2) {
        // Transfer only compact numerical body landmarks, never video frames or photos.
        send(room.tv, { type: 'pose_update', players: msg.players, detected: msg.players.length });
      } else if (msg.type === 'command' && ['start', 'pause', 'resume', 'restart', 'mode', 'count'].includes(msg.action)) {
        send(room.tv, { type: 'remote_command', action: msg.action, value: typeof msg.value === 'string' || typeof msg.value === 'number' ? msg.value : null });
      }
    } else if (ws.role === 'tv' && room.tv === ws) {
      if (msg.type === 'settings') {
        send(room.phone, { type: 'settings', mode: msg.mode, count: msg.count, running: msg.running, state: msg.state });
      }
    }
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => disconnect(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  // Room codes are ephemeral. Close abandoned TV rooms after 8 hours.
  for (const [code, room] of rooms) {
    if (Date.now() - room.createdAt > 8 * 60 * 60 * 1000) {
      send(room.phone, { type: 'tv_disconnected' });
      send(room.tv, { type: 'session_expired' });
      room.phone?.close();
      room.tv?.close();
      rooms.delete(code);
    }
  }
}, 30000);
heartbeat.unref();

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`MoviKids pronto: http://localhost:${PORT}`));
