/* Scrambled Order - multiplayer client: a reconnecting WebSocket plus RemoteGame,
   an adapter that looks like the solo engine's Game to the UI (same events), but the server
   owns the clock, validates every letter and keeps the score. */
(function () {
  'use strict';
  var E = window.OOOEngine;

  function Net() {
    this.ws = null; this.handlers = []; this.queue = []; this.offset = 0; this.closedByUser = false;
    this.retry = 0; this.session = null; this.status = 'idle';
    try { this.session = JSON.parse(sessionStorage.getItem('ooo.session') || 'null'); } catch (e) {}
  }
  Net.available = function () { return /^https?:$/.test(location.protocol) && 'WebSocket' in window; };
  Net.prototype.url = function () { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; };
  Net.prototype.on = function (fn) { this.handlers.push(fn); };
  Net.prototype._emit = function (m) { this.handlers.forEach(function (h) { h(m); }); };
  Net.prototype.connect = function () {
    var self = this;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.closedByUser = false; this.status = 'connecting'; this._emit({ t: '_status', status: 'connecting' });
    var ws = this.ws = new WebSocket(this.url());
    ws.onopen = function () {
      self.retry = 0; self.status = 'open'; self._emit({ t: '_status', status: 'open' }); self.ping();
      if (self.session && self.session.token && self.wantRejoin) ws.send(JSON.stringify({ t: 'join', code: self.session.code, token: self.session.token, name: self.session.name }));
      var q = self.queue; self.queue = []; q.forEach(function (m) { ws.send(JSON.stringify(m)); });
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.serverNow) self.offset = self.offset * 0.7 + (m.serverNow - Date.now()) * 0.3;
      if (m.t === 'pong' && self._pingAt) { var rtt = Date.now() - self._pingAt; self.offset = m.serverNow + rtt / 2 - Date.now(); }
      if (m.t === 'joined') { self.session = { code: m.room.code, token: m.you.token, id: m.you.id, name: self.lastName };
        try { sessionStorage.setItem('ooo.session', JSON.stringify(self.session)); } catch (e) {} self.wantRejoin = true; }
      if (m.t === 'left') self.forget();
      if (m.t === 'error' && m.code === 'noroom') self.forget();
      self._emit(m);
    };
    ws.onclose = function () {
      self.status = 'closed'; self._emit({ t: '_status', status: 'closed' });
      if (self.closedByUser) return;
      var wait = Math.min(8000, 500 * Math.pow(2, self.retry++));
      setTimeout(function () { if (!self.closedByUser) self.connect(); }, wait);
    };
  };
  Net.prototype.send = function (m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else { this.queue.push(m); this.connect(); }
  };
  Net.prototype.ping = function () { this._pingAt = Date.now(); this.send({ t: 'ping' }); };
  Net.prototype.serverNow = function () { return Date.now() + this.offset; };
  Net.prototype.forget = function () { this.session = null; this.wantRejoin = false; try { sessionStorage.removeItem('ooo.session'); } catch (e) {} };
  Net.prototype.close = function () { this.closedByUser = true; if (this.ws) this.ws.close(); };

  // ---------------------------------------------------------------------------------
  function RemoteGame(net, myId) {
    this.net = net; this.myId = myId; this.multiplayer = true;
    this.cfg = Object.assign({}, E.CONFIG, { pauseDuringFill: false });
    this.listeners = []; this.phase = 'countdown'; this.score = 0; this.paused = false;
    this.timeLeft = 0; this.timeTotal = 1; this.endsAt = 0; this._lastSec = null;
    this.round = null; this.puzzle = null; this.puzzleIdx = 0; this.myStatus = 'idle'; this.players = [];
    this.lastResult = null; this.cdEndsAt = 0;
  }
  RemoteGame.prototype.on = function (fn) { this.listeners.push(fn); return this; };
  RemoteGame.prototype._emit = function (type, extra) {
    var ev = Object.assign({ type: type }, extra || {}), self = this;
    this.listeners.forEach(function (fn) { fn(ev, self); });
  };
  RemoteGame.prototype.currentRound = function () { return this.round; };
  RemoteGame.prototype.currentPuzzle = function () { return this.puzzle; };
  RemoteGame.prototype.unsolved = function () { return this.puzzle ? this.puzzle.targets.filter(function (t) { return !t.solved; }) : []; };
  RemoteGame.prototype.setPaused = function () {};           // the server's clock can't be paused
  RemoteGame.prototype.feed = function (s) {
    if (this.phase === 'playing' && this.myStatus === 'playing' && s) this.net.send({ t: 'letters', s: s });
    return [];
  };
  RemoteGame.prototype.backspace = function () { if (this.phase === 'playing') this.net.send({ t: 'bs' }); };
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
  RemoteGame.prototype._setPuzzle = function (m) {
    this.round = m.round; this.puzzleIdx = m.index;
    var p = m.puzzle; p.targets.forEach(function (t) { t.solved = false; t.answer = null; });
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
        t.solved = true; t.answer = m.answer; this.score = m.score;
        if (m.last) this.myStatus = 'done';
        this._emit('solved', { target: t, typed: 3, points: m.points, score: m.score, last: m.last, fillMs: (t.answer.length - 3) * this.cfg.letterMs });
        if (m.last) this._emit('puzzleSolved', {});
        break; }
      case 'wrong': this.myStatus = 'out'; this._emit('wrong', { chunk: m.chunk, reveal: [], waitForEnd: true }); break;
      case 'progress': this.players = m.players;
        var me = m.players.filter(function (p) { return p.id === self.myId; })[0]; if (me) this.score = me.score;
        this._emit('progress', { players: m.players }); break;
      case 'puzzleEnd': {
        var wasPlaying = this.myStatus === 'playing';
        if (this.puzzle) m.answers.forEach(function (a) { var t = self.puzzle.targets[a.id]; if (t) t.answer = a.answer; });
        this.phase = 'feedback'; if (wasPlaying) this.myStatus = m.reason === 'time' ? 'timeout' : 'out';
        this.timeLeft = m.reason === 'time' ? 0 : this.timeLeft;
        var rev = this.puzzle ? this.puzzle.targets.filter(function (t) { return !t.solved; }).map(function (t) { return t.id; }) : [];
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
      this._setPuzzle({ round: room.round, index: room.puzzleIndex, puzzle: room.puzzle, durationMs: room.durationMs, endsAt: room.endsAt });
      var mine = room.mine;
      if (mine) {
        mine.solved.forEach(function (s) { var t = self.puzzle.targets[s.id]; t.solved = true; t.answer = s.answer; self._emit('restored', { target: t }); });
        this.myStatus = mine.status;
      }
    } else if (room.round) { this.round = room.round; this.phase = room.state === 'intro' ? 'roundIntro' : room.state === 'reveal' ? 'feedback' : this.phase; }
    var me = room.players.filter(function (p) { return p.id === self.myId; })[0]; if (me) this.score = me.score;
    this.players = room.players;
  };

  window.OOONet = { Net: Net, RemoteGame: RemoteGame };
})();
