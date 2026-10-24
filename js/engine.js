/*
 * Scrambled Order - game engine, v5. Shared by the browser (solo play) and the
 * Node multiplayer server. Pure logic: no DOM, audio, network or timers of its own.
 *
 * Rules (from Evan's memory of the original):
 *  - Every puzzle has ONE clock; two birds walk the tightrope toward each other.
 *  - Type the FIRST THREE LETTERS of a word; if right, the rest auto-fills; if wrong, the turn ends.
 *  - Type-ahead: letters are buffered and judged in order, three at a time, so "YELBLU" solves
 *    YELLOW then BLUE even while YELLOW is still auto-filling on screen.
 *  - Round 2's boxes can be solved in any order; storybook rounds (3, 4) go word by word in order.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OOOEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // kind: single = clue + 1 word | multi = clue + 3 words (orange boxes, any order)
  //       story = sentence with [bracketed] phrases | storyAll = a passage, every long word scrambled
  // seconds = clock base; secondsPerWord added for each word after the first.
  var ROUND_DEFAULTS = {
    1: { kind: 'single',   seconds: 12, secondsPerWord: 0, base: 100, missingCount: 1, minLen: 4, title: 'One Word',
         instruction: 'TYPE IN THE FIRST THREE LETTERS' },
    2: { kind: 'multi',    seconds: 12, secondsPerWord: 3, base: 70,  missingCount: 0, minLen: 4, title: 'Three of a Kind',
         instruction: 'THREE ANSWERS, ANY ORDER: FIRST THREE LETTERS OF EACH' },
    3: { kind: 'story',    seconds: 10, secondsPerWord: 3, base: 50,  missingCount: 0, minLen: 4, title: 'Storybook',
         instruction: 'TYPE IN THE FIRST THREE LETTERS OF EACH WORD, IN ORDER' },
    4: { kind: 'storyAll', seconds: 10, secondsPerWord: 3, base: 40,  missingCount: 0, minLen: 4, title: 'The Whole Story',
         instruction: 'EVERY BIG WORD IS SCRAMBLED! SOLVE THEM ALL, IN ORDER' }
  };

  var CONFIG = {
    puzzlesPerRound: 3,
    countdownMs: 5000,
    roundIntroMs: 2800,
    letterMs: 140,         // auto-fill speed, one letter at a time
    wordHoldMs: 300,       // a finished word lingers in the typebox before the next fill starts
    pauseDuringFill: true, // solo: the clock waits while words auto-fill (multiplayer: false)
    correctPauseMs: 2200,
    failLeadMs: 1300,
    revealGapMs: 450,
    revealTailMs: 1500,
    speedBonusMax: 0.5,
    ranks: [
      { min: 0,  name: 'Scrambled Egg' }, { min: 12, name: 'Letter Shuffler' }, { min: 28, name: 'Word Juggler' },
      { min: 48, name: 'Anagram Ace' },   { min: 68, name: 'Puzzle Master' },   { min: 86, name: 'Grand Unscrambler' }
    ]
  };

  // ---- helpers ----------------------------------------------------------------------
  function normalize(s) {
    return String(s == null ? '' : s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '');
  }
  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function scrambleWord(w, rng) {
    var arr = w.split('');
    if (!arr.some(function (c) { return c !== arr[0]; })) return w;
    for (var n = 0; n < 60; n++) {
      var s = shuffled(arr, rng).join('');
      if (s !== w && (w.length < 5 || s.slice(0, 3) !== w.slice(0, 3))) return s;   // don't give away the answer
    }
    return arr.reverse().join('');
  }
  function blankWord(w, rng) {     // "CANADA" -> "C_NA__"
    var n = w.length; if (n < 4) return w;
    var k = Math.max(1, Math.min(n - 2, Math.round(n * 0.45))), idx = [];
    for (var i = 1; i < n; i++) idx.push(i);
    var pick = {}; shuffled(idx, rng).slice(0, k).forEach(function (i) { pick[i] = true; });
    return w.split('').map(function (c, i) { return pick[i] ? '_' : c; }).join('');
  }
  function keyOf(word) { return word.slice(0, 3); }
  function pointsFor(base, frac, cfg) {
    frac = Math.max(0, Math.min(1, frac));
    return Math.round((base + base * (cfg || CONFIG).speedBonusMax * frac) / 5) * 5;
  }

  // Split a story into segments: {text} kept as-is, {t: targetId} scrambled. In 'story', words
  // inside [brackets] are targets; in 'storyAll', every word. Either way only words with >= minLen
  // letters are scrambled; shorter ones are shown plainly.
  function parseStory(story, kind, minLen, rng, targets) {
    var segs = [], group = 0;
    function pushWords(text, scramble) {
      text.split(/(\s+)/).forEach(function (tok) {
        if (!tok) return;
        var core = tok.match(/[A-Za-z]+(?:'[A-Za-z]+)?/);
        if (!scramble || !core || normalize(core[0]).length < minLen) { segs.push({ text: tok }); return; }
        var pre = tok.slice(0, core.index), post = tok.slice(core.index + core[0].length);
        if (pre) segs.push({ text: pre });
        var ans = normalize(core[0]);
        var t = { id: targets.length, answer: ans, key: keyOf(ans), clue: scrambleWord(ans, rng).toLowerCase(), group: group, style: 'scramble' };
        targets.push(t); segs.push({ t: t.id });
        if (post) segs.push({ text: post });
        if (kind === 'storyAll') group++;
      });
    }
    if (kind === 'story') {
      var re = /\[([^\]]+)\]/g, last = 0, m;
      while ((m = re.exec(story))) {
        if (m.index > last) pushWords(story.slice(last, m.index), false);
        pushWords(m[1], true); group++; last = re.lastIndex;
      }
      if (last < story.length) pushWords(story.slice(last), false);
    } else pushWords(story, true);
    return segs;
  }

  function makePuzzle(item, rc, category, rng, missing) {
    var targets = [], segments = null;
    if (rc.kind === 'single' || rc.kind === 'multi') {
      (item.answers || [item.answer]).forEach(function (a, i) {
        var ans = normalize(a);
        targets.push({ id: i, answer: ans, key: keyOf(ans), group: i, style: missing ? 'missing' : 'scramble',
          clue: missing ? blankWord(ans, rng) : scrambleWord(ans, rng) });
      });
    } else segments = parseStory(item.story, rc.kind, rc.minLen || 4, rng, targets);
    return { round: rc.round, kind: rc.kind, category: category, clue: item.clue || '', story: item.story || null,
             segments: segments, targets: targets, missing: !!missing,
             order: (rc.kind === 'story' || rc.kind === 'storyAll') ? 'sequence' : 'any',
             seconds: item.seconds || (rc.seconds + rc.secondsPerWord * Math.max(0, targets.length - 1)), base: rc.base };
  }

  // What a client may see before solving: no answers.
  function publicPuzzle(p) {
    return { round: p.round, kind: p.kind, category: p.category, clue: p.clue, segments: p.segments, missing: p.missing,
             order: p.order, seconds: p.seconds, base: p.base,
             targets: p.targets.map(function (t) { return { id: t.id, clue: t.clue, style: t.style, group: t.group, len: t.answer.length }; }) };
  }

  function roundConfig(data, i) {
    var r = (data.rounds && data.rounds[i]) || {}, d = ROUND_DEFAULTS[i + 1] || ROUND_DEFAULTS[4];
    var o = { round: i + 1, sets: r.sets || [] };
    Object.keys(d).forEach(function (k) { o[k] = r[k] != null ? r[k] : d[k]; });
    return o;
  }
  function buildPuzzles(data, rng, cfg) {
    cfg = cfg || CONFIG; rng = rng || Math.random;
    if (!data || !data.rounds || !data.rounds.length) throw new Error('puzzle data has no rounds');
    var rounds = [];
    for (var i = 0; i < data.rounds.length; i++) {
      var rc = roundConfig(data, i);
      var usable = rc.sets.filter(function (s) { return s.items && s.items.length >= cfg.puzzlesPerRound; });
      if (!usable.length) throw new Error('round ' + (i + 1) + ' needs a set with at least ' + cfg.puzzlesPerRound + ' items');
      var set = usable[Math.floor(rng() * usable.length)];
      var items = shuffled(set.items, rng).slice(0, cfg.puzzlesPerRound);
      var miss = {}; shuffled(items.map(function (_, k) { return k; }), rng).slice(0, rc.missingCount).forEach(function (k) { miss[k] = true; });
      rounds.push({ round: rc.round, title: rc.title, instruction: rc.instruction, kind: rc.kind, category: set.category, base: rc.base,
        puzzles: items.map(function (it, k) { return makePuzzle(it, rc, set.category, rng, miss[k] || it.clueStyle === 'missing'); }) });
    }
    return rounds;
  }

  // ---- one player's attempt at one puzzle (used by solo Game and by the server, per player) ----
  // Letters go in one at a time; every 3rd buffered letter is judged against the next unsolved
  // word (order 'sequence') or any unsolved word (order 'any').
  function PuzzleState(puzzle) {
    this.puzzle = puzzle; this.solved = {}; this.buffer = ''; this.failed = false; this.letters = 0;
  }
  PuzzleState.prototype.unsolved = function () {
    var s = this.solved; return this.puzzle.targets.filter(function (t) { return !s[t.id]; });
  };
  PuzzleState.prototype.next = function () { return this.unsolved()[0] || null; };
  PuzzleState.prototype.done = function () { return this.failed || this.unsolved().length === 0; };
  // returns null (still buffering), {ok:true, target} or {ok:false, chunk}
  PuzzleState.prototype.feedLetter = function (c) {
    if (this.done()) return { ignored: true };
    c = normalize(c); if (!c) return null;
    this.buffer += c[0]; this.letters++;
    if (this.buffer.length < 3) return null;
    var chunk = this.buffer; this.buffer = '';
    var open = this.unsolved(), target = null;
    if (this.puzzle.order === 'sequence') { if (open[0] && open[0].key === chunk) target = open[0]; }
    else target = open.filter(function (t) { return t.key === chunk; })[0] || null;
    if (!target) { this.failed = true; return { ok: false, chunk: chunk }; }
    this.solved[target.id] = true;
    return { ok: true, target: target };
  };
  PuzzleState.prototype.backspace = function () { if (this.buffer) this.buffer = this.buffer.slice(0, -1); return this.buffer; };

  // ---- solo game ---------------------------------------------------------------------
  function Game(data, opts) {
    opts = opts || {};
    this.cfg = Object.assign({}, CONFIG, opts.config || {});
    this.rng = opts.rng || Math.random;
    this.rounds = opts.rounds || buildPuzzles(data, this.rng, this.cfg);
    this.listeners = []; this.reset();
  }
  Game.prototype.on = function (fn) { this.listeners.push(fn); return this; };
  Game.prototype._emit = function (type, extra) {
    var ev = Object.assign({ type: type }, extra || {});
    this.listeners.forEach(function (fn) { fn(ev, this); }, this);
  };
  Game.prototype.reset = function () {
    this.phase = 'idle'; this.score = 0; this.roundIdx = 0; this.puzzleIdx = 0;
    this.phaseLeft = 0; this.timeLeft = 0; this.timeTotal = 0; this.holdLeft = 0;
    this.attempt = null; this.lastResult = null; this.results = []; this._lastSec = null; this.paused = false; this._pts = 0;
  };
  Game.prototype.start = function () {
    this.reset(); this.phase = 'countdown'; this.phaseLeft = this.cfg.countdownMs;
    this._emit('countdown', { seconds: Math.ceil(this.phaseLeft / 1000) });
  };
  Game.prototype.currentRound = function () { return this.rounds[this.roundIdx]; };
  Game.prototype.currentPuzzle = function () { var r = this.currentRound(); return r ? r.puzzles[this.puzzleIdx] : null; };
  Game.prototype.unsolved = function () { return this.attempt ? this.attempt.unsolved() : []; };
  Game.prototype.fillMs = function (letters) { return letters * this.cfg.letterMs; };
  Game.prototype.revealMs = function (targets) {
    var self = this; return targets.reduce(function (a, t) { return a + self.fillMs(t.answer.length) + self.cfg.revealGapMs; }, 0);
  };
  Game.prototype._beginRoundIntro = function () {
    this.phase = 'roundIntro'; this.phaseLeft = this.cfg.roundIntroMs;
    var r = this.currentRound();
    this._emit('roundIntro', { round: r.round, title: r.title, category: r.category, instruction: r.instruction });
  };
  Game.prototype._beginPuzzle = function () {
    var p = this.currentPuzzle();
    this.attempt = new PuzzleState(p);
    this.phase = 'playing'; this.holdLeft = 0; this._pts = 0;
    this.timeTotal = this.timeLeft = p.seconds * 1000; this._lastSec = Math.ceil(this.timeLeft / 1000);
    this._emit('puzzle', { puzzle: p, index: this.puzzleIdx, count: this.currentRound().puzzles.length });
  };
  Game.prototype._endPuzzle = function (status, extra) {
    var p = this.currentPuzzle(), unsolved = this.unsolved();
    var res = Object.assign({ round: p.round, index: this.puzzleIdx, status: status, solved: p.targets.length - unsolved.length,
      total: p.targets.length, points: this._pts, answers: p.targets.map(function (t) { return t.answer; }),
      secondsUsed: +((this.timeTotal - this.timeLeft) / 1000).toFixed(2) }, extra || {});
    this.results.push(res); this.lastResult = res; this.phase = 'feedback';
    var queued = this.holdLeft; this.holdLeft = 0;      // fills already queued on screen still play out
    this.phaseLeft = queued + (status === 'correct' ? this.cfg.correctPauseMs
      : this.cfg.failLeadMs + this.revealMs(unsolved) + this.cfg.revealTailMs);
    return { reveal: unsolved.map(function (t) { return t.id; }), queuedMs: queued };
  };
  Game.prototype._advance = function () {
    var r = this.currentRound();
    if (this.puzzleIdx + 1 < r.puzzles.length) { this.puzzleIdx++; this._beginPuzzle(); return; }
    if (this.roundIdx + 1 < this.rounds.length) { this._emit('roundEnd', { round: r.round }); this.roundIdx++; this.puzzleIdx = 0; this._beginRoundIntro(); return; }
    this.phase = 'finished'; this._emit('finished', { summary: this.summary() });
  };
  Game.prototype.setPaused = function (p) { this.paused = !!p; };
  Game.prototype.tick = function (ms) {
    if (ms <= 0 || this.paused) return;
    var ph = this.phase;
    if (ph === 'countdown') {
      this.phaseLeft -= ms;
      var s = Math.max(0, Math.ceil(this.phaseLeft / 1000));
      if (s !== this._lastSec) { this._lastSec = s; if (s > 0) this._emit('countdown', { seconds: s }); }
      if (this.phaseLeft <= 0) { this.roundIdx = 0; this.puzzleIdx = 0; this._beginRoundIntro(); }
    } else if (ph === 'roundIntro') {
      this.phaseLeft -= ms; if (this.phaseLeft <= 0) this._beginPuzzle();
    } else if (ph === 'playing') {
      if (this.holdLeft > 0) {
        var use = Math.min(ms, this.holdLeft); this.holdLeft -= use;
        if (this.cfg.pauseDuringFill) ms -= use;
        if (ms <= 0) return;
      }
      this.timeLeft -= ms;
      var sec = Math.max(0, Math.ceil(this.timeLeft / 1000));
      if (sec !== this._lastSec) { this._lastSec = sec; if (sec > 0) this._emit('second', { seconds: sec }); }
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._emit('timeout', this._endPuzzle('timeout')); }
    } else if (ph === 'feedback') {
      this.phaseLeft -= ms; if (this.phaseLeft <= 0) this._advance();
    }
  };
  // Feed typed letters (any length; buffered and judged three at a time, in order).
  Game.prototype.feed = function (text) {
    var out = [], letters = normalize(text);
    for (var i = 0; i < letters.length; i++) {
      if (this.phase !== 'playing' || this.paused) break;
      var r = this.attempt.feedLetter(letters[i]);
      if (!r || r.ignored) continue;
      if (r.ok) {
        var t = r.target, p = this.currentPuzzle();
        var pts = pointsFor(p.base, this.timeLeft / this.timeTotal, this.cfg);
        this.score += pts; this._pts += pts;
        var fill = this.fillMs(t.answer.length - 3), done = this.unsolved().length === 0;
        var queuedBefore = this.holdLeft;
        this.holdLeft += fill + this.cfg.wordHoldMs;
        this._emit('solved', { target: t, typed: 3, points: pts, score: this.score, fillMs: fill, last: done, queuedMs: queuedBefore });
        out.push({ state: 'solved', target: t.id, points: pts });
        if (done) { this._endPuzzle('correct'); this._emit('puzzleSolved', { result: this.lastResult }); break; }
      } else {
        var info = this._endPuzzle('wrong', { typed: r.chunk });
        this._emit('wrong', Object.assign({ chunk: r.chunk }, info));
        out.push({ state: 'wrong', chunk: r.chunk }); break;
      }
    }
    return out;
  };
  Game.prototype.backspace = function () { return this.attempt && this.phase === 'playing' ? this.attempt.backspace() : ''; };
  Game.prototype.buffer = function () { return this.attempt ? this.attempt.buffer : ''; };
  Game.prototype.maxScore = function () {
    var c = this.cfg, t = 0;
    this.rounds.forEach(function (r) { r.puzzles.forEach(function (p) { t += p.targets.length * pointsFor(p.base, 1, c); }); });
    return t;
  };
  Game.prototype.rankFor = function (pct) { return rankFor(pct, this.cfg); };
  function rankFor(pct, cfg) {
    var name = (cfg || CONFIG).ranks[0].name;
    (cfg || CONFIG).ranks.forEach(function (r) { if (pct >= r.min) name = r.name; });
    return name;
  }
  function maxScoreOf(rounds, cfg) {
    var t = 0; rounds.forEach(function (r) { r.puzzles.forEach(function (p) { t += p.targets.length * pointsFor(p.base, 1, cfg); }); }); return t;
  }
  Game.prototype.summary = function () {
    var max = this.maxScore(), pct = max ? Math.round(100 * this.score / max) : 0, R = this.results;
    function count(s) { return R.filter(function (x) { return x.status === s; }).length; }
    return { score: this.score, maxScore: max, percent: pct, rank: this.rankFor(pct),
      puzzlesSolved: count('correct'), timeouts: count('timeout'), wrong: count('wrong'), played: R.length,
      wordsSolved: R.reduce(function (a, x) { return a + x.solved; }, 0), wordsTotal: R.reduce(function (a, x) { return a + x.total; }, 0) };
  };

  return { Game: Game, PuzzleState: PuzzleState, buildPuzzles: buildPuzzles, publicPuzzle: publicPuzzle, pointsFor: pointsFor,
           rankFor: rankFor, maxScoreOf: maxScoreOf, normalize: normalize, scrambleWord: scrambleWord, blankWord: blankWord,
           parseStory: parseStory, CONFIG: CONFIG, ROUND_DEFAULTS: ROUND_DEFAULTS };
});
