'use strict';
/*
 * Multiplayer room: lobby + chat + a full game run by the server. Transport-agnostic: a player
 * object only needs send(msg). The server owns the puzzles, the clock, validation and scoring;
 * clients never see an answer before they solve it (or the puzzle ends).
 * Uses the same engine as solo play (js/engine.js): buildPuzzles, PuzzleState, pointsFor.
 */
const crypto = require('crypto');
const E = require('../js/engine.js');

const MAX_PLAYERS = 6, MIN_PLAYERS = 2;
const TIMING = { countdownMs: 5000, roundIntroMs: 2800, revealMs: 4500, lobbyGraceMs: 30000 };
const FAST = { countdownMs: 1200, roundIntroMs: 600, revealMs: 1200, lobbyGraceMs: 30000 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newId() { return crypto.randomBytes(6).toString('hex'); }
function cleanName(s) { return String(s || '').replace(/[^\w .'!-]/g, '').trim().slice(0, 16) || 'Player'; }

class Room {
  constructor(code, data, opts = {}) {
    this.code = code; this.data = data;
    this.fast = !!opts.fast; this.t = this.fast ? FAST : TIMING;
    this.cfg = Object.assign({}, E.CONFIG, { pauseDuringFill: false });
    this.rng = opts.rng || Math.random;
    this.players = new Map(); this.order = []; this.hostId = null;
    this.state = 'lobby'; this.chat = []; this.timer = null; this.lastActive = Date.now();
    this.rounds = null; this.roundIdx = 0; this.puzzleIdx = 0; this.endsAt = 0; this.startedAt = 0;
    this.onEmpty = opts.onEmpty || (() => {});
    this.now = opts.now || (() => Date.now());
  }

  // ---------- membership ----------
  addPlayer(name, send) {
    if (this.state !== 'lobby') return { error: 'That game has already started.' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'Room is full (6 players max).' };
    let nm = cleanName(name), k = 2;
    const taken = () => [...this.players.values()].some(p => p.name.toLowerCase() === nm.toLowerCase());
    while (taken()) nm = cleanName(name).slice(0, 13) + ' ' + k++;
    const p = { id: newId(), token: newId() + newId(), name: nm, send, connected: true, score: 0, attempt: null,
                status: 'idle', puzzlePts: 0, lastPts: 0, prevRank: 0, dropTimer: null };
    this.players.set(p.id, p); this.order.push(p.id);
    if (!this.hostId) this.hostId = p.id;
    this.system(p.name + ' joined.');
    this.broadcastRoom();
    return { player: p };
  }
  reconnect(token, send) {
    const p = [...this.players.values()].find(x => x.token === token);
    if (!p) return null;
    p.send = send; p.connected = true; clearTimeout(p.dropTimer);
    if (!this.hostId || !this.players.get(this.hostId)) this.hostId = p.id;
    this.system(p.name + ' reconnected.');
    this.broadcastRoom();
    return p;
  }
  disconnect(p) {
    if (!this.players.has(p.id)) return;
    p.connected = false; p.send = () => {};
    this.system(p.name + ' lost connection.');
    if (this.state === 'lobby') p.dropTimer = setTimeout(() => this.remove(p, true), this.t.lobbyGraceMs);
    if (p.id === this.hostId) this.migrateHost();
    this.broadcastRoom();
    if (this.state === 'playing') this.checkAllDone();
    this.checkEmpty();
  }
  remove(p, silent) {
    if (!this.players.has(p.id)) return;
    clearTimeout(p.dropTimer);
    this.players.delete(p.id); this.order = this.order.filter(id => id !== p.id);
    if (!silent) this.system(p.name + ' left.'); else this.system(p.name + ' dropped out.');
    if (p.id === this.hostId) this.migrateHost();
    this.broadcastRoom();
    if (this.state === 'playing') this.checkAllDone();
    this.checkEmpty();
  }
  migrateHost() {
    const next = this.order.map(id => this.players.get(id)).find(x => x && x.connected) || this.players.get(this.order[0]);
    this.hostId = next ? next.id : null;
    if (next) this.system(next.name + ' is now the host.');
  }
  connected() { return [...this.players.values()].filter(p => p.connected); }
  checkEmpty() { if (!this.connected().length) this.onEmpty(this); }

  // ---------- messaging ----------
  broadcast(msg) { for (const p of this.players.values()) if (p.connected) p.send(msg); }
  system(text) { this.pushChat({ from: null, text, ts: this.now() }); }
  pushChat(m) { this.chat.push(m); if (this.chat.length > 60) this.chat.shift(); this.broadcast({ t: 'chat', msg: m }); }
  say(p, text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const now = this.now(); if (p.lastChat && now - p.lastChat < 300) return;   // light flood control
    p.lastChat = now; this.pushChat({ from: p.name, id: p.id, text, ts: now });
  }
  playerList() {
    return this.order.map(id => this.players.get(id)).filter(Boolean).map(p => ({
      id: p.id, name: p.name, score: p.score, connected: p.connected, isHost: p.id === this.hostId,
      status: p.status, solved: p.attempt ? p.puzzle().targets.length - p.attempt.unsolved().length : 0 }));
  }
  snapshot(p) {
    const s = { code: this.code, state: this.state, hostId: this.hostId, players: this.playerList(), chat: this.chat.slice(-40),
                minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, fast: this.fast, serverNow: this.now() };
    if (this.rounds && this.state !== 'lobby') {
      const r = this.rounds[this.roundIdx];
      s.round = { round: r.round, title: r.title, category: r.category, instruction: r.instruction, count: r.puzzles.length };
      s.puzzleIndex = this.puzzleIdx;
      if (this.state === 'playing') {
        s.puzzle = E.publicPuzzle(this.puzzle()); s.endsAt = this.endsAt; s.durationMs = this.puzzle().seconds * 1000;
        if (p && p.attempt) { s.mine = { status: p.status, buffer: p.attempt.buffer, solved: this.puzzle().targets.filter(t => p.attempt.solved[t.id]).map(t => ({ id: t.id, answer: t.answer })) }; }
      }
      if (this.state === 'finished') s.standings = this.standings();
    }
    return s;
  }
  broadcastRoom() { for (const p of this.players.values()) if (p.connected) p.send({ t: 'room', room: this.snapshot(p) }); }

  // ---------- game flow ----------
  start(p) {
    if (p.id !== this.hostId) return 'Only the host can start.';
    if (this.state !== 'lobby') return 'Already started.';
    if (this.connected().length < MIN_PLAYERS) return 'Need at least ' + MIN_PLAYERS + ' players.';
    this.rounds = E.buildPuzzles(this.data, this.rng, this.cfg);
    for (const x of this.players.values()) { x.score = 0; x.status = 'idle'; x.attempt = null; x.lastPts = 0; x.prevRank = 0; }
    this.roundIdx = 0; this.puzzleIdx = 0; this.state = 'countdown'; this.startedAt = this.now();
    this.system('Game on! Good luck.');
    const end = this.now() + this.t.countdownMs;
    this.broadcast({ t: 'countdown', endsAt: end, serverNow: this.now() });
    this.broadcastRoom();
    this.later(() => this.roundIntro(), this.t.countdownMs);
    return null;
  }
  later(fn, ms) { clearTimeout(this.timer); this.timer = setTimeout(fn, ms); }
  puzzle() { return this.rounds[this.roundIdx].puzzles[this.puzzleIdx]; }
  roundIntro() {
    const r = this.rounds[this.roundIdx];
    this.state = 'intro';
    this.broadcast({ t: 'roundIntro', round: r.round, title: r.title, category: r.category, instruction: r.instruction });
    this.later(() => this.beginPuzzle(), this.t.roundIntroMs);
  }
  beginPuzzle() {
    const pz = this.puzzle(), r = this.rounds[this.roundIdx];
    this.state = 'playing';
    const dur = pz.seconds * 1000;
    this.endsAt = this.now() + dur; this.puzzleStart = this.now();
    for (const p of this.players.values()) {
      p.attempt = new E.PuzzleState(pz); p.status = 'playing'; p.puzzlePts = 0;
      p.puzzle = () => pz;
    }
    this.broadcast({ t: 'puzzle', round: { round: r.round, title: r.title, category: r.category, instruction: r.instruction, count: r.puzzles.length },
      index: this.puzzleIdx, puzzle: E.publicPuzzle(pz), durationMs: dur, endsAt: this.endsAt, serverNow: this.now() });
    this.broadcastProgress();
    this.later(() => this.endPuzzle('time'), dur);
  }
  letters(p, s) {
    if (this.state !== 'playing' || !p.attempt || p.status !== 'playing') return;
    const pz = this.puzzle();
    const letters = E.normalize(s).slice(0, 60);
    for (const c of letters) {
      const r = p.attempt.feedLetter(c);
      if (!r || r.ignored) continue;
      const frac = Math.max(0, (this.endsAt - this.now()) / (pz.seconds * 1000));
      if (r.ok) {
        const pts = E.pointsFor(pz.base, frac, this.cfg);
        p.score += pts; p.puzzlePts += pts;
        const last = p.attempt.unsolved().length === 0;
        if (last) p.status = 'done';
        p.send({ t: 'solved', targetId: r.target.id, answer: r.target.answer, points: pts, score: p.score, last });
      } else {
        p.status = 'out';
        p.send({ t: 'wrong', chunk: r.chunk });
      }
      this.broadcastProgress();
      if (p.status !== 'playing') { this.checkAllDone(); break; }
    }
  }
  backspace(p) { if (this.state === 'playing' && p.attempt && p.status === 'playing') p.attempt.backspace(); }
  broadcastProgress() { this.broadcast({ t: 'progress', players: this.playerList() }); }
  checkAllDone() {
    if (this.state !== 'playing') return;
    const live = this.connected();
    if (live.length && live.every(p => p.status !== 'playing')) this.later(() => this.endPuzzle('done'), 600);
  }
  standings() {
    const list = [...this.players.values()].sort((a, b) => b.score - a.score);
    let rank = 0, prev = null;
    return list.map((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; }
      return { id: p.id, name: p.name, score: p.score, rank, connected: p.connected, lastPts: p.lastPts, prevRank: p.prevRank }; });
  }
  endPuzzle(reason) {
    if (this.state !== 'playing') return;
    const pz = this.puzzle();
    this.state = 'reveal';
    for (const p of this.players.values()) { if (p.status === 'playing') p.status = reason === 'time' ? 'timeout' : 'out'; p.lastPts = p.puzzlePts; }
    const st = this.standings();
    const results = [...this.players.values()].map(p => ({ id: p.id, name: p.name, points: p.puzzlePts, status: p.status,
      solved: pz.targets.length - (p.attempt ? p.attempt.unsolved().length : pz.targets.length) }));
    const last = this.roundIdx === this.rounds.length - 1 && this.puzzleIdx === this.rounds[this.roundIdx].puzzles.length - 1;
    this.broadcast({ t: 'puzzleEnd', reason, answers: pz.targets.map(t => ({ id: t.id, answer: t.answer })), results, standings: st,
                     revealMs: this.t.revealMs, last });
    st.forEach(s => { const p = this.players.get(s.id); if (p) p.prevRank = s.rank; });
    this.later(() => this.next(), this.t.revealMs);
  }
  next() {
    const r = this.rounds[this.roundIdx];
    if (this.puzzleIdx + 1 < r.puzzles.length) { this.puzzleIdx++; this.beginPuzzle(); return; }
    if (this.roundIdx + 1 < this.rounds.length) { this.roundIdx++; this.puzzleIdx = 0; this.roundIntro(); return; }
    this.state = 'finished';
    const max = E.maxScoreOf(this.rounds, this.cfg);
    this.broadcast({ t: 'finished', standings: this.standings().map(s => Object.assign(s, {
      percent: max ? Math.round(100 * s.score / max) : 0, title: E.rankFor(max ? 100 * s.score / max : 0, this.cfg) })), maxScore: max });
    this.system('Game over! The host can start a new game.');
    this.broadcastRoom();
  }
  backToLobby(p) {
    if (p.id !== this.hostId || this.state !== 'finished') return;
    this.state = 'lobby'; this.rounds = null;
    for (const x of this.players.values()) { x.status = 'idle'; x.attempt = null; }
    for (const x of [...this.players.values()]) if (!x.connected) this.remove(x, true);
    this.broadcastRoom();
  }
  destroy() { clearTimeout(this.timer); for (const p of this.players.values()) clearTimeout(p.dropTimer); }
}

module.exports = { Room, cleanName, CODE_CHARS, MAX_PLAYERS, MIN_PLAYERS };
