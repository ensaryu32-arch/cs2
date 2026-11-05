const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;
const BASE_DIR = __dirname;

// Stream-based low-memory assembler for valve.zip (Peak RAM < 8 MB)
const VALVE_ZIP_PATH = path.join(BASE_DIR, 'valve.zip');

function assembleValveZip(callback) {
  if (fs.existsSync(VALVE_ZIP_PATH)) {
    return callback();
  }

  const parts = fs.readdirSync(BASE_DIR).filter(f => f.startsWith('valve_part_')).sort();
  if (parts.length === 0) {
    return callback();
  }

  console.log(`📦 Düşük RAM Modu: ${parts.length} parça disk üzerinden valve.zip olarak birleştiriliyor...`);
  const outStream = fs.createWriteStream(VALVE_ZIP_PATH);

  function appendPart(idx) {
    if (idx >= parts.length) {
      outStream.end();
      return;
    }
    const partPath = path.join(BASE_DIR, parts[idx]);
    const inStream = fs.createReadStream(partPath);
    inStream.pipe(outStream, { end: false });
    inStream.on('end', () => {
      try { fs.unlinkSync(partPath); } catch(e) {}
      appendPart(idx + 1);
    });
    inStream.on('error', (err) => {
      console.error('Parça okuma hatası:', err);
      outStream.end();
    });
  }

  outStream.on('finish', () => {
    try {
      const sizeMb = (fs.statSync(VALVE_ZIP_PATH).size / (1024 * 1024)).toFixed(1);
      console.log(`✅ valve.zip başarıyla hazırlandı (${sizeMb} MB) - RAM aşımı engellendi!`);
    } catch(e) {}
    callback();
  });

  appendPart(0);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
  '.so': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.css': 'text/css'
};

// Room management
// roomId -> { id, name, map, password, hasPassword, mode, maxPlayers, hostWs, guests: Map(guestId -> { ws, name }), nextGuestId: 2, createdAt: number }
const activeRooms = new Map();

function getPublicRoomsList() {
  const list = [];
  for (const [id, room] of activeRooms.entries()) {
    const currentPlayers = (room.hostWs ? 1 : 0) + room.guests.size;
    list.push({
      id: room.id,
      name: room.name,
      map: room.map,
      hasPassword: room.hasPassword,
      mode: room.mode,
      maxPlayers: room.maxPlayers,
      currentPlayers: currentPlayers,
      status: room.hostWs ? 'Aktif 🟢' : 'Bekleniyor 🟡',
      createdAt: room.createdAt
    });
  }
  return list;
}

const server = http.createServer((req, res) => {
  // Required WebAssembly & SharedArrayBuffer headers for CS 1.6
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = req.url.split('?')[0];

  // API Endpoints for Room Management
  if (parsedUrl === '/api/rooms') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(getPublicRoomsList()));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const roomId = data.id || ('room-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6));
          const newRoom = {
            id: roomId,
            name: (data.name || 'Özel VS Odası').slice(0, 40),
            map: data.map || 'de_dust2',
            hasPassword: !!data.password,
            password: data.password || '',
            mode: data.mode || 'vs',
            maxPlayers: parseInt(data.maxPlayers, 10) || 16,
            hostWs: null,
            guests: new Map(),
            nextGuestId: 2,
            createdAt: Date.now()
          };

          activeRooms.set(roomId, newRoom);

          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            id: newRoom.id,
            name: newRoom.name,
            map: newRoom.map,
            hasPassword: newRoom.hasPassword,
            mode: newRoom.mode,
            maxPlayers: newRoom.maxPlayers,
            currentPlayers: 1,
            status: 'Aktif 🟢'
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Geçersiz veri' }));
        }
      });
      return;
    }
  }

  let reqPath = parsedUrl === '/' ? '/index.html' : parsedUrl;
  let filePath = path.join(BASE_DIR, decodeURIComponent(reqPath));

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Dosya Bulunamadı');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);

  // Range support for fast streaming of valve.zip (412 MB)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = (end - start) + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    stream.pipe(res);
  } else {
    const isStaticCode = ext === '.html' || ext === '.js' || ext === '.css';
    const cacheHeader = isStaticCode ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheHeader
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Attach WebSocket Server to standard HTTP server (Port 443 on Render)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room');
  const role = url.searchParams.get('role'); // 'host' or 'guest'
  const nick = decodeURIComponent(url.searchParams.get('nick') || 'Oyuncu');

  if (!roomId) {
    ws.close(1008, 'Room ID missing');
    return;
  }

  let room = activeRooms.get(roomId);
  if (!room) {
    // Auto-create room if not found
    room = {
      id: roomId,
      name: 'Özel VS Odası',
      map: 'de_dust2',
      hasPassword: false,
      password: '',
      mode: 'vs',
      maxPlayers: 16,
      hostWs: null,
      guests: new Map(),
      nextGuestId: 2,
      createdAt: Date.now()
    };
    activeRooms.set(roomId, room);
  }

  let clientGuestId = null;

  if (role === 'host') {
    room.hostWs = ws;
    ws.isAlive = true;
    ws.send(JSON.stringify({ type: 'HOST_CONNECTED', roomId, map: room.map }));

    // Notify any already connected guests that host is ready
    for (const [gid, guest] of room.guests.entries()) {
      if (guest.ws.readyState === WebSocket.OPEN) {
        guest.ws.send(JSON.stringify({ type: 'HOST_READY', roomId, map: room.map }));
      }
    }
  } else {
    // Guest client
    clientGuestId = room.nextGuestId++;
    if (room.nextGuestId > 16) room.nextGuestId = 2; // Keep virtual IPs 127.0.0.2 to 127.0.0.16

    room.guests.set(clientGuestId, { ws, name: nick });
    ws.isAlive = true;

    ws.send(JSON.stringify({
      type: 'GUEST_ASSIGNED',
      guestId: clientGuestId,
      roomId,
      map: room.map,
      hostReady: !!(room.hostWs && room.hostWs.readyState === WebSocket.OPEN)
    }));

    if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
      room.hostWs.send(JSON.stringify({
        type: 'GUEST_JOINED',
        guestId: clientGuestId,
        name: nick
      }));
    }
  }

  ws.on('message', (message, isBinary) => {
    let isJson = false;
    if (typeof message === 'string') {
      isJson = true;
    } else if (Buffer.isBuffer(message) && message.length >= 2 && message[0] === 0x7B && message[message.length - 1] === 0x7D) {
      isJson = true;
    }

    if (isJson) {
      try {
        const text = message.toString('utf8');
        const data = JSON.parse(text);
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (e) {}
      return;
    }

    // Binary Game Packet Relay
    const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);

    if (role === 'host') {
      // Host sent packet to a guest: byte 0 is target guestId
      if (buf.length < 2) return;
      const targetGuestId = buf[0];
      const packetPayload = buf.slice(1);
      const guest = room.guests.get(targetGuestId);
      if (guest && guest.ws.readyState === WebSocket.OPEN) {
        guest.ws.send(packetPayload);
      }
    } else {
      // Guest sent packet to host: prepend guestId so host knows which client sent it
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        const tagged = Buffer.allocUnsafe(1 + buf.length);
        tagged[0] = clientGuestId;
        buf.copy(tagged, 1);
        room.hostWs.send(tagged);
      }
    }
  });

  ws.on('close', () => {
    if (role === 'host') {
      room.hostWs = null;
      for (const [gid, guest] of room.guests.entries()) {
        if (guest.ws.readyState === WebSocket.OPEN) {
          guest.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: 'Oda kurucusu oyundan ayrıldı!' }));
        }
      }
      setTimeout(() => {
        if (!room.hostWs && room.guests.size === 0) {
          activeRooms.delete(roomId);
        }
      }, 30000);
    } else if (clientGuestId) {
      room.guests.delete(clientGuestId);
      if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
        room.hostWs.send(JSON.stringify({ type: 'GUEST_LEFT', guestId: clientGuestId }));
      }
    }
  });

  ws.on('error', (err) => {
    console.warn(`WebSocket error (${role}):`, err.message);
  });
});

// Periodic ping to prevent Render connection timeouts
const pingInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 25000);

wss.on('close', () => clearInterval(pingInterval));

assembleValveZip(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('====================================================');
    console.log(`🎮 Counter-Strike 1.6 Web Multiplayer Sunucusu Aktif!`);
    console.log(`🌐 Port: ${PORT} (Render.com & Yerel Ağ Uyumlu)`);
    console.log(`⚡ Standart WSS/HTTPS üzerinden 16 Kişilik Kesintisiz VS`);
    console.log('====================================================');
  });
});
