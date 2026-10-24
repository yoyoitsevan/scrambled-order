// node tools/test-server.js -- multiplayer server tests (in-process server, real WebSockets)
const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');

function client(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws'); const msgs = []; const waiters = [];
  ws.on('message', raw => { const m = JSON.parse(raw); msgs.push(m); waiters.slice().forEach(w => { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } }); });
  const c = {
    ws, msgs, send: m => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 8000) => new Promise((res, rej) => {
      const hit = msgs.find(pred); if (hit) { msgs.splice(msgs.indexOf(hit), 1); return res(hit); }
      const w = { pred, res: m => { clearTimeout(w.to); msgs.splice(msgs.indexOf(m), 1); res(m); } };
      w.to = setTimeout(() => rej(new Error('timeout waiting; last msgs: ' + JSON.stringify(msgs.slice(-3)).slice(0, 400))), ms);
      waiters.push(w);
    }),
    open: () => new Promise(r => ws.on('open', r)), close: () => ws.close()
  };
  return c;
}
const type = t => m => m.t === t;

(async () => {
  const { server, rooms } = createServer({ emptyRoomMs: 500 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  // --- static + health
  const res = await fetch('http://127.0.0.1:' + port + '/healthz'); assert((await res.json()).ok);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/')).status, 200);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/server/room.js')).status, 404, 'server code is not served');
  // public profile: nothing from the private classic/ folder is reachable
  for (const u of ['/classic/profile.js', '/classic/assets/snd/theme.wav', '/assets/img/logo.gif', '/assets/snd/theme.wav'])
    assert.equal((await fetch('http://127.0.0.1:' + port + u)).status, 404, u + ' must not be served by the public build');
  assert.match(await (await fetch('http://127.0.0.1:' + port + '/js/profile.js')).text(), /id: 'public'/);
  if (require('fs').existsSync(require('path').join(__dirname, '..', 'classic', 'profile.js'))) {   // classic build only
    const cs = createServer({ profile: 'classic' }).server; await new Promise(r => cs.listen(0, r)); const cp = cs.address().port;
    assert.match(await (await fetch('http://127.0.0.1:' + cp + '/js/profile.js')).text(), /id: 'classic'/);
    assert.equal((await fetch('http://127.0.0.1:' + cp + '/classic/assets/img/logo.gif')).status, 200);
    cs.close();
  }

  const A = client(port), B = client(port), C = client(port), D = client(port);
  await Promise.all([A.open(), B.open(), C.open(), D.open()]);
  A.send({ t: 'create', name: 'Ann', fast: true });
  const ja = await A.wait(type('joined')); const code = ja.room.code; assert(/^[A-Z]{4}$/.test(code));
  // start needs 2 players
  A.send({ t: 'start' }); assert.match((await A.wait(type('error'))).msg, /at least 2/);
  B.send({ t: 'join', code, name: 'Ann' }); const jb = await B.wait(type('joined'));
  assert.equal(jb.room.players.length, 2); assert.equal(jb.room.players[1].name, 'Ann 2', 'duplicate names get a suffix');
  C.send({ t: 'join', code: code.toLowerCase(), name: 'Cy' }); const jc = await C.wait(type('joined'));
  D.send({ t: 'join', code: 'ZZZZ', name: 'x' }); assert.equal((await D.wait(type('error'))).code, 'noroom');
  // non-host cannot start; chat works
  B.send({ t: 'start' }); assert.match((await B.wait(type('error'))).msg, /host/);
  B.send({ t: 'chat', text: 'hello <b>all</b>' });
  const ch = await C.wait(m => m.t === 'chat' && m.msg.from === 'Ann 2'); assert.equal(ch.msg.text, 'hello <b>all</b>');
  // reconnect in lobby keeps identity
  B.close(); await A.wait(m => m.t === 'room' && m.room.players.some(p => p.name === 'Ann 2' && !p.connected));
  const B2 = client(port); await B2.open(); B2.send({ t: 'join', code, name: 'whatever', token: jb.you.token });
  const jb2 = await B2.wait(type('joined')); assert(jb2.rejoined); assert.equal(jb2.you.id, jb.you.id);

  const room = rooms.get(code);
  A.send({ t: 'start' });
  await A.wait(type('countdown'));
  D.send({ t: 'join', code, name: 'Late' }); assert.match((await D.wait(type('error'))).msg, /already started/);

  const bots = [{ c: A, id: ja.you.id, mode: 'fast' }, { c: B2, id: jb.you.id, mode: 'slow' }, { c: C, id: jc.you.id, mode: 'mixed' }];
  let puzzles = 0, sawTimeOrDone = { time: 0, done: 0 }, leaked = false, reconnectedMidGame = false;
  for (;;) {
    const pm = await A.wait(m => m.t === 'puzzle' || m.t === 'finished', 20000);
    if (pm.t === 'finished') { var fin = pm; break; }
    puzzles++;
    if (JSON.stringify(pm.puzzle).includes('answer')) leaked = true;
    const pz = room.puzzle(), keys = pz.targets.map(t => t.key);
    // fast bot: whole puzzle in one burst (type-ahead); slow bot: waits, then types; mixed: wrong on some puzzles
    A.send({ t: 'letters', s: keys.join('') });
    const sa = await A.wait(m => m.t === 'solved' && m.last); assert(sa.answer);
    if (puzzles === 4 && !reconnectedMidGame) {     // C drops and comes back mid-puzzle
      C.close(); await new Promise(r => setTimeout(r, 150));
      var C2 = client(port); await C2.open(); C2.send({ t: 'join', code, token: jc.you.token });
      const j = await C2.wait(type('joined')); assert(j.rejoined && j.room.state === 'playing' && j.room.puzzle, 'snapshot has the live puzzle');
      bots[2].c = C2; reconnectedMidGame = true;
    }
    const cc = bots[2].c;
    if (puzzles % 3 === 0) { cc.send({ t: 'letters', s: 'QQQ' }); await cc.wait(type('wrong')); }
    else { for (const k of keys) cc.send({ t: 'letters', s: k }); }
    await new Promise(r => setTimeout(r, 120));
    if (puzzles % 4 !== 0) B2.send({ t: 'letters', s: keys.join('') });   // B sits some out -> clock runs out
    const end = await A.wait(type('puzzleEnd'), 60000);
    sawTimeOrDone[end.reason]++;
    assert.equal(end.answers.length, pz.targets.length);
    const ra = end.results.find(r => r.id === ja.you.id); assert.equal(ra.solved, pz.targets.length);
  }
  assert.equal(puzzles, 12); assert(!leaked, 'no answers in puzzle messages');
  assert(sawTimeOrDone.done > 0 && sawTimeOrDone.time > 0, JSON.stringify(sawTimeOrDone));
  const st = fin.standings; assert.equal(st.length, 3);
  assert.equal(st[0].id, ja.you.id, 'fastest player wins'); assert(st[0].score > st[1].score);
  // back to lobby, host leaves -> host migrates
  A.send({ t: 'back' }); await B2.wait(m => m.t === 'room' && m.room.state === 'lobby');
  A.send({ t: 'leave' }); const after = await B2.wait(m => m.t === 'room' && m.room.players.length === 2);
  assert.notEqual(after.room.hostId, ja.you.id, 'host migrated');
  [A, B2, bots[2].c, D].forEach(c => c.close());
  await new Promise(r => setTimeout(r, 900));
  assert(!rooms.has(code), 'empty room cleaned up');
  server.close();
  console.log('server tests passed: 12 puzzles,', JSON.stringify(sawTimeOrDone), 'final', st.map(s => s.name + ' ' + s.score).join(', '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
