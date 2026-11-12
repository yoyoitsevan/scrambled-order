// node tools/test-machines.js -- transition tables, and the room / phase / socket flows that use them
const assert = require('assert');
const M = require('../js/machines.js');
const E = require('../js/engine.js');
const { Room } = require('../server/room.js');
const data = require('../data/puzzles.json');

let n = 0;
const test = (name, fn) => { fn(); n++; };

test('every listed edge is allowed, and a missing edge is not', () => {
  Object.keys(M.MACHINES).forEach(name => {
    const t = M.MACHINES[name].transitions;
    assert(M.known(name, M.MACHINES[name].initial), name + ' initial');
    Object.keys(t).forEach(from => {
      assert(M.allows(name, from, from), name + ' self ' + from);
      t[from].forEach(to => assert(M.step(name, from, to).ok, name + ' ' + from + ' → ' + to));
      const blocked = Object.keys(t).find(s => s !== from && t[from].indexOf(s) < 0);
      if (blocked) assert(!M.allows(name, from, blocked), name + ' must not ' + from + ' → ' + blocked);
    });
  });
  assert(!M.step('room', 'lobby', 'playing').ok);
  assert(!M.step('room', 'nope', 'lobby').ok);
  assert(!M.step('player', 'idle', 'timeout').ok);
  assert(!M.step('phase', 'playing', 'finished').ok, 'a puzzle cannot skip the reveal');
  assert(!M.adopt('player', { status: 'idle' }, 'status', 'flying').ok);
});

test('player status only moves along the table', () => {
  const room = new Room('STAT', data, { fast: true, rng: () => 0.2 });
  const p = room.addPlayer('Ann', () => {}).player;
  assert.equal(p.status, 'idle');
  assert.equal(room.setStatus(p, 'out'), false);
  assert.equal(p.status, 'idle');
  assert.equal(room.setStatus(p, 'playing'), true);
  assert.equal(room.setStatus(p, 'done'), true);
  assert.equal(room.setStatus(p, 'idle'), true);
  room.letters(p, 'ABC', 0);
  assert.equal(p.status, 'idle', 'letters in the lobby do nothing');
  room.destroy();
});

test('room walk: legal lifecycle, snapshots, and the moves that must no-op', () => {
  let T = 5e6;
  const room = new Room('WALK', data, { fast: true, now: () => T, rng: () => 0.2 });
  const a = room.addPlayer('Ann', () => {}).player, b = room.addPlayer('Bo', () => {}).player;
  assert.equal(room.state, 'lobby');
  room.beginPuzzle(0); room.roundIntro(); room.endPuzzle('time'); room.next(0);
  assert.equal(room.state, 'lobby', 'skipped steps do not move the room');
  assert.equal(room.backToLobby(a), undefined);
  assert.equal(room.start(b), 'Only the host can start.');
  assert.equal(room.start(a), null);
  assert.equal(room.state, 'countdown');
  const cd = room.snapshot(a);
  assert.equal(cd.state, 'countdown');
  assert(cd.countdownEndsAt > T, 'a rejoin during the countdown can show the same clock');
  assert(!cd.puzzle && !cd.answers);
  clearTimeout(room.timer);
  let guard = 0, sawReveal = false;
  while (room.state !== 'finished' && guard++ < 80) {
    if (room.state === 'countdown') { clearTimeout(room.timer); room.roundIntro(); }
    else if (room.state === 'intro') { clearTimeout(room.timer); room.beginPuzzle(0); clearTimeout(room.timer); room.clearReveals(); }
    else if (room.state === 'playing') {
      const snap = room.snapshot(a);
      assert(!snap.answers, 'in-play snapshot has no answer list');
      assert(!JSON.stringify(snap.puzzle).includes('"answer"'));
      const keys = room.puzzle().targets.map(t => t.key).join('');
      room.letters(a, keys, room.startsAt + 20);
      if (room.state === 'playing') room.endPuzzle('time');
    } else if (room.state === 'reveal') {
      sawReveal = true;
      const snap = room.snapshot(a);
      assert(snap.answers && snap.answers.length && snap.standings.length === 2);
      assert(!JSON.stringify(snap.puzzle).includes('"answer"'), 'the board is still the public puzzle');
      assert(snap.answers.every(x => x.answer), 'rejoin during the reveal can show the words');
      clearTimeout(room.timer); room.next(0);
    } else break;
  }
  assert(sawReveal);
  assert.equal(room.state, 'finished');
  assert.equal(guard < 80, true);
  const done = room.snapshot(a);
  assert(done.standings.length === 2 && done.standings[0].score >= done.standings[1].score);
  assert.equal(room.start(a), 'Already started.', 'refreshing on the final screen must not look like a lobby');
  room.backToLobby(a);
  assert.equal(room.state, 'lobby');
  assert(room.players.size === 2);
  assert.equal(room.start(a), null);
  clearTimeout(room.timer);
  room.destroy();
});

test('solo phase walks the table and will not skip the reveal', () => {
  const cfg = { countdownMs: 20, roundIntroMs: 20, roundIntroNextMs: 20, correctPauseMs: 20, failLeadMs: 10, failShowMs: 10, letterMs: 1, wordHoldMs: 1, revealGapMs: 1 };
  let seed = 3; const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const g = new E.Game(data, { rng, config: cfg });
  g.start();
  g.tick(cfg.countdownMs + 1); g.tick(cfg.roundIntroMs + 1);
  assert.equal(g.phase, 'playing');
  assert.throws(() => g._phase('finished'), /playing → finished/);
  assert.equal(g.phase, 'playing');
  let guard = 0;
  while (g.phase !== 'finished' && guard++ < 8000) {
    if (g.phase === 'playing') g.feed(g.unsolved().map(t => t.key).join(''));
    else g.tick(50);
  }
  assert.equal(g.phase, 'finished');
  const ps = new E.PuzzleState({ targets: [{ id: 0, answer: 'YELLOW', key: 'YEL' }], order: 'any' });
  assert.equal(ps.label(), 'ready');
  ps.feedLetter('Y', 0); assert.equal(ps.label(), 'buffering');
  ps.feedLetter('E', 0); ps.feedLetter('L', 0); assert.equal(ps.label(), 'complete');
  const bad = new E.PuzzleState({ targets: [{ id: 0, answer: 'YELLOW', key: 'YEL' }], order: 'any' });
  'QZX'.split('').forEach(c => bad.feedLetter(c, 0));
  assert.equal(bad.label(), 'failed');
});

function fakeNet(now) { return { serverNow: () => now, send() {}, offset: 0, synced: true }; }
function puzzleMsg(startsAt) {
  return { t: 'puzzle', round: { round: 1, title: 'One Word', category: 'C', instruction: 'I', count: 1 }, index: 0,
    puzzle: { kind: 'single', round: 1, targets: [{ id: 0, clue: 'yelwol', len: 6 }], base: 100, seconds: 12 },
    durationMs: 12000, startsAt: startsAt, endsAt: startsAt + 12000 };
}

test('remote game follows the server, and a late "game over" does not skip the reveal', () => {
  const { RemoteGame } = require('../js/net.js');
  const now = 8e6;
  const g = new RemoteGame(fakeNet(now), 'me');
  assert.equal(g.phase, 'countdown');
  g.handle({ t: 'countdown', endsAt: now + 4000 });
  g.handle({ t: 'roundIntro', round: 1, title: 'One Word', category: 'C', instruction: 'I' });
  assert.equal(g.phase, 'roundIntro');
  g.handle(puzzleMsg(now - 50));
  assert.equal(g.phase, 'playing'); assert.equal(g.myStatus, 'playing');
  g.handle({ t: 'finished', standings: [], maxScore: 1 });
  assert.equal(g.phase, 'playing', 'game over is only legal from the reveal');
  g.handle({ t: 'progress', players: [{ id: 'me', score: 0, status: 'playing' }] });
  g.handle({ t: 'wrong', chunk: 'QZX' });
  assert.equal(g.myStatus, 'out');
  g.handle({ t: 'puzzleEnd', reason: 'done', answers: [{ id: 0, answer: 'YELLOW' }], standings: [], results: [], revealMs: 1000, last: false });
  assert.equal(g.phase, 'feedback'); assert.equal(g.myStatus, 'out');
  g.handle({ t: 'roundIntro', round: 2, title: 'Three', category: 'C', instruction: 'I' });
  assert.equal(g.phase, 'roundIntro');
  g.handle(puzzleMsg(now - 50));
  g.handle({ t: 'progress', players: [{ id: 'me', score: 10, status: 'done' }] });
  assert.equal(g.myStatus, 'done', 'progress catches a missed solved message');
  g.handle({ t: 'puzzleEnd', reason: 'time', answers: [{ id: 0, answer: 'YELLOW' }], standings: [], results: [], revealMs: 1000, last: true });
  assert.equal(g.myStatus, 'done', 'already finished this puzzle: the buzzer does not relabel the seat');
  g.handle({ t: 'finished', standings: [{ id: 'me', score: 10 }], maxScore: 100 });
  assert.equal(g.phase, 'finished');

  const back = new RemoteGame(fakeNet(now), 'me');
  const ev = []; back.on(e => ev.push(e.type));
  back.resume({ state: 'countdown', countdownEndsAt: now + 2500, players: [{ id: 'me', score: 0, status: 'idle' }], round: { round: 1, title: 'T', category: 'C', instruction: 'I', count: 1 } });
  assert.equal(back.phase, 'countdown');
  assert(ev.includes('countdown'), 'rejoin shows the countdown that is still running');
  const mid = new RemoteGame(fakeNet(now), 'me');
  mid.resume({ state: 'playing', puzzleIndex: 0, durationMs: 12000, endsAt: now + 4000,
    round: puzzleMsg(now).round, puzzle: puzzleMsg(now).puzzle, reveals: [],
    players: [{ id: 'me', score: 40, status: 'done' }],
    mine: { status: 'done', buffer: 'AB', solved: [] } });
  assert.equal(mid.phase, 'playing'); assert.equal(mid.myStatus, 'done'); assert.equal(mid.score, 40);
  const over = new RemoteGame(fakeNet(now), 'me');
  over.resume({ state: 'finished', standings: [{ id: 'me', score: 40, rank: 1 }], players: [{ id: 'me', score: 40, status: 'idle' }] });
  assert.equal(over.phase, 'finished');
  const rev = new RemoteGame(fakeNet(now), 'me');
  rev.resume({ state: 'reveal', puzzleIndex: 0, durationMs: 12000, answers: [{ id: 0, answer: 'YELLOW' }],
    round: puzzleMsg(now).round, puzzle: puzzleMsg(now).puzzle, players: [{ id: 'me', score: 0, status: 'timeout' }] });
  assert.equal(rev.phase, 'feedback');
  assert.equal(rev.currentPuzzle().targets[0].answer, 'YELLOW');
});

function installFakeSocket() {
  function WS() {
    this.readyState = 0; this._closed = false;
    const self = this;
    process.nextTick(() => { if (self._closed) return; self.readyState = 1; if (self.onopen) self.onopen(); });
  }
  WS.prototype.send = function () {};
  WS.prototype.close = function () {
    if (this._closed) return;
    this._closed = true; this.readyState = 3;
    if (this.onclose) this.onclose({ code: 1000 });
  };
  global.WebSocket = WS;
  global.location = { protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', pathname: '/' };
  global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}

function socketTest() {
  installFakeSocket();
  const { Net } = require('../js/net.js');
  const net = new Net();
  assert.equal(net.status, 'idle');
  assert.equal(net._status('open'), false);
  assert.equal(net.status, 'idle');
  net.connect();
  assert.equal(net.status, 'connecting');
  return new Promise((res, rej) => {
    setTimeout(() => {
      try {
        assert.equal(net.status, 'open');
        net.close();
        assert.equal(net.status, 'closed');
        assert.equal(net._status('open'), false, 'a dead socket does not jump to open');
        n++; res();
      } catch (e) { try { net.close(); } catch (err) {} rej(e); }
    }, 40);
  });
}

function settle(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await socketTest();
  const room = new Room('RACE', data, { fast: true, rng: () => 0.2 });
  const a = room.addPlayer('Ann', () => {}).player, b = room.addPlayer('Bo', () => {}).player;
  room.start(a); clearTimeout(room.timer);
  room.roundIntro(); clearTimeout(room.timer);
  room.beginPuzzle(0); clearTimeout(room.timer); room.clearReveals();
  const keys = room.puzzle().targets.map(t => t.key).join('');
  room.letters(a, keys, room.startsAt + 10);
  assert.equal(a.status, 'done'); assert.equal(b.status, 'playing');
  room.disconnect(b);
  assert.equal(room.state, 'playing');
  room.reconnect(b.token, () => {});
  assert.equal(b.connected, true); assert.equal(b.status, 'playing');
  await settle(800);
  assert.equal(room.state, 'playing', 'a player who reconnects while the early-end is waiting is not cut off');
  room.destroy();

  const cut = new Room('CUTS', data, { fast: true, rng: () => 0.2 });
  const c = cut.addPlayer('Cy', () => {}).player, d = cut.addPlayer('Dee', () => {}).player;
  cut.start(c); clearTimeout(cut.timer); cut.roundIntro(); clearTimeout(cut.timer);
  cut.beginPuzzle(0); clearTimeout(cut.timer); cut.clearReveals();
  cut.letters(c, cut.puzzle().targets.map(t => t.key).join(''), cut.startsAt + 10);
  cut.disconnect(d);
  await settle(800);
  assert.equal(cut.state, 'reveal', 'if they stay gone, the puzzle still ends');
  cut.destroy();
  n++;
  console.log('machines tests passed (' + n + ' groups)');
})().catch(e => { console.error(e); process.exit(1); });
