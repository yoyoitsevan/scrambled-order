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
        if (ri === 3) { const w = it.story.split(/\s+/).length; assert(w >= 10 && w <= 20, `R4 passage 10-20 words (${w}): ${it.story}`);
          if (it.author) { const keys = [it.author].concat(it.choices).map(n => E.normalize(n).slice(0, 3));
            assert.equal(it.choices.length, 2, 'two decoys: ' + it.author); assert.equal(new Set(keys).size, 3, 'author choices need different first 3 letters: ' + keys); } }
      });
    });
  });
});

test('built puzzles: big words, stable anagram scrambles, sensible clocks', () => {
  for (let k = 0; k < 80; k++) E.buildPuzzles(data, rng).forEach(r => r.puzzles.forEach(p => {
    assert(p.targets.length >= (p.kind === 'multi' ? 3 : 1));
    p.targets.forEach(t => {
      assert(t.answer.length >= 4, 'no 3-letter puzzle words: ' + t.answer);
      if (t.style === 'choice') { assert.equal(t.clue, ''); assert(p.choices.map(E.normalize).includes(t.answer)); }
      else if (t.style === 'missing') { assert.equal(t.clue.length, t.answer.length); t.clue.split('').forEach((c, i) => assert(c === '_' || c === t.answer[i])); }
      else { assert.equal(t.clue.toUpperCase().split('').sort().join(''), t.answer.split('').sort().join(''));
             if (t.answer.length >= 5) assert.notEqual(t.clue.toUpperCase().slice(0, 3), t.key, 'scramble must not start with the answer'); }
    });
    if (p.kind === 'story') assert(p.targets.length >= 2 && p.targets.length <= 6, p.story);
    if (p.kind === 'choice') { assert.equal(p.choices.length, 3); assert(p.quote && !/[\[\]]/.test(p.quote)); assert.equal(p.round, 4); }
    if (p.kind === 'storyAll') { assert(p.targets.length >= 5, 'R4 should be a long passage: ' + p.story); assert.equal(p.order, 'any'); }
    assert.equal(p.order, 'any', 'every round accepts words in any order');
    assert(p.seconds >= 12 && p.seconds <= 50, 'clock ' + p.seconds);
    const pub = E.publicPuzzle(p); assert(!JSON.stringify(pub).includes('"answer"'), 'public puzzle leaks answers');
  }));
});

test('story parsing: short words plain, punctuation kept', () => {
  const t = []; const segs = E.parseStory('The [Statue of Liberty] was big.', 'story', 4, rng, t);
  assert.deepEqual(t.map(x => x.answer), ['STATUE', 'LIBERTY']);
  assert.equal(segs.map(s => s.text != null ? s.text : '#').join(''), 'The # of # was big.');
  const t2 = []; const s2 = E.parseStory('We packed sandwiches, maps and sunscreen.', 'storyAll', 4, rng, t2, { given: [] });
  assert.deepEqual(t2.map(x => x.answer), ['PACKED', 'SANDWICHES', 'MAPS', 'SUNSCREEN']);
  assert.equal(s2.map(s => s.text != null ? s.text : '#').join(''), 'We # #, # and #.');
});

function mk(puzzleSpec, cfg) {
  const t = []; let p;
  if (puzzleSpec.story) { const segs = E.parseStory(puzzleSpec.story, puzzleSpec.kind, 4, rng, t, puzzleSpec.item || { given: [] });
    p = { round: 3, kind: puzzleSpec.kind, segments: segs, targets: t, order: 'any', seconds: puzzleSpec.seconds || 30, base: 50 }; }
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

test('storybook: fast typing through a whole passage', () => {
  const g = mk({ story: 'Snow fell all weekend, so the whole street held a giant snowball battle.', kind: 'storyAll' });
  const ans = g.unsolved().map(t => t.answer);
  assert.deepEqual(ans, ['SNOW', 'FELL', 'WEEKEND', 'WHOLE', 'STREET', 'HELD', 'GIANT', 'SNOWBALL', 'BATTLE']);
  const out = g.feed(ans.map(a => a.slice(0, 3)).join('').toLowerCase());
  assert.equal(out.length, 9); assert(out.every(o => o.state === 'solved'));
  assert.equal(g.lastResult.status, 'correct');
  // any order is fine; SNO matches SNOW (1st) and SNOWBALL (8th): the earliest unsolved word is solved
  const g2 = mk({ story: 'Snow fell all weekend, so the whole street held a giant snowball battle.', kind: 'storyAll' });
  assert.equal(g2.feed('FEL')[0].state, 'solved', 'a later word typed first is accepted in a storybook');
  assert.equal(g2.currentPuzzle().targets[g2.feed('SNO')[0].target].answer, 'SNOW', 'duplicate key: earliest unsolved word first');
  assert.equal(g2.currentPuzzle().targets[g2.feed('SNO')[0].target].answer, 'SNOWBALL', 'then the next one with that key');
  assert.equal(g2.phase, 'playing'); assert.equal(g2.feed('QZX')[0].state, 'wrong', 'a key no word has is still wrong');
});

test('regression: WAT solves WATER first in "A [rainbow] appears when [sunlight] shines through tiny [water droplets]."', () => {
  const story = 'A [rainbow] appears when [sunlight] shines through tiny [water droplets].';
  const rc = Object.assign(E.roundConfig(data, 2), { kind: 'story' });
  const pz = E.makePuzzle({ story }, rc, 'Science', rng, false);
  assert.equal(pz.order, 'any');
  assert.deepEqual(pz.targets.map(t => t.answer), ['RAINBOW', 'SUNLIGHT', 'WATER', 'DROPLETS']);
  // the exact path the multiplayer server uses (server/room.js feeds PuzzleState letter by letter)
  const ps = new E.PuzzleState(pz);
  assert.equal(ps.feedLetter('w'), null); assert.equal(ps.feedLetter('a'), null);
  const r = ps.feedLetter('t'); assert(r.ok, 'WAT must not end the turn'); assert.equal(r.target.answer, 'WATER');
  ['dro', 'sun', 'rai'].join('').split('').forEach(c => ps.feedLetter(c));
  assert(ps.done() && !ps.failed, 'all four solved in a different order');
  // solo game with type-ahead in reverse order
  const g = mk({ story, kind: 'story' }); const out = g.feed('watdrosunrai');
  assert.deepEqual(out.map(o => o.state), ['solved', 'solved', 'solved', 'solved']); assert.equal(g.lastResult.status, 'correct');
});

test('puzzle data: no correct three-letter prefix can be rejected', () => {
  for (let k = 0; k < 40; k++) E.buildPuzzles(data, rng).forEach(r => r.puzzles.forEach(p => {
    // every target's own key, typed first, must be accepted (any order), for every target
    p.targets.forEach(t => { const ps = new E.PuzzleState(p);
      const out = t.key.split('').map(c => ps.feedLetter(c)).pop(); assert(out && out.ok, p.story || p.clue); });
    p.targets.forEach(t => assert(/^[A-Z]{4,}$/.test(t.answer) && t.key === t.answer.slice(0, 3), 'clean answer ' + t.answer));
  }));
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
  assert.equal(E.pointsFor(100, 1), 150); assert.equal(E.pointsFor(100, 0), 40);
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
      const burst = (rng() < 0.5 ? open : open.slice().reverse()).slice(0, 1 + Math.floor(rng() * 3));
      g.feed(burst.map(t => t.key).join('')); g.tick(200);
    }
    const total = g.rounds.reduce((a, r) => a + r.puzzles.length, 0);
    const s = g.summary(); assert.equal(g.phase, 'finished'); assert.equal(s.played, total); assert(total >= 12 && total <= 15);
    assert.equal(s.puzzlesSolved + s.timeouts + s.wrong, total); assert(s.percent <= 100);
  }
});

test('perfect instant play ~ max; idle = 0', () => {
  const g = new E.Game(data, { rng }); g.start();
  while (g.phase !== 'finished') { if (g.phase === 'playing') g.feed(g.unsolved().map(t => t.key).join('')); else g.tick(700); }
  assert(g.summary().percent >= 99); assert.equal(g.summary().wordsSolved, g.summary().wordsTotal);
  const h = new E.Game(data, { rng }); h.start(); while (h.phase !== 'finished') h.tick(h.phase === 'playing' ? 1e6 : 700);
  assert.equal(h.score, 0); assert.equal(h.summary().timeouts, h.summary().played);
});

test('failed puzzle: words are shown unscrambled for failShowMs (no typed reveal), then the next puzzle', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); const ev = []; g.on(e => ev.push(e));
  g.tick(g.timeLeft + 1); assert.equal(g.phase, 'feedback');
  assert.equal(g.phaseLeft, C.failLeadMs + C.failShowMs, 'fixed hold, not a typing animation per letter');
  const h = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); h.feed('QZX'); assert.equal(h.phaseLeft, C.failLeadMs + C.failShowMs);
});

test('round 4 quotes: a "who said it?" pick follows, judged like any word', () => {
  const quotes = data.rounds[3].sets.find(s => s.items.some(i => i.author));
  assert(quotes, 'a quotes set exists');
  const rc = E.roundConfig(data, 3), it = quotes.items[0];
  const ch = E.makeChoicePuzzle(it, rc, rng);
  assert.equal(ch.kind, 'choice'); assert.equal(ch.choices.length, 3); assert(ch.choices.includes(it.author));
  assert.deepEqual(E.revealTimes(ch), [], 'no auto-reveal on a pick');
  const pub = E.publicPuzzle(ch); assert(!JSON.stringify(pub).includes('"answer"')); assert.equal(pub.targets[0].clue, '');
  assert.deepEqual(pub.choices, ch.choices);
  const ps = new E.PuzzleState(ch), key = E.normalize(it.author).slice(0, 3);
  assert(key.split('').map(c => ps.feedLetter(c)).pop().ok);
  const wrongName = ch.choices.find(c => c !== it.author), ps2 = new E.PuzzleState(ch);
  assert.equal(E.normalize(wrongName).slice(0, 3).split('').map(c => ps2.feedLetter(c)).pop().ok, false, 'a decoy ends the turn');
  // built rounds: the pick sits right after its quote
  const one = Object.assign({}, data, { rounds: data.rounds.map((r, i) => i === 3 ? Object.assign({}, r, { sets: [quotes] }) : r) });
  const r4 = E.buildPuzzles(one, rng)[3];
  assert.equal(r4.puzzles.length, 6); r4.puzzles.forEach((p, i) => assert.equal(p.kind, i % 2 ? 'choice' : 'storyAll'));
  assert.equal(r4.puzzles[1].quote, r4.puzzles[0].story);
});

const SNOW = 'Snow fell all weekend, so the whole street held a giant snowball battle.';
test('point decay: full value for the first half of the clock, then steadily down to 25% at the buzzer', () => {
  assert.equal(E.pointsFor(100, 1), 150); assert.equal(E.pointsFor(100, 0.5), 150);
  assert.equal(E.pointsFor(100, 0.25), 95); assert.equal(E.pointsFor(100, 0), 40); assert.equal(E.pointsFor(40, 0), 15);
  let prev = 1e9; for (let f = 1; f >= 0; f -= 0.01) { const v = E.pointsFor(100, f); assert(v <= prev); prev = v; }
  // the max score is unchanged: every word is worth base * 1.5 early on
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); assert.equal(g.pointsNow().points, 105); assert.equal(g.pointsNow().frozen, false);
  g.tick(21000); assert.equal(g.pointsNow().points, E.pointsFor(70, 0.3));
});

test('a started answer freezes its value until it is awarded (capped at freezeMaxMs)', () => {
  const g = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); g.tick(21000);   // 30% of the clock left
  const v = g.pointsNow().points; g.feed('Y'); assert(g.pointsNow().frozen);
  g.tick(2000); assert.equal(g.pointsNow().points, v, 'frozen while typing'); g.feed('EL');
  assert.equal(g.score, v, 'the frozen value is what is awarded');
  assert.equal(g.pointsNow().frozen, false); g.tick(g.holdLeft);
  const live = g.pointsNow().points; g.feed('B'); g.tick(1500); g.backspace(); assert.equal(g.pointsNow().frozen, false, 'abandoned: unfrozen');
  assert(g.pointsNow().points < live);
  // a lone letter can't hold the value forever
  const h = mk({ answers: ['YELLOW', 'BLUE', 'GREEN'] }); h.tick(15000); h.feed('Y'); h.tick(9000); h.feed('EL');
  assert.equal(h.score, E.pointsFor(70, 1 - (24000 - C.freezeMaxMs) / 30000));
});

test('auto-unscramble: storybooks only, evenly spaced from 40% to 90%, never the last two words', () => {
  assert.deepEqual(E.revealTimes({ kind: 'multi', targets: [1, 2, 3] }), [], 'round 2 never reveals');
  assert.deepEqual(E.revealTimes({ kind: 'single', targets: [1] }), []);
  assert.deepEqual(E.revealTimes({ kind: 'story', targets: [1, 2] }), [], 'two words: nothing to spare');
  assert.deepEqual(E.revealTimes({ kind: 'story', targets: [1, 2, 3] }), [0.4]);
  assert.deepEqual(E.revealTimes({ kind: 'storyAll', targets: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).map(x => +x.toFixed(3)), [0.4, 0.65, 0.9]);
  const g = mk({ story: SNOW, kind: 'storyAll' }); const ev = []; g.on(e => ev.push(e));
  g.tick(11999); assert.equal(ev.filter(e => e.type === 'reveal').length, 0); g.tick(2);
  const r1 = ev.find(e => e.type === 'reveal'); assert(r1 && r1.answer === r1.target.answer);
  assert(!g.unsolved().some(t => t.id === r1.id), 'a revealed word no longer needs typing');
  if (!g.unsolved().some(t => t.key === r1.target.key)) {
    const out = g.feed(r1.target.key); assert.equal(out[0].state, 'skipped', 'typing a revealed word is not a mistake');
  }
  assert.equal(g.phase, 'playing'); assert.equal(g.score, 0, 'reveals score nothing');
  g.tick(30000 * 0.25); assert.equal(ev.filter(e => e.type === 'reveal').length, 2);
  g.feed(g.unsolved().map(t => t.key).join('')); assert.equal(g.lastResult.status, 'correct');
  assert.equal(g.lastResult.solved, 9 - 2); assert.equal(g.lastResult.revealed, 2);
  // never reveals a player's last two words
  const h = mk({ story: SNOW, kind: 'storyAll' }); const hv = []; h.on(e => hv.push(e));
  h.feed(h.unsolved().slice(0, 7).map(t => t.key).join('')); h.tick(h.holdLeft); h.tick(29000);
  assert.equal(hv.filter(e => e.type === 'reveal').length, 0); assert.equal(h.unsolved().length, 2);
});

test('reveals are time-based: a word typed before its reveal time still counts', () => {
  const rc = Object.assign(E.roundConfig(data, 3), { kind: 'storyAll' });
  const pz = E.makePuzzle({ story: SNOW, given: [] }, rc, 'x', rng, false);
  const rv = {}, a = new E.PuzzleState(pz, rv), b = new E.PuzzleState(pz, rv);
  const w = pz.targets.find(t => t.answer === 'STREET'); rv[w.id] = 1000;
  'STR'.split('').forEach((c, i) => a.feedLetter(c, 900 + i)); assert(a.solved[w.id], 'typed (stamped) before the reveal');
  const r = 'STR'.split('').map((c, i) => b.feedLetter(c, 1100 + i)).pop(); assert(r.given && !b.failed && !b.solved[w.id]);
  assert.equal(E.pickReveal(pz, [a, b], rv) != null, true);
  assert.equal(pz.revealOrder.length, pz.targets.length);
});

test('round 4 key words: data lists ~30% given; the fallback picks content words', () => {
  data.rounds[3].sets.forEach(s => s.items.forEach(it => {
    const t = [], segs = E.parseStory(it.story, 'storyAll', 4, rng, t, it), g = segs.filter(x => x.given).map(x => E.normalize(x.text));
    assert.equal(g.length, it.given.length, 'every listed key word appears: ' + it.story);
    const share = g.length / (g.length + t.length); assert(g.length >= 2 && share >= 0.25 && share <= 0.35, it.story);
    t.forEach(x => assert(!g.includes(x.answer)));
    const auto = [], as = E.parseStory(it.story, 'storyAll', 4, rng, auto, {}), ag = as.filter(x => x.given);
    assert(ag.length >= 2 && ag.length / (ag.length + auto.length) <= 0.45 && auto.length >= 4, 'auto key words: ' + it.story);
    ag.forEach(x => assert(!['THAT', 'WITH', 'THEN', 'UNTIL', 'OVER', 'WHILE', 'ONCE'].includes(E.normalize(x.text))));
  }));
  const st = []; E.parseStory('In 1969, [Neil Armstrong] walked on the [Moon].', 'story', 4, rng, st, {}); assert.equal(st.length, 3, 'round 3 unchanged');
});

console.log(`engine tests passed (${n} groups)`);
