// node tools/test-engine.js  -- engine v4 unit tests + content checks
const assert = require('assert');
const E = require('../js/engine.js');
const data = require('../data/puzzles.json');
let seed = 7; const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const C = E.CONFIG;
let n = 0; const test = (name, fn) => { fn(); n++; };

test('content rules', () => {
  data.rounds.forEach((r, ri) => {
    const total = r.sets.reduce((a, s) => a + s.items.length, 0);
    assert(total >= 8, `round ${ri + 1} needs >= 8 puzzles (has ${total})`);
    r.sets.forEach(s => {
      assert(s.items.length >= C.puzzlesPerRound);
      s.items.forEach(it => {
        if (ri === 0) assert(it.clue && E.normalize(it.answer).length >= 5, 'R1 answer 5+ letters: ' + it.answer);
        if (ri === 1) { assert(it.clue && it.answers.length === 3); it.answers.forEach(a => assert(E.normalize(a).length >= 5, 'R2 answer 5+: ' + a));
          assert.equal(new Set(it.answers.map(a => E.normalize(a).slice(0, 3))).size, 3, 'R2 boxes need different first 3 letters: ' + it.answers); }
        if (ri === 2) assert(/\[[^\]]+\]/.test(it.story));
        if (ri === 3) { const w = it.story.split(/\s+/).length; assert(w >= 10 && w <= 20, `R4 passage 10-20 words (${w}): ${it.story}`); }
      });
    });
  });
});

test('built puzzles: big words, stable anagram scrambles, sensible clocks', () => {
  for (let k = 0; k < 80; k++) E.buildPuzzles(data, rng).forEach(r => r.puzzles.forEach(p => {
    assert(p.targets.length >= (p.kind === 'multi' ? 3 : 1));
    p.targets.forEach(t => {
      assert(t.answer.length >= 4, 'no 3-letter puzzle words: ' + t.answer);
      if (t.style === 'missing') { assert.equal(t.clue.length, t.answer.length); t.clue.split('').forEach((c, i) => assert(c === '_' || c === t.answer[i])); }
      else { assert.equal(t.clue.toUpperCase().split('').sort().join(''), t.answer.split('').sort().join(''));
             if (t.answer.length >= 5) assert.notEqual(t.clue.toUpperCase().slice(0, 3), t.key, 'scramble must not start with the answer'); }
    });
    if (p.kind === 'story') assert(p.targets.length >= 2 && p.targets.length <= 6, p.story);
    if (p.kind === 'storyAll') { assert(p.targets.length >= 7, 'R4 should be a long passage: ' + p.story); assert.equal(p.order, 'sequence'); }
    if (p.kind === 'multi') assert.equal(p.order, 'any');
    assert(p.seconds >= 12 && p.seconds <= 50, 'clock ' + p.seconds);
    const pub = E.publicPuzzle(p); assert(!JSON.stringify(pub).includes('"answer"'), 'public puzzle leaks answers');
  }));
});

test('story parsing: short words plain, punctuation kept', () => {
  const t = []; const segs = E.parseStory('The [Statue of Liberty] was big.', 'story', 4, rng, t);
  assert.deepEqual(t.map(x => x.answer), ['STATUE', 'LIBERTY']);
  assert.equal(segs.map(s => s.text != null ? s.text : '#').join(''), 'The # of # was big.');
  const t2 = []; const s2 = E.parseStory('We packed sandwiches, maps and sunscreen.', 'storyAll', 4, rng, t2);
  assert.deepEqual(t2.map(x => x.answer), ['PACKED', 'SANDWICHES', 'MAPS', 'SUNSCREEN']);
  assert.equal(s2.map(s => s.text != null ? s.text : '#').join(''), 'We # #, # and #.');
});

function mk(puzzleSpec, cfg) {
  const t = []; let p;
  if (puzzleSpec.story) { const segs = E.parseStory(puzzleSpec.story, puzzleSpec.kind, 4, rng, t);
    p = { round: 3, kind: puzzleSpec.kind, segments: segs, targets: t, order: 'sequence', seconds: 30, base: 50 }; }
  else p = { round: 2, kind: 'multi', targets: puzzleSpec.answers.map((a, i) => ({ id: i, answer: a, key: a.slice(0, 3), clue: a, style: 'scramble' })), order: 'any', seconds: 30, base: 70 };
  const g = new E.Game(data, { rng, config: cfg, rounds: [{ round: p.round, title: 't', instruction: 'i', kind: p.kind, category: 'c', base: p.base, puzzles: [p] }] });
  g.start(); g.tick(C.countdownMs + 1); g.tick(C.roundIntroMs + 1); assert.equal(g.phase, 'playing');
  return g;
}

test('type-ahead: YELBLU solves YELLOW then BLUE in one burst', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); const ev = []; g.on(e => ev.push(e));
  const out = g.feed('YELBLU');
  assert.deepEqual(out.map(o => o.state), ['solved', 'solved']);
  assert.deepEqual(ev.filter(e => e.type === 'solved').map(e => e.target.answer), ['YELLOW', 'BLUE']);
  assert.equal(ev[1].queuedMs, g.fillMs(3) + C.wordHoldMs, 'second fill queues behind the first');
  assert.equal(g.phase, 'playing');
  g.feed('gre'); assert.equal(g.lastResult.status, 'correct');
});

test('type-ahead letter by letter while a fill is running (no dropped keystrokes)', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] });
  g.feed('Y'); g.feed('E'); g.feed('L'); assert(g.holdLeft > 0, 'filling');
  g.tick(50); g.feed('B'); g.tick(50); g.feed('L'); assert.equal(g.buffer(), 'BL'); g.feed('U');
  assert.equal(g.unsolved().map(t => t.answer).join(), 'GREEN');
  g.feed('GREEN'.slice(0, 3)); assert.equal(g.lastResult.status, 'correct'); assert.equal(g.lastResult.solved, 3);
});

test('any-order boxes; wrong chunk ends the turn and drops the rest', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] });
  const out = g.feed('GREXXXYEL');
  assert.deepEqual(out.map(o => o.state), ['solved', 'wrong']);
  assert.equal(g.lastResult.status, 'wrong'); assert.equal(g.lastResult.solved, 1);
  assert.equal(g.feed('YEL').length, 0, 'nothing accepted after the turn ends');
});

test('storybook: sequential order, fast typing through a whole passage', () => {
  const g = mk({ story: 'Snow fell all weekend, so the whole street held a giant snowball battle.', kind: 'storyAll' });
  const ans = g.unsolved().map(t => t.answer);
  assert.deepEqual(ans, ['SNOW', 'FELL', 'WEEKEND', 'WHOLE', 'STREET', 'HELD', 'GIANT', 'SNOWBALL', 'BATTLE']);
  const out = g.feed(ans.map(a => a.slice(0, 3)).join('').toLowerCase());
  assert.equal(out.length, 9); assert(out.every(o => o.state === 'solved'));
  assert.equal(g.lastResult.status, 'correct');
  // SNO matches SNOW (1st) and SNOWBALL (8th): sequence order decides
  const g2 = mk({ story: 'Snow fell all weekend, so the whole street held a giant snowball battle.', kind: 'storyAll' });
  assert.equal(g2.feed('FEL')[0].state, 'wrong', 'out-of-order word is wrong in a storybook');
});

test('clock pauses while fills are queued (solo) but not when pauseDuringFill=false', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] });
  const t0 = g.timeLeft; g.feed('YELBLU'); g.tick(g.holdLeft); assert.equal(g.timeLeft, t0); g.tick(1000); assert.equal(g.timeLeft, t0 - 1000);
  const h = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }, { pauseDuringFill: false });
  const t1 = h.timeLeft; h.feed('YEL'); h.tick(500); assert.equal(h.timeLeft, t1 - 500);
});

test('timeout reveals; feedback waits for queued fills', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); const ev = []; g.on(e => ev.push(e));
  g.feed('YEL'); const q = g.holdLeft; g.tick(q); g.tick(g.timeLeft + 1);
  const to = ev.find(e => e.type === 'timeout'); assert.deepEqual(to.reveal, [1, 2]);
  const g2 = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); g2.feed('YELBLUXXX');
  assert(g2.phaseLeft >= g2.fillMs(3) + g2.fillMs(1) + C.failLeadMs, 'reveal waits for queued fills');
});

test('backspace edits only the unjudged buffer', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] });
  g.feed('YE'); g.backspace(); g.feed('EL'); assert.equal(g.unsolved().length, 2);
});

test('speed scoring', () => {
  const a = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }), b = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] });
  a.feed('YEL'); b.tick(20000); b.feed('YEL'); assert(a.score > b.score && b.score >= 70);
  assert.equal(E.pointsFor(100, 1), 150); assert.equal(E.pointsFor(100, 0), 100);
});

test('full playthroughs (mixed outcomes, burst typing)', () => {
  for (let run = 0; run < 60; run++) {
    const g = new E.Game(data, { rng }); g.start(); let guard = 0;
    while (g.phase !== 'finished' && guard++ < 5000) {
      if (g.phase !== 'playing') { g.tick(700); continue; }
      const roll = rng();
      if (roll < 0.06) { g.tick(g.timeLeft + g.holdLeft + 1); continue; }
      if (roll < 0.1) { g.feed('QQQ'); continue; }
      const open = g.unsolved();
      const burst = (g.currentPuzzle().order === 'sequence' ? open : E.Game.prototype && open.slice().reverse()).slice(0, 1 + Math.floor(rng() * 3));
      g.feed(burst.map(t => t.key).join('')); g.tick(200);
    }
    const s = g.summary(); assert.equal(g.phase, 'finished'); assert.equal(s.played, 12);
    assert.equal(s.puzzlesSolved + s.timeouts + s.wrong, 12); assert(s.percent <= 100);
  }
});

test('perfect instant play ~ max; idle = 0', () => {
  const g = new E.Game(data, { rng }); g.start();
  while (g.phase !== 'finished') { if (g.phase === 'playing') g.feed(g.unsolved().map(t => t.key).join('')); else g.tick(700); }
  assert(g.summary().percent >= 99); assert.equal(g.summary().wordsSolved, g.summary().wordsTotal);
  const h = new E.Game(data, { rng }); h.start(); while (h.phase !== 'finished') h.tick(h.phase === 'playing' ? 1e6 : 700);
  assert.equal(h.score, 0); assert.equal(h.summary().timeouts, 12);
});

console.log(`engine tests passed (${n} groups)`);
