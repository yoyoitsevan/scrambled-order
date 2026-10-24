/* Scrambled Order - multiplayer client: a reconnecting WebSocket plus RemoteGame,
   an adapter that looks like the solo engine's Game to the UI (same events), but the server
   owns the clock, validates every letter and keeps the score.
   Latency: the client keeps its clock synced to the server's (NTP-style pings, best of the last few
   round trips). The server sends each puzzle with startsAt/endsAt, so every player reveals it at the
   same moment and counts down locally; typed letters carry their synced time so the server can judge
   them by when they were typed (within the player's measured latency). */
(function () {
  'use strict';
  var E = window.OOOEngine;

  function Net() {
    this.ws = null; this.handlers = []; this.queue = []; this.offset = 0; this.closedByUser = false;
    this.retry = 0; this.session = null; this.status = 'idle';
    this.synced = false; this.samples = []; this.rtt = 0; this._pid = 0; this._pings = {}; this._pingTimer = null;
    try { this.session = JSON.parse(sessionStorage.getItem('ooo.session') || 'null'); } catch (e) {}
  }
  // Inside the iOS/Android app (Capacitor) the page is served from the device, so multiplayer talks to
  // the hosted server named by the build profile (js/profile.js: appServer/appWeb). In a browser it stays
  // same-origin. window.OOO_SERVER overrides both (testing).
  var PROF = window.OOO_PROFILE || {};
  var APP_WS = PROF.appServer || 'wss://scrambled-order.onrender.com/ws', APP_WEB = PROF.appWeb || 'https://scrambled-order.onrender.com/';
  // Password-gated servers (profile appKey: "<label>"): the app asks for the password once and keeps only
  // HMAC-SHA256(password, label), sent as a websocket subprotocol ("ooo", "k<hex>"); the server answers
  // close code 4401 if it is wrong. Browsers keep using the site's normal login. The public profile has
  // no appKey, so the public app never asks.
  var KEY_STORE = 'ooo.appKey', KEY_LABEL = typeof PROF.appKey === 'string' ? PROF.appKey : 'ooo-app-v1';
  Net.needsKey = function () { return !!PROF.appKey && (Net.isApp() || !!window.OOO_SERVER); };
  Net.getKey = function () { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  Net.clearKey = function () { try { localStorage.removeItem(KEY_STORE); } catch (e) {} };
  Net.setPassword = function (pw) {
    return hmacHex(String(pw), KEY_LABEL).then(function (hex) { try { localStorage.setItem(KEY_STORE, hex); } catch (e) {} return hex; });
  };
  function hmacHex(key, msg) {
    var enc = function (t) { return new TextEncoder().encode(t); };
    var C = window.crypto && window.crypto.subtle;
    if (C && window.isSecureContext !== false) {
      return C.importKey('raw', enc(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        .then(function (k) { return C.sign('HMAC', k, enc(msg)); }).then(toHex)
        .catch(function () { return toHex(hmacSha256(enc(key), enc(msg))); });
    }
    return Promise.resolve(toHex(hmacSha256(enc(key), enc(msg))));
  }
  function toHex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  // small SHA-256 / HMAC fallback for web views without crypto.subtle
  function sha256(bytes) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
      0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
      0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
      0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n), W = new Array(64), i, j;
    m.set(bytes); m[l] = 0x80; var bits = l * 8;
    for (i = 0; i < 4; i++) m[n - 1 - i] = (bits >>> (8 * i)) & 255;
    m[n - 5] = Math.floor(bits / 4294967296) & 255;
    var r = function (x, c) { return (x >>> c) | (x << (32 - c)); };
    for (j = 0; j < n; j += 64) {
      for (i = 0; i < 16; i++) W[i] = (m[j + 4 * i] << 24) | (m[j + 4 * i + 1] << 16) | (m[j + 4 * i + 2] << 8) | m[j + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        var t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255; }
    return out;
  }
  function hmacSha256(key, msg) {
    if (key.length > 64) key = sha256(key);
    var k = new Uint8Array(64), i; k.set(key);
    var ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    ip.set(msg, 64); op.set(sha256(ip), 64);
    return sha256(op);
  }
  Net._hmacSha256 = hmacSha256;   // exposed for tests
  Net.isApp = function () { var C = window.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); };
  Net.remote = function () { return window.OOO_SERVER || (Net.isApp() ? APP_WS : null); };
  Net.available = function () { return 'WebSocket' in window && (!!Net.remote() || /^https?:$/.test(location.protocol)); };
  Net.shareBase = function () {   // base URL for "join my room" links (the app's own origin is not reachable by friends)
    if (Net.isApp()) return APP_WEB;
    return location.origin + location.pathname.replace(/index\.html$/, '');
  };
  Net.prototype.url = function () { return Net.remote() || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); };
  Net.prototype.on = function (fn) { this.handlers.push(fn); };
  Net.prototype._emit = function (m) { this.handlers.forEach(function (h) { h(m); }); };
  Net.prototype.connect = function () {
    var self = this;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    var key = Net.needsKey() ? Net.getKey() : '';
    if (Net.needsKey() && !key) { this.status = 'auth'; this._emit({ t: '_auth', reason: 'missing' }); return; }
    this.closedByUser = false; this.status = 'connecting'; this._emit({ t: '_status', status: 'connecting' });
    var ws = this.ws = key ? new WebSocket(this.url(), ['ooo', 'k' + key]) : new WebSocket(this.url());
    ws.onopen = function () {
      self.retry = 0; self.status = 'open'; self._emit({ t: '_status', status: 'open' });
      self.ping(); setTimeout(function () { self.ping(); }, 400); setTimeout(function () { self.ping(); }, 1200);
      clearInterval(self._pingTimer); self._pingTimer = setInterval(function () { self.ping(); }, 4000);   // clock sync + keepalive
      if (self.session && self.session.token && self.wantRejoin) ws.send(JSON.stringify({ t: 'join', code: self.session.code, token: self.session.token, name: self.session.name }));
      var q = self.queue; self.queue = []; q.forEach(function (m) { ws.send(JSON.stringify(m)); });
      self.unconfirmed = key ? q : null;   // kept until the server answers, so a refused password doesn't drop them
      self.opened = true; self.heard = false;
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'auth' && !m.ok) { self.denied = true; return; }   // the server refused the app password
      self.unconfirmed = null; self.heard = true;
      if (m.t === 'pong') { self._pong(m); return; }
      if (m.serverNow && !self.synced) self.offset = m.serverNow - Date.now();   // rough, until the first pong
      if (m.t === 'joined') { self.session = { code: m.room.code, token: m.you.token, id: m.you.id, name: self.lastName };
        try { sessionStorage.setItem('ooo.session', JSON.stringify(self.session)); } catch (e) {} self.wantRejoin = true; }
      if (m.t === 'left') self.forget();
      if (m.t === 'error' && m.code === 'noroom') self.forget();
      self._emit(m);
    };
    ws.onclose = function (ev) {
      // wrong or changed password: ask again, no reconnect loop. Proxies can drop the 4401 close frame, so an
      // app-key socket that opened and closed without one server message (not even the pong) counts too.
      var refused = (ev && ev.code === 4401) || self.denied || (key && self.opened && !self.heard && !self.closedByUser);
      self.opened = false; self.denied = false; clearInterval(self._pingTimer); self._pings = {};
      if (refused) {
        self.queue = (self.unconfirmed || []).concat(self.queue); self.unconfirmed = null;
        Net.clearKey(); self.status = 'auth'; self._emit({ t: '_auth', reason: 'denied' }); return;
      }
      self.status = 'closed'; self._emit({ t: '_status', status: 'closed' });
      if (self.closedByUser) return;
      var wait = Math.min(8000, 500 * Math.pow(2, self.retry++));
      setTimeout(function () { if (!self.closedByUser) self.connect(); }, wait);
    };
  };
  Net.prototype.send = function (m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else { this.queue.push(m); this.connect(); }
  };
  Net.prototype.ping = function () {
    if (!this.ws || this.ws.readyState !== 1) return;
    var id = ++this._pid; this._pings[id] = Date.now(); this.ws.send(JSON.stringify({ t: 'ping', id: id }));
  };
  // NTP-style: offset from the round trip with the lowest RTT among the last 8 (least queueing delay)
  Net.prototype._pong = function (m) {
    var sent = this._pings[m.id]; delete this._pings[m.id];
    if (!sent || !m.serverNow) return;
    var now = Date.now(), rtt = now - sent;
    this.samples.push({ rtt: rtt, off: m.serverNow + rtt / 2 - now }); if (this.samples.length > 8) this.samples.shift();
    var best = this.samples.reduce(function (a, b) { return b.rtt < a.rtt ? b : a; });
    this.offset = best.off; this.synced = true;
    var r = this.samples.map(function (x) { return x.rtt; }).sort(function (a, b) { return a - b; }); this.rtt = r[r.length >> 1];
  };
  Net.prototype.serverNow = function () { return Date.now() + this.offset; };
  Net.prototype.forget = function () { this.session = null; this.wantRejoin = false; try { sessionStorage.removeItem('ooo.session'); } catch (e) {} };
  Net.prototype.close = function () { this.closedByUser = true; clearInterval(this._pingTimer); if (this.ws) this.ws.close(); };

  // ---------------------------------------------------------------------------------
  function RemoteGame(net, myId) {
    this.net = net; this.myId = myId; this.multiplayer = true;
    this.cfg = Object.assign({}, E.CONFIG, { pauseDuringFill: false });
    this.listeners = []; this.phase = 'countdown'; this.score = 0; this.paused = false;
    this.timeLeft = 0; this.timeTotal = 1; this.endsAt = 0; this._lastSec = null;
    this.round = null; this.puzzle = null; this.puzzleIdx = 0; this.myStatus = 'idle'; this.players = [];
    this.lastResult = null; this.cdEndsAt = 0; this._reveal = null;
    this._hints = []; this._resetTyping();
  }
  // Local mirror of the server's point freeze: the synced time the first letter of each answer was typed.
  RemoteGame.prototype._resetTyping = function () { this._buf = 0; this._bufStart = null; this._chunks = []; };
  RemoteGame.prototype._clearHints = function () { this._hints.forEach(clearTimeout); this._hints = []; };
  // What the next word is worth right now (same server clock and formula as the server's award).
  RemoteGame.prototype.pointsNow = function () {
    var p = this.puzzle; if (this.phase !== 'playing' || !p || this.myStatus !== 'playing') return null;
    var now = this.net.serverNow(), st = this._chunks.length ? this._chunks[0] : this._bufStart, te = E.valueTime(st, now, this.cfg);
    return { points: E.pointsFor(p.base, (this.endsAt - te) / this.timeTotal, this.cfg), frozen: st != null && te === st };
  };
  RemoteGame.prototype.on = function (fn) { this.listeners.push(fn); return this; };
  RemoteGame.prototype._emit = function (type, extra) {
    var ev = Object.assign({ type: type }, extra || {}), self = this;
    this.listeners.forEach(function (fn) { fn(ev, self); });
  };
  RemoteGame.prototype.currentRound = function () { return this.round; };
  RemoteGame.prototype.currentPuzzle = function () { return this.puzzle; };
  RemoteGame.prototype.unsolved = function () { return this.puzzle ? this.puzzle.targets.filter(function (t) { return !t.solved && !t.revealed; }) : []; };
  RemoteGame.prototype.setPaused = function () {};           // the server's clock can't be paused
  // each message carries the synced time it was typed; nothing is sent after the buzzer
  RemoteGame.prototype.feed = function (s) {
    var now = this.net.serverNow();
    if (this.phase === 'playing' && this.myStatus === 'playing' && s && now < this.endsAt) {
      this.net.send({ t: 'letters', s: s, at: Math.round(now) });
      for (var i = 0; i < E.normalize(s).length; i++) {
        if (!this._buf) this._bufStart = Math.round(now);
        if (++this._buf === 3) { this._chunks.push(this._bufStart); this._buf = 0; this._bufStart = null; }
      }
    }
    return [];
  };
  RemoteGame.prototype.backspace = function () {
    if (this.phase === 'playing' && this.net.serverNow() < this.endsAt) {
      this.net.send({ t: 'bs' });
      if (this._buf && !--this._buf) this._bufStart = null;
    }
  };
  // Storybook auto-reveal: the server announces it ahead of time; show it at its server time `at`.
  RemoteGame.prototype._hint = function (m) {
    var self = this, wait = m.at - this.net.serverNow();
    function show() {
      var t = self.puzzle && self.puzzle.targets[m.id]; if (!t || t.solved || t.revealed || self.phase !== 'playing') return;
      t.revealed = true; t.answer = m.answer;
      self._emit('reveal', { target: t, id: m.id, answer: m.answer });
    }
    if (wait > 8) this._hints.push(setTimeout(show, Math.min(wait, 5000))); else show();
  };
  RemoteGame.prototype.tick = function () {
    var now = this.net.serverNow();
    if (this.phase === 'countdown') {
      var s = Math.max(0, Math.ceil((this.cdEndsAt - now) / 1000));
      if (s !== this._lastSec && s > 0) { this._lastSec = s; this._emit('countdown', { seconds: s }); }
    } else if (this.phase === 'playing') {
      this.timeLeft = Math.max(0, Math.min(this.timeTotal, this.endsAt - now));
      var sec = Math.ceil(this.timeLeft / 1000);
      if (sec !== this._lastSec) { this._lastSec = sec; if (sec > 0) this._emit('second', { seconds: sec }); }
    }
  };
  // The server sends a puzzle slightly ahead of startsAt; reveal it at that moment (same for everyone).
  RemoteGame.prototype._setPuzzle = function (m) {
    var self = this, wait = m.startsAt ? m.startsAt - this.net.serverNow() : 0;
    clearTimeout(this._reveal); this._reveal = null;
    if (wait > 8) { this._reveal = setTimeout(function () { self._reveal = null; self._showPuzzle(m); }, Math.min(wait, 3000)); return; }
    this._showPuzzle(m);
  };
  RemoteGame.prototype._showPuzzle = function (m) {
    this.round = m.round; this.puzzleIdx = m.index; this._clearHints(); this._resetTyping();
    var p = m.puzzle; p.targets.forEach(function (t) { t.solved = false; t.revealed = false; t.answer = null; });
    p.title = m.round.title; this.puzzle = p;
    this.timeTotal = m.durationMs; this.endsAt = m.endsAt; this.timeLeft = m.endsAt - this.net.serverNow();
    this.phase = 'playing'; this.myStatus = 'playing'; this._lastSec = Math.ceil(this.timeLeft / 1000);
    this._emit('puzzle', { puzzle: p, index: m.index, count: m.round.count });
  };
  RemoteGame.prototype.handle = function (m) {
    var self = this;
    switch (m.t) {
      case 'countdown': this.phase = 'countdown'; this.cdEndsAt = m.endsAt; this._lastSec = null; this.tick(); break;
      case 'roundIntro': this.phase = 'roundIntro'; this.round = { round: m.round, title: m.title, category: m.category, instruction: m.instruction };
        this._emit('roundIntro', m); break;
      case 'puzzle': this._setPuzzle(m); break;
      case 'solved': {
        var t = this.puzzle && this.puzzle.targets[m.targetId]; if (!t) break;
        t.solved = true; t.answer = m.answer; this.score = m.score; this._chunks.shift();
        if (m.last) this.myStatus = 'done';
        this._emit('solved', { target: t, typed: 3, points: m.points, score: m.score, last: m.last, fillMs: (t.answer.length - 3) * this.cfg.letterMs });
        if (m.last) this._emit('puzzleSolved', {});
        break; }
      case 'reveal': this._hint(m); break;
      case 'skipped': this._chunks.shift(); this._emit('skipped', { chunk: m.chunk }); break;
      case 'wrong': this.myStatus = 'out'; this._resetTyping(); this._emit('wrong', { chunk: m.chunk, reveal: [], waitForEnd: true }); break;
      case 'progress': this.players = m.players;
        var me = m.players.filter(function (p) { return p.id === self.myId; })[0]; if (me) this.score = me.score;
        this._emit('progress', { players: m.players }); break;
      case 'puzzleEnd': {
        if (this._reveal) { clearTimeout(this._reveal); this._reveal = null; }
        this._clearHints();
        var wasPlaying = this.myStatus === 'playing';
        if (this.puzzle) m.answers.forEach(function (a) { var t = self.puzzle.targets[a.id]; if (t) t.answer = a.answer; });
        this.phase = 'feedback'; if (wasPlaying) this.myStatus = m.reason === 'time' ? 'timeout' : 'out';
        this.timeLeft = m.reason === 'time' ? 0 : this.timeLeft;
        var rev = this.puzzle ? this.puzzle.targets.filter(function (t) { return !t.solved && !t.revealed; }).map(function (t) { return t.id; }) : [];
        if (wasPlaying && m.reason === 'time') this._emit('timeout', { reveal: rev, multiplayer: true });
        this._emit('puzzleEnd', { reason: m.reason, reveal: rev, standings: m.standings, results: m.results, revealMs: m.revealMs, last: m.last });
        break; }
      case 'finished': this.phase = 'finished'; this._emit('finished', { standings: m.standings, multiplayer: true, maxScore: m.maxScore }); break;
    }
  };
  // Rejoining mid-game: rebuild the current puzzle from the room snapshot.
  RemoteGame.prototype.resume = function (room) {
    var self = this;
    if (room.state === 'playing' && room.puzzle) {
      this._showPuzzle({ round: room.round, index: room.puzzleIndex, puzzle: room.puzzle, durationMs: room.durationMs, endsAt: room.endsAt });
      var mine = room.mine;
      if (mine) {
        mine.solved.forEach(function (s) { var t = self.puzzle.targets[s.id]; t.solved = true; t.answer = s.answer; self._emit('restored', { target: t }); });
        this.myStatus = mine.status;
      }
      (room.reveals || []).forEach(function (r) { self._hint(r); });
    } else if (room.round) { this.round = room.round; this.phase = room.state === 'intro' ? 'roundIntro' : room.state === 'reveal' ? 'feedback' : this.phase; }
    var me = room.players.filter(function (p) { return p.id === self.myId; })[0]; if (me) this.score = me.score;
    this.players = room.players;
  };

  window.OOONet = { Net: Net, RemoteGame: RemoteGame };
})();
