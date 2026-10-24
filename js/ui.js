/* Scrambled Order - browser UI, v5. Rules live in engine.js (solo) or on the server
   (multiplayer, via net.js RemoteGame, which emits the same events). This file renders, animates
   the birds and the auto-fill queue, plays sounds, runs the lobby and the menus. */
(function () {
  'use strict';
  var E = window.OOOEngine, A = window.OOOAudio, N = window.OOONet, ART = window.OOOArt;
  var P = window.OOO_PROFILE || { id: 'public', title: 'Scrambled Order', classic: false };
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), input = $('answer');
  var params = new URLSearchParams(location.search);
  var data = null, game = null, mode = 'solo', lastT = 0, kind = '';
  var net = null, myId = null, room = null;

  // ---------- settings / high scores ----------
  var S = { sound: true, tick: true, music: true, motion: true, speed: 140, nick: '' };
  try { Object.assign(S, JSON.parse(localStorage.getItem('ooo.settings') || '{}')); } catch (e) {}
  function saveSettings() { try { localStorage.setItem('ooo.settings', JSON.stringify(S)); } catch (e) {} A.setMuted(!S.sound); paintMute(); }
  function getScores() { try { return JSON.parse(localStorage.getItem('ooo.scores') || '[]'); } catch (e) { return []; } }
  function addScore(s) {
    var list = getScores(), entry = { score: s.score, rank: s.rank, pct: s.percent, date: new Date().toISOString().slice(0, 10), ts: Date.now() };
    list.push(entry); list.sort(function (a, b) { return b.score - a.score; }); list = list.slice(0, 10);
    try { localStorage.setItem('ooo.scores', JSON.stringify(list)); } catch (e) {}
    return list.indexOf(entry);
  }
  function best() { var l = getScores(); return l.length ? l[0].score : (+localStorage.getItem('ooo.best') || 0); }
  function showBest() { var b = best(); $('bestScore').textContent = b ? 'BEST SOLO SCORE: ' + b : ''; }

  // ---------- layout ----------
  function fit() {
    var vv = window.visualViewport, w = vv ? vv.width : innerWidth, h = vv ? vv.height : innerHeight;
    stage.style.setProperty('--s', Math.min(w / 640, h / 480));
  }
  addEventListener('resize', fit); if (window.visualViewport) visualViewport.addEventListener('resize', fit); fit();
  function setScreen(name, scene) {
    stage.dataset.screen = name;
    stage.className = 'prof-' + P.id + ' scene-' + (scene || 'back') + (name === 'play' && kind ? ' k-' + kind : '') + (mode === 'multi' ? ' mp' : '');
    if (name === 'play') focusInput();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadData() {
    return fetch('data/puzzles.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return window.OOO_PUZZLES; });
  }

  // ---------- timers owned by the current puzzle ----------
  var anim = [];
  function later(fn, ms) { var id = setTimeout(fn, ms); anim.push(id); return id; }
  function clearAnim() { anim.forEach(clearTimeout); anim = []; Q = []; qBusy = false; fillText = ''; keepFill = false; pending = ''; renderBox(); }

  // ---------- typebox: a hidden input captures keys; #typeText shows the fill + typed-ahead letters ----------
  var SENT = ' ', pending = '', fillText = '', keepFill = false;
  var meas = document.createElement('canvas').getContext('2d');
  function renderBox() {
    $('typeText').innerHTML = esc(fillText) + '<span class="pend">' + esc(pending) + '</span><span class="caret"></span>';
    meas.font = 'bold 32px "Courier New", Courier, monospace';
    var t = fillText + pending, w = meas.measureText(t).width + t.length * 2 + 60;
    $('typeBox').style.width = Math.max(270, Math.min(620, Math.ceil(w))) + 'px';
  }
  function focusInput() {
    if (stage.dataset.screen !== 'play' || document.querySelector('.modal:not([hidden])')) return;
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    if (input.value !== SENT) input.value = SENT;
    try { input.setSelectionRange(1, 1); } catch (e) {}
  }
  function canType() { return game && game.phase === 'playing' && !game.paused && (mode === 'solo' || game.myStatus === 'playing'); }
  function onLetters(letters) {
    if (!canType()) return;
    for (var i = 0; i < letters.length; i++) { pending += letters[i]; A.play('type'); }   // one click per typed letter
    renderBox();
    game.feed(letters);
  }
  function onBackspace() {
    if (!canType() || pending.length % 3 === 0) return;     // a finished 3-letter chunk is already judged
    pending = pending.slice(0, -1); game.backspace(); renderBox();
  }
  input.value = SENT;
  input.addEventListener('input', function () {
    var v = input.value;
    if (!v.length) onBackspace();
    else { var l = v.replace(/^ /, '').toUpperCase().replace(/[^A-Z]/g, ''); if (l) onLetters(l); }
    input.value = SENT; try { input.setSelectionRange(1, 1); } catch (e) {}
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
  function boxFlash(cls) { var b = $('typeBox'); b.classList.remove('shake', 'good', 'bad'); void b.offsetWidth; if (cls) b.classList.add(cls); }

  // ---------- the auto-fill queue: fills play one after another; type-ahead never drops letters ----------
  var Q = [], qBusy = false;
  function enqueue(item) { Q.push(item); if (!qBusy) runQ(); }
  function runQ() {
    var it = Q.shift();
    if (!it) { qBusy = false; if (!keepFill) { fillText = ''; renderBox(); } return; }
    qBusy = true;
    var ms = game.cfg.letterMs;
    if (it.kind === 'wait') { later(runQ, it.ms); return; }
    if (it.kind === 'fn') { it.fn(); runQ(); return; }
    var word = it.answer, i = it.from;
    fillText = word.slice(0, i); renderBox();
    (function step() {
      if (i >= word.length) {
        if (it.kind === 'fill') {
          markWord(it.id, 'solved'); boxFlash('good'); A.play('correct');
          setFeedback('+' + it.points + (it.last ? '  SOLVED!' + (mode === 'multi' ? ' WAITING FOR THE OTHERS...' : '') : '  NICE!'), 'good');
          if (it.last) { keepFill = true; qBusy = false; return; }
          later(function () { fillText = ''; renderBox(); runQ(); }, game.cfg.wordHoldMs);
        } else { markWord(it.id, 'revealed'); later(runQ, game.cfg.revealGapMs); }   // reveal
        return;
      }
      i++; fillText = word.slice(0, i); renderBox(); A.play('type');
      later(step, ms);
    })();
  }

  // ---------- puzzle rendering (built once per puzzle: scrambles never change while typing) ----------
  function span(t) {
    return '<span class="scr' + (t.style === 'missing' ? ' missing' : '') + '" data-t="' + t.id + '">' +
      esc(t.style === 'missing' ? t.clue : t.clue.toLowerCase()) + '</span>';
  }
  function fitText(el, size, max) { el.style.fontSize = size + 'px'; while (size > 14 && el.scrollWidth > max) { size--; el.style.fontSize = size + 'px'; } }
  function renderPuzzle(p, r) {
    kind = p.kind; setScreen('play', 'play');
    $('roundNum').textContent = r.round; $('catText').textContent = r.category; fitText($('catText'), 28, 410);
    $('greenClue').innerHTML = ''; $('greenWord').innerHTML = ''; $('story').innerHTML = ''; $('clueLine').textContent = '';
    document.querySelectorAll('.obox').forEach(function (b) { b.innerHTML = ''; });
    if (p.kind === 'single') { $('greenClue').textContent = p.clue; $('greenWord').innerHTML = span(p.targets[0]); }
    else if (p.kind === 'multi') {
      $('clueLine').textContent = p.clue;
      p.targets.forEach(function (t, i) { var b = document.querySelector('.obox[data-i="' + i + '"]'); if (b) b.innerHTML = span(t); });
    } else {
      var st = $('story'), max = p.kind === 'storyAll' ? 170 : 150, size = p.kind === 'storyAll' ? 20 : 21;
      st.innerHTML = p.segments.map(function (s) { return s.t != null ? span(p.targets[s.t]) : esc(s.text); }).join('');
      st.style.fontSize = size + 'px';
      while (size > 14 && st.scrollHeight > max) { size--; st.style.fontSize = size + 'px'; }
    }
    $('instr').textContent = r.instruction + (p.missing ? '  (MISSING LETTERS!)' : '');
    markNext();
  }
  function markWord(id, cls) {
    var p = game.currentPuzzle(), t = p && p.targets[id]; if (!t || !t.answer) return;
    document.querySelectorAll('.scr[data-t="' + id + '"]').forEach(function (el) { el.textContent = t.answer; el.className = 'scr ' + cls; });
  }
  function markNext() {                       // storybooks are solved in order: underline the next word
    document.querySelectorAll('.scr.next').forEach(function (el) { el.classList.remove('next'); });
    var p = game && game.currentPuzzle(); if (!p || p.order !== 'sequence' || !canType()) return;
    var n = game.unsolved()[0]; if (n) { var el = document.querySelector('.scr[data-t="' + n.id + '"]'); if (el) el.classList.add('next'); }
  }

  // ---------- birds: continuous rock-and-tilt, surging forward on each second (requestAnimationFrame) ----------
  var birdL = $('birdL'), birdR = $('birdR'), crash = $('crashSprite'), birdMode = 'walk';
  var L0 = 2, R0 = 596, ML = 272, MR = 326, FW = 42;
  function birdGeometry() {          // works for either profile's sprite size
    FW = birdL.offsetWidth || 42; L0 = P.classic ? 2 : 16; R0 = 640 - L0 - FW;
    ML = P.classic ? 272 : 320 - FW + 4; MR = P.classic ? 326 : 316;
  }
  function placeBirds(f) { f = Math.max(0, Math.min(1, f)); birdL.style.left = (L0 + (ML - L0) * f) + 'px'; birdR.style.left = (R0 + (MR - R0) * f) + 'px'; }
  function resetBirds() {
    birdGeometry(); birdMode = 'walk'; crash.className = '';
    [birdL, birdR].forEach(function (b) { b.className = 'bird'; b.style.visibility = 'visible'; b.style.transform = ''; });
    placeBirds(0);
  }
  function updateBirds() {
    if (birdMode !== 'walk' || !game || stage.dataset.screen !== 'play' || !game.timeTotal) return;
    var e = Math.max(0, (game.timeTotal - game.timeLeft) / 1000), T = game.timeTotal / 1000;
    var whole = Math.floor(e), fr = e - whole;
    placeBirds((whole + (1 - Math.cos(Math.PI * fr)) / 2) / T);        // eased step on every beat
    var rl = 0, rr = 0, bl = 0, br = 0;
    if (S.motion) {
      rl = Math.sin(2 * Math.PI * e) * 9; rr = Math.sin(2 * Math.PI * e + 2.3) * 9;    // out of sync with each other
      bl = -Math.abs(Math.sin(Math.PI * e)) * 3.5; br = -Math.abs(Math.sin(Math.PI * e + 1.2)) * 3.5;
    }
    birdL.style.transform = 'translateY(' + bl.toFixed(2) + 'px) rotate(' + rl.toFixed(2) + 'deg)';
    birdR.style.transform = 'translateY(' + br.toFixed(2) + 'px) rotate(' + rr.toFixed(2) + 'deg)';
    var fl = Math.floor(e * 3) % 3, frR = (fl + 1) % 3;
    birdL.firstChild.style.backgroundPosition = (-FW * fl) + 'px 0'; birdR.firstChild.style.backgroundPosition = (-FW * frR) + 'px 0';
  }
  function freezeBirds() { if (birdMode === 'walk') birdMode = 'frozen'; }
  function dropBirds() {
    birdMode = 'fallen';
    [birdL, birdR].forEach(function (b, i) {
      b.style.visibility = 'visible'; b.className = 'bird ' + (i ? 'fall-r' : 'fall-l');
      if (!P.classic) b.firstChild.style.backgroundPosition = (-FW * 3) + 'px 0';     // the flailing pose
    });
  }
  function crashBirds() {
    birdMode = 'crash'; placeBirds(1); birdL.style.visibility = birdR.style.visibility = 'hidden';
    crash.className = 'show'; A.whistle(); A.play('crash');
    later(function () { crash.className = ''; dropBirds(); }, 380);
  }

  function setFeedback(text, cls) { var f = $('feedback'); f.textContent = text; f.className = cls || ''; }
  function setScore(n, bump) { var el = $('scoreNum'); el.textContent = n; if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } }

  // ---------- multiplayer widgets ----------
  var ICON = { playing: '\u2026', done: '\u2714', out: '\u2716', timeout: '\u23F1', idle: '' };
  function renderStrip(players) {
    if (mode !== 'multi') return;
    $('mpStrip').innerHTML = (players || []).map(function (p) {
      var st = p.status === 'playing' && p.solved ? p.solved + '\u2713' : ICON[p.status] || '';
      return '<span class="pchip' + (p.id === myId ? ' me' : '') + (p.connected ? '' : ' off') + ' s-' + p.status + '">' + esc(p.name) + ' <b>' + p.score + '</b> ' + st + '</span>';
    }).join('');
  }
  function showStandings(list) {
    $('standList').innerHTML = list.map(function (s) {
      var mv = !s.prevRank ? '' : s.rank < s.prevRank ? '<i class="up">\u25B2</i>' : s.rank > s.prevRank ? '<i class="down">\u25BC</i>' : '<i>=</i>';
      return '<li class="' + (s.id === myId ? 'me' : '') + '"><span class="rk">' + s.rank + '</span><span class="nm">' + esc(s.name) + (s.connected ? '' : ' (away)') + '</span>' +
        '<span class="pts">+' + s.lastPts + '</span><span class="sc">' + s.score + '</span>' + mv + '</li>';
    }).join('');
    $('standings').hidden = false;
  }

  // ---------- engine / server events ----------
  function onEvent(ev, g) {
    switch (ev.type) {
      case 'countdown':
        clearAnim(); $('standings').hidden = true;
        setScreen('countdown', 'lobby'); $('cdSec').textContent = (P.classic && ev.seconds < 10 ? '0' : '') + ev.seconds; A.play('tick3'); break;
      case 'roundIntro':
        clearAnim(); $('standings').hidden = true; setScreen('intro', 'back');
        $('introImg').innerHTML = P.classic ? '<img src="classic/assets/img/getrd' + ev.round + '.png" alt="">' : ART.introCard(ev.round);
        $('introTitle').textContent = ev.title; $('introCat').innerHTML = '<small>CATEGORY</small>' + esc(ev.category);
        $('introInstr').textContent = ev.instruction; A.play('update'); break;
      case 'puzzle':
        clearAnim(); $('standings').hidden = true; renderPuzzle(ev.puzzle, g.currentRound());
        $('progress').textContent = 'Round ' + g.currentRound().round + ' \u00b7 puzzle ' + (ev.index + 1) + ' of ' + ev.count;
        setFeedback(''); setScore(g.score); boxFlash(null); resetBirds(); renderStrip(g.players);
        $('clockNum').className = ''; focusInput(); later(focusInput, 60); break;
      case 'second':
        if (S.tick) A.tickTock();
        $('clockNum').className = ev.seconds <= 3 ? 'low' : ''; break;
      case 'solved':
        pending = pending.slice(3); renderBox(); setScore(ev.score, true);
        enqueue({ kind: 'fill', id: ev.target.id, answer: ev.target.answer, from: 3, points: ev.points, last: ev.last });
        markNext(); break;
      case 'restored': markWord(ev.target.id, 'solved'); markNext(); break;
      case 'puzzleSolved': freezeBirds(); markNext(); break;
      case 'wrong':
        pending = ''; renderBox(); boxFlash('shake'); later(function () { boxFlash('bad'); }, 360);
        A.play('wrong'); dropBirds(); markNext();                 // birds fall off right where they are
        setFeedback('"' + ev.chunk + '" - NOPE! TURN OVER' + (ev.waitForEnd ? '. WAIT FOR THE NEXT PUZZLE' : ''), 'bad');
        if (!ev.waitForEnd) { enqueue({ kind: 'wait', ms: g.cfg.failLeadMs }); revealQueue(ev.reveal); }
        break;
      case 'timeout':
        pending = ''; renderBox(); crashBirds(); boxFlash('bad'); markNext();
        setFeedback("THE BIRDS CRASHED - TIME'S UP!", 'time');
        if (!ev.multiplayer) { enqueue({ kind: 'wait', ms: g.cfg.failLeadMs }); revealQueue(ev.reveal); }
        break;
      case 'progress': renderStrip(ev.players); break;
      case 'puzzleEnd':
        if (ev.reason === 'done' && birdMode === 'walk') freezeBirds();
        ev.reveal.forEach(function (id) { markWord(id, 'revealed'); });
        later(function () { showStandings(ev.standings); A.play('tally'); }, Math.min(1400, ev.revealMs / 3)); break;
      case 'finished': clearAnim(); showEnd(ev); break;
    }
  }
  function revealQueue(ids) {
    var p = game.currentPuzzle();
    ids.forEach(function (id) { enqueue({ kind: 'reveal', id: id, answer: p.targets[id].answer, from: 0 }); });
  }

  // ---------- end screens ----------
  function dancers() {
    var d = $('dancers'); d.innerHTML = '';
    if (!P.classic) { d.innerHTML = 'BRAVO'.split('').map(function (ch, i) { return ART.mascot(ch, i); }).join(''); return; }
    for (var i = 0; i < 5; i++) { var im = new Image(); im.src = 'classic/assets/img/danceguy.gif'; im.alt = ''; d.appendChild(im); }
  }
  function showEnd(ev) {
    setScreen('end', 'back'); dancers();
    var mp = mode === 'multi'; stage.classList.toggle('mp', mp);
    $('finalList').hidden = !mp; ['endScore', 'endRank', 'endStats', 'endBest'].forEach(function (id) { $(id).hidden = mp; });
    $('btnAgain').hidden = mp; $('btnToLobby').hidden = !mp;
    if (mp) {
      $('endTitle').textContent = 'FINAL STANDINGS';
      $('finalList').innerHTML = ev.standings.map(function (s) {
        return '<li class="' + (s.id === myId ? 'me' : '') + (s.rank === 1 ? ' win' : '') + '"><span class="rk">' + (s.rank === 1 ? '\u2605' : s.rank) + '</span><span class="nm">' + esc(s.name) +
          '</span><span class="tt">' + esc(s.title) + '</span><span class="sc">' + s.score + '</span></li>';
      }).join('');
      var amHost = room && room.hostId === myId;
      $('btnToLobby').disabled = !amHost; $('btnToLobby').textContent = amHost ? 'BACK TO LOBBY' : 'WAITING FOR HOST';
    } else {
      var s = ev.summary;
      $('endTitle').textContent = 'CONGRATULATIONS!';
      var prevBest = best(), place = addScore(s);
      $('endScore').textContent = 'FINAL SCORE: ' + s.score; $('endRank').textContent = 'Rank: ' + s.rank;
      $('endStats').textContent = s.wordsSolved + ' of ' + s.wordsTotal + ' words \u00b7 ' + s.puzzlesSolved + ' of ' + s.played + ' puzzles \u00b7 ' + s.timeouts + ' crashes \u00b7 ' + s.percent + '% of max';
      $('endBest').textContent = s.score > prevBest && s.score > 0 ? '\u2605 NEW HIGH SCORE! \u2605' : place >= 0 ? 'High-score table: #' + (place + 1) : 'Best: ' + prevBest;
    }
    A.play('tally'); if (S.music) setTimeout(function () { if (stage.dataset.screen === 'end') A.themeStart(); }, 500);
    showBest();
  }

  // ---------- loop ----------
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(250, t - (lastT || t)); lastT = t;   // clamp: a hidden tab pauses the solo clock
    if (!game) return;
    game.tick(dt);
    if (game.phase === 'playing' || game.phase === 'feedback') $('clockNum').textContent = '\u23F1 ' + Math.ceil(game.timeLeft / 1000) + 's';
    updateBirds();
  }
  function togglePause() {
    if (!game || mode !== 'solo' || game.phase === 'finished' || game.phase === 'idle') return;
    game.setPaused(!game.paused); $('pausedBanner').hidden = !game.paused; if (!game.paused) focusInput();
  }

  // ---------- solo ----------
  function startSolo() {
    A.unlock(); A.themeStop(); leaveRoom(true); mode = 'solo';
    var cfg = { letterMs: +S.speed || 140 };
    if (params.get('fast')) Object.assign(cfg, { countdownMs: 1200, roundIntroMs: 600, correctPauseMs: 600, failLeadMs: 500, revealTailMs: 300, letterMs: 45, wordHoldMs: 120, revealGapMs: 150 });
    var seed = params.get('seed'), rng = Math.random;
    if (seed) { var x = +seed || 1; rng = function () { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }
    game = new E.Game(data, { config: cfg, rng: rng }); game.on(onEvent);
    window.OOO.game = game; setScore(0); game.start();
  }

  // ---------- multiplayer lobby ----------
  function ensureNet() {
    if (net) return net;
    net = new N.Net(); window.OOO.net = net;
    net.on(onNet); return net;
  }
  function lobbyMsg(t) { $('lobbyMsg').textContent = t || ''; }
  function openLobby() {
    A.unlock();
    setScreen('lobby', 'play');
    $('nick').value = S.nick || '';
    if (params.get('room')) $('joinCode').value = params.get('room').toUpperCase().slice(0, 4);
    if (!N.Net.available()) { lobbyMsg('Multiplayer needs the game server (npm start). Solo play works offline.'); $('btnCreate').disabled = $('btnJoin').disabled = true; return; }
    $('lobbyJoin').hidden = !!room; $('lobbyRoom').hidden = !room;
    ensureNet().connect();
  }
  function nick() { var n = $('nick').value.trim().slice(0, 16); if (!n) { lobbyMsg('Pick a nickname first.'); $('nick').focus(); return null; } S.nick = n; saveSettings(); return n; }
  function renderRoom() {
    if (!room) return;
    $('lobbyJoin').hidden = true; $('lobbyRoom').hidden = false;
    $('roomCode').textContent = room.code;
    var link = location.origin + location.pathname.replace(/index\.html$/, '') + '?room=' + room.code;
    $('roomLink').textContent = link; $('roomLink').dataset.link = link;
    $('playerCount').textContent = room.players.length + '/' + room.maxPlayers;
    $('playerList').innerHTML = room.players.map(function (p) {
      return '<li class="' + (p.id === myId ? 'me' : '') + (p.connected ? '' : ' off') + '">' + (p.isHost ? '<i title="host">\u2605</i> ' : '') + esc(p.name) +
        (p.id === myId ? ' <small>(you)</small>' : '') + (p.connected ? '' : ' <small>(reconnecting)</small>') + '</li>';
    }).join('');
    var host = room.hostId === myId, enough = room.players.filter(function (p) { return p.connected; }).length >= room.minPlayers;
    $('btnStart').hidden = !host; $('btnStart').disabled = !enough || room.state !== 'lobby';
    $('startHint').textContent = room.state !== 'lobby' ? 'Game in progress...' : host ? (enough ? 'Everyone here? Press start!' : 'Waiting for at least ' + room.minPlayers + ' players...') : 'Waiting for the host to start...';
  }
  function addChat(m) {
    var log = $('chatLog'), d = document.createElement('div');
    d.className = m.from ? 'cm' : 'cm sys';
    d.innerHTML = m.from ? '<b>' + esc(m.from) + ':</b> ' + esc(m.text) : esc(m.text);
    log.appendChild(d); while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function newRemoteGame() {
    mode = 'multi'; game = new N.RemoteGame(net, myId); game.on(onEvent); window.OOO.game = game; return game;
  }
  function onNet(m) {
    switch (m.t) {
      case '_status':
        if (m.status === 'closed' && room) { lobbyMsg('Connection lost - reconnecting...'); if (stage.dataset.screen === 'play') setFeedback('RECONNECTING...', 'time'); }
        if (m.status === 'open') lobbyMsg(''); break;
      case 'joined':
        myId = m.you.id; room = m.room; lobbyMsg(''); A.play('join');
        $('chatLog').innerHTML = ''; room.chat.forEach(addChat);
        if (room.state === 'lobby' || room.state === 'finished') { if (stage.dataset.screen !== 'end') setScreen('lobby', 'play'); renderRoom(); }
        else { var g = newRemoteGame(); g.resume(room); if (room.state === 'playing') { onEvent({ type: 'progress', players: room.players }, g); if (room.mine) { pending = room.mine.buffer || ''; renderBox(); } }
               else { setScreen('intro', 'back'); $('introTitle').textContent = 'REJOINING...'; } }
        history.replaceState(null, '', '?room=' + room.code + (params.get('fast') ? '&fast=1' : ''));
        break;
      case 'room':
        room = m.room; renderRoom();
        if (room.state === 'lobby' && ['end', 'play', 'countdown', 'intro'].indexOf(stage.dataset.screen) >= 0 && mode === 'multi') { game = null; A.themeStop(); setScreen('lobby', 'play'); }
        if (stage.dataset.screen === 'end' && mode === 'multi') { var h = room.hostId === myId; $('btnToLobby').disabled = !h; $('btnToLobby').textContent = h ? 'BACK TO LOBBY' : 'WAITING FOR HOST'; }
        break;
      case 'chat': addChat(m.msg); if (!m.msg.from && /joined|back/.test(m.msg.text)) A.play('join'); break;
      case 'error': lobbyMsg(m.msg); if (stage.dataset.screen !== 'lobby') setFeedback(m.msg, 'bad'); break;
      case 'left': room = null; myId = null; break;
      case 'countdown': A.themeStop(); newRemoteGame().handle(m); break;
      default: if (game && game.multiplayer) game.handle(m);
    }
  }
  function leaveRoom(silent) {
    if (net && room) { net.send({ t: 'leave' }); net.forget(); }
    room = null; myId = null; if (!silent) { $('lobbyRoom').hidden = true; $('lobbyJoin').hidden = false; }
    if (mode === 'multi') { game = null; mode = 'solo'; }
    history.replaceState(null, '', location.pathname + (params.get('fast') ? '?fast=1' : ''));
  }

  // ---------- modals ----------
  function openModal(id) {
    $(id).hidden = false;
    if (id === 'scoresModal') renderScores();
    if (id === 'settingsModal') { $('setSound').checked = S.sound; $('setTick').checked = S.tick; $('setMusic').checked = S.music; $('setMotion').checked = S.motion; $('setSpeed').value = String(S.speed); $('setNick').value = S.nick || ''; }
    if (game && mode === 'solo' && game.phase !== 'finished' && !game.paused && stage.dataset.screen === 'play') togglePause();
  }
  function closeModals() {
    document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; });
    if (game && game.paused) togglePause(); focusInput();
  }
  function renderScores() {
    var l = getScores();
    $('scoreTable').innerHTML = l.length ? l.map(function (s, i) { return '<li><span class="rk">' + (i + 1) + '</span><span class="sc">' + s.score + '</span><span class="tt">' + esc(s.rank) + '</span><span class="dt">' + esc(s.date) + '</span></li>'; }).join('')
      : '<li class="none">No games yet - go play!</li>';
  }
  var mute = $('btnMute');
  function paintMute() { mute.classList.toggle('off', !S.sound); }

  function init(d) {
    data = d; showBest(); A.setMuted(!S.sound); paintMute();
    document.title = P.title;
    $('logoFrame').innerHTML = P.classic ? '<img src="classic/assets/img/logo.gif" alt="' + esc(P.title) + '" width="317" height="283">' : ART.logo(P.title, P.tagline);
    $('fanNote').textContent = P.note || '';
    setScreen('title', 'back');
    $('btnPlay').addEventListener('click', startSolo);
    $('btnMulti').addEventListener('click', openLobby);
    $('btnHow').addEventListener('click', function () { openModal('helpModal'); });
    $('btnSettings').addEventListener('click', function () { openModal('settingsModal'); });
    $('btnScores').addEventListener('click', function () { openModal('scoresModal'); });
    $('btnHelp').addEventListener('click', function () { openModal('helpModal'); });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModals); });
    $('btnClearScores').addEventListener('click', function () { try { localStorage.removeItem('ooo.scores'); localStorage.removeItem('ooo.best'); } catch (e) {} renderScores(); showBest(); });
    ['setSound', 'setTick', 'setMusic', 'setMotion'].forEach(function (id) {
      $(id).addEventListener('change', function () { S[{ setSound: 'sound', setTick: 'tick', setMusic: 'music', setMotion: 'motion' }[id]] = $(id).checked; saveSettings(); });
    });
    $('setSpeed').addEventListener('change', function () { S.speed = +$('setSpeed').value; saveSettings(); });
    $('setNick').addEventListener('change', function () { S.nick = $('setNick').value.trim().slice(0, 16); saveSettings(); });
    mute.addEventListener('click', function () { S.sound = !S.sound; saveSettings(); focusInput(); });
    $('btnAgain').addEventListener('click', function () { A.themeStop(); startSolo(); });
    $('btnEndMenu').addEventListener('click', function () { A.themeStop(); leaveRoom(true); game = null; mode = 'solo'; setScreen('title', 'back'); });
    $('btnToLobby').addEventListener('click', function () { if (net) net.send({ t: 'back' }); });
    // lobby
    $('btnLobbyBack').addEventListener('click', function () { setScreen('title', 'back'); });
    $('btnCreate').addEventListener('click', function () { var n = nick(); if (!n) return; ensureNet().lastName = n; net.forget(); net.send({ t: 'create', name: n, fast: !!params.get('fast') }); });
    $('btnJoin').addEventListener('click', function () {
      var n = nick(); if (!n) return; var code = $('joinCode').value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) { lobbyMsg('Room codes are 4 letters.'); return; }
      ensureNet().lastName = n;
      var tok = net.session && net.session.code === code ? net.session.token : undefined;
      net.send({ t: 'join', code: code, name: n, token: tok });
    });
    $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnJoin').click(); });
    $('btnStart').addEventListener('click', function () { net.send({ t: 'start' }); });
    $('btnLeave').addEventListener('click', function () { leaveRoom(); lobbyMsg('You left the room.'); });
    $('btnCopy').addEventListener('click', function () {
      var l = $('roomLink').dataset.link; try { navigator.clipboard.writeText(l); $('btnCopy').textContent = 'COPIED!'; } catch (e) {}
      setTimeout(function () { $('btnCopy').textContent = 'COPY LINK'; }, 1500);
    });
    $('chatForm').addEventListener('submit', function (e) { e.preventDefault(); var t = $('chatInput').value.trim(); if (t && net) net.send({ t: 'chat', text: t }); $('chatInput').value = ''; });
    // the typebox is always the active place during play
    input.addEventListener('blur', function () { setTimeout(focusInput, 0); });
    stage.addEventListener('pointerdown', function (e) { if (stage.dataset.screen === 'play' && e.target.tagName !== 'BUTTON') setTimeout(focusInput, 0); });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (document.querySelector('.modal:not([hidden])')) closeModals(); else togglePause(); e.preventDefault(); return; }
      if (stage.dataset.screen === 'title' && e.key === 'Enter') { startSolo(); return; }
      if (stage.dataset.screen === 'play' && document.activeElement !== input) focusInput();
    });
    $('pausedBanner').addEventListener('click', togglePause);
    requestAnimationFrame(frame);
    if (!N.Net.available()) $('btnMulti').title = 'Run the game server (npm start) for multiplayer';
    // rejoin after a refresh, or open a shared ?room= link straight into the lobby
    var sess = null; try { sess = JSON.parse(sessionStorage.getItem('ooo.session') || 'null'); } catch (e) {}
    if (N.Net.available() && (params.get('room') || sess)) {
      openLobby();
      if (sess && (!params.get('room') || params.get('room').toUpperCase() === sess.code)) { net.wantRejoin = true; net.lastName = sess.name; }
    }
    window.OOO.ready = true;
  }
  window.OOO = window.OOO || {};
  loadData().then(init).catch(function (e) {
    document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;position:fixed;top:8px;left:8px">Could not load puzzles: ' + esc(e) + '</p>');
  });
})();
