'use strict';
/*
 * Scrambled Order server: serves the static game and runs multiplayer rooms over
 * WebSockets (path /ws). Usage: PORT=8080 node server/server.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Room, CODE_CHARS } = require('./room');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'puzzles.json'), 'utf8'));

function createServer(opts = {}) {
  const app = express();
  const rooms = new Map();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, profile }));
  app.get('/r/:code', (req, res) => res.redirect('/?room=' + encodeURIComponent(String(req.params.code).toUpperCase().slice(0, 6))));
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  // Build profile: "public" (default, original art only) or "classic" (PROFILE=classic, needs the
  // private classic/ folder, which is never part of the public bundle or Docker image).
  const profile = (opts.profile || process.env.PROFILE || 'public').toLowerCase();
  const classicDir = path.join(ROOT, 'classic');
  if (profile === 'classic') {
    if (!fs.existsSync(path.join(classicDir, 'profile.js'))) throw new Error('PROFILE=classic but the classic/ folder is missing');
    app.get('/js/profile.js', (req, res) => res.sendFile(path.join(classicDir, 'profile.js')));
    app.use('/classic', express.static(classicDir, { maxAge: '1h' }));
  } else if (process.env.GAME_TITLE) {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'profile.js'), 'utf8')
      .replace(/title: '[^']*'/, 'title: ' + JSON.stringify(String(process.env.GAME_TITLE).slice(0, 40)));
    app.get('/js/profile.js', (req, res) => res.type('application/javascript').send(src));
  }
  for (const dir of ['css', 'js', 'assets', 'data']) app.use('/' + dir, express.static(path.join(ROOT, dir), { maxAge: '1h' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  function newCode() {
    for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; if (!rooms.has(c)) return c; }
  }
  function getRoomEmptyHandler(room) {
    return () => setTimeout(() => {           // keep an empty room around briefly for reconnects
      if (rooms.get(room.code) === room && !room.connected().length) { room.destroy(); rooms.delete(room.code); }
    }, opts.emptyRoomMs || 120000);
  }

  wss.on('connection', (ws) => {
    let room = null, me = null;
    const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'ping') return send({ t: 'pong', id: m.id, serverNow: Date.now() });
      if (!me) {
        if (m.t === 'create') {
          room = new Room(newCode(), data, { fast: !!m.fast }); room.onEmpty = getRoomEmptyHandler(room);
          rooms.set(room.code, room);
          const r = room.addPlayer(m.name, send); me = r.player;
          return send({ t: 'joined', you: { id: me.id, token: me.token }, room: room.snapshot(me) });
        }
        if (m.t === 'join') {
          const code = String(m.code || '').toUpperCase().trim();
          const rm = rooms.get(code);
          if (!rm) return send({ t: 'error', code: 'noroom', msg: 'No room with code ' + code + '.' });
          if (m.token) { const p = rm.reconnect(m.token, send); if (p) { room = rm; me = p; return send({ t: 'joined', you: { id: p.id, token: p.token }, room: rm.snapshot(p), rejoined: true }); } }
          const r = rm.addPlayer(m.name, send);
          if (r.error) return send({ t: 'error', code: 'join', msg: r.error });
          room = rm; me = r.player;
          return send({ t: 'joined', you: { id: me.id, token: me.token }, room: room.snapshot(me) });
        }
        return send({ t: 'error', msg: 'Join a room first.' });
      }
      room.lastActive = Date.now();
      switch (m.t) {
        case 'chat': room.say(me, m.text); break;
        case 'start': { const err = room.start(me); if (err) send({ t: 'error', msg: err }); break; }
        case 'letters': room.letters(me, String(m.s || '')); break;
        case 'bs': room.backspace(me); break;
        case 'back': room.backToLobby(me); break;
        case 'leave': room.remove(me); me = null; room = null; send({ t: 'left' }); break;
      }
    });
    ws.on('close', () => { if (room && me) room.disconnect(me); });
  });
  const hb = setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 15000);
  server.on('close', () => { clearInterval(hb); rooms.forEach(r => r.destroy()); });
  return { app, server, wss, rooms };
}

if (require.main === module) {
  const port = +process.env.PORT || 8080;
  const { server } = createServer();
  server.listen(port, () => console.log((process.env.PROFILE === 'classic' ? 'classic' : 'public') + ' game server on http://localhost:' + port));
}
module.exports = { createServer };
