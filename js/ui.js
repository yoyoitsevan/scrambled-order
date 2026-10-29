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
  // The stage is fitted into the *visible* area: inside the safe areas (notch, home bar) and above the
  // on-screen keyboard, so the typebox is never hidden behind the keyboard on phones.
  var vpEl = $('viewport');
  var saProbe = document.createElement('div');
  saProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:var(--sa-top) var(--sa-right) var(--sa-bottom) var(--sa-left)';
  document.body.appendChild(saProbe);
  function inset(side) {
    var v = parseFloat(getComputedStyle(saProbe)['padding' + side.charAt(0).toUpperCase() + side.slice(1)]);
    return isFinite(v) ? v : 0;
  }
  function fit() {
    var vv = window.visualViewport, w = vv ? vv.width : innerWidth, h = vv ? vv.height : innerHeight;
    var top = vv ? vv.offsetTop : 0, left = vv ? vv.offsetLeft : 0;
    if (!kbH) fullH = Math.max(innerHeight, h);
    // native app keyboard (Capacitor): normally the web view shrinks; if it didn't, make room ourselves
    if (kbH && fullH - h < kbH * 0.5) h -= kbH;
    var kb = kbH > 0 || (vv && innerHeight - vv.height > 120);   // keyboard open: it covers the bottom inset
    var st = inset('top'), sb = kb ? 0 : inset('bottom'), sl = inset('left'), sr = inset('right');
    w = Math.max(1, w - sl - sr); h = Math.max(1, h - st - sb);
    vpEl.style.top = (top + st) + 'px'; vpEl.style.left = (left + sl) + 'px';
    vpEl.style.width = w + 'px'; vpEl.style.height = h + 'px';
    vpEl.style.right = vpEl.style.bottom = 'auto';
    // Portrait / narrow screens get their own stacked layout (400 logical px wide, full height).
    // While a text field is focused (keyboard up) the layout never flips, only the height changes.
    var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    var por = (typing && Math.abs(w - lastW) < 2 && lastPortrait !== null) ? lastPortrait : h > w * 1.05;
    lastW = w; lastPortrait = por;
    var sc, sw, sh;
    if (por) { sw = PW; sc = w / PW; sh = Math.max(300, Math.round(h / sc)); }
    else { sw = 640; sh = 480; sc = Math.min(w / 640, h / 480); }
    vpEl.classList.toggle('portrait', por);
    stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
    stage.style.margin = (-sh / 2) + 'px 0 0 ' + (-sw / 2) + 'px';
    stage.style.setProperty('--s', sc); stage.style.setProperty('--sh', sh + 'px');
    if (por) stage.style.setProperty('--logoS', Math.max(.6, Math.min(1.12, (sh * 0.5 - 24) / 291, (sw - 24) / 325)).toFixed(3));
    if (sw !== SW || sh !== SH) { SW = sw; SH = sh; relayout(); }
  }
  var PW = 400, SW = 640, SH = 480, lastW = 0, lastPortrait = null;
  function isPortrait() { return SW !== 640; }
  // re-measure everything sized in px when the stage size changes (rotation, keyboard, resize)
  function relayout() {
    if (!birdL) return;
    birdGeometry();
    if (game && stage.dataset.screen === 'play') {
      if (birdMode === 'crash' || birdMode === 'frozen') { /* keep */ } else updateBirds();
      fitPuzzleText(); renderBox();
    }
  }
  var kbH = 0, fullH = innerHeight;
  if (window.visualViewport) visualViewport.addEventListener('scroll', fit);
  ['keyboardWillShow', 'keyboardDidShow'].forEach(function (ev) {
    addEventListener(ev, function (e) { kbH = (e && e.keyboardHeight) || 0; fit(); setTimeout(fit, 120); });
  });
  ['keyboardWillHide', 'keyboardDidHide'].forEach(function (ev) { addEventListener(ev, function () { kbH = 0; fit(); setTimeout(fit, 120); }); });
  if (N && N.Net && N.Net.isApp()) {
    try { window.Capacitor.Plugins.Keyboard.setAccessoryBarVisible({ isVisible: false }); } catch (e) {}
    document.documentElement.classList.add('native-app');
  }
  addEventListener('orientationchange', function () { setTimeout(fit, 250); });
  addEventListener('resize', fit); if (window.visualViewport) visualViewport.addEventListener('resize', fit); fit();
  function setScreen(name, scene) {
    stage.dataset.screen = name;
    stage.className = 'prof-' + P.id + ' scene-' + (scene || 'back') + (name === 'play' && kind ? ' k-' + kind : '') + (mode === 'multi' ? ' mp' : '') + ($('feedback').textContent ? ' fb' : '');
    if (name === 'play') focusInput();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadData() {
    return fetch('data/puzzles.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return window.OOO_PUZZLES; });
  }

  // ---------- timers owned by the current puzzle ----------
  var anim = [];
  function later(fn, ms) { var id = setTimeout(fn, ms); anim.push(id); return id; }
  function clearAnim() { anim.forEach(clearTimeout); anim = []; Q = []; qBusy = false; curFill = null; fillText = ''; keepFill = false; pending = ''; renderBox(); }

  // ---------- typebox: a hidden input captures keys; #typeText shows the fill + typed-ahead letters ----------
  var SENT = ' ', pending = '', fillText = '', keepFill = false;
  var meas = document.createElement('canvas').getContext('2d');
  function renderBox() {
    $('typeText').innerHTML = esc(fillText) + '<span class="pend">' + esc(pending) + '</span><span class="caret"></span>';
    meas.font = 'bold 32px "Courier New", Courier, monospace';
    var t = fillText + pending, w = meas.measureText(t).width + t.length * 2 + 60;
    var maxW = isPortrait() ? SW - 16 : 620;
    if (isPortrait()) {   // long type-ahead runs shrink to fit the phone width
      var fs = 32; while (fs > 18 && w > maxW) { fs -= 2; meas.font = 'bold ' + fs + 'px "Courier New", Courier, monospace'; w = meas.measureText(t).width + t.length * 2 + 60; }
      $('typeText').style.fontSize = fs + 'px';
    } else $('typeText').style.fontSize = '';
    $('typeBox').style.width = Math.max(isPortrait() ? 300 : 270, Math.min(maxW, Math.ceil(w))) + 'px';
  }
  function focusInput() {
    if (stage.dataset.screen !== 'play' || document.querySelector('.modal:not([hidden])')) return;
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    if (input.value !== SENT) input.value = SENT;
    try { input.setSelectionRange(1, 1); } catch (e) {}
  }
  // "Who said it?": typing 1, 2 or 3 enters the first three letters of that name
  function choiceKeys(v) {
    var p = game && game.currentPuzzle && game.currentPuzzle();
    if (!p || p.kind !== 'choice' || !p.choices) return v;
    return v.replace(/[1-3]/g, function (d) { return E.normalize(p.choices[+d - 1] || '').slice(0, 3); });
  }
  var lastBad = 0;
  function canType() { return game && game.phase === 'playing' && !game.paused && (mode === 'solo' || game.myStatus === 'playing'); }
  function onLetters(letters) {
    if (!canType()) {                         // typing while locked out (turn over / waiting): the "bad click"
      if (game && stage.dataset.screen === 'play' && Date.now() - lastBad > 600) { lastBad = Date.now(); A.play('bad'); }
      return;
    }
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
    else { var l = choiceKeys(v.replace(/^ /, '').toUpperCase()).replace(/[^A-Z]/g, ''); if (l) onLetters(l); }
    input.value = SENT; try { input.setSelectionRange(1, 1); } catch (e) {}
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
  function boxFlash(cls) { var b = $('typeBox'); b.classList.remove('shake', 'good', 'bad'); void b.offsetWidth; if (cls) b.classList.add(cls); }

  // ---------- the auto-fill queue: fills play one after another; type-ahead never drops letters ----------
  var Q = [], qBusy = false, curFill = null;   // curFill: the solved word now filling in (its points show as locked in)
  function enqueue(item) { Q.push(item); if (!qBusy) runQ(); }
  function runQ() {
    var it = Q.shift();
    if (!it) { qBusy = false; if (!keepFill) { fillText = ''; renderBox(); } return; }
    qBusy = true;
    var ms = game.cfg.letterMs;
    if (it.kind === 'wait') { later(runQ, it.ms); return; }
    if (it.kind === 'fn') { it.fn(); runQ(); return; }
    var word = it.answer, i = it.from;
    if (it.kind === 'fill') curFill = it;
    fillText = word.slice(0, i); renderBox();
    (function step() {
      if (i >= word.length) {
        if (it.kind === 'fill') {
          curFill = null; markWord(it.id, 'solved'); boxFlash('good'); A.play(it.last ? 'correct' : 'word');
          setFeedback('+' + it.points + (it.last ? '  SOLVED!' + (mode === 'multi' ? ' STAY TUNED...' : '') : '  NICE!'), 'good');
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
    kind = p.kind === 'choice' ? 'multi k-choice' : p.kind; setScreen('play', 'play');
    $('roundNum').textContent = r.round; $('catText').textContent = p.kind === 'choice' ? p.category : r.category;
    $('greenClue').innerHTML = ''; $('greenWord').innerHTML = ''; $('story').innerHTML = ''; $('clueLine').textContent = '';
    document.querySelectorAll('.obox').forEach(function (b) { b.innerHTML = ''; b.classList.remove('picked', 'shown'); });
    if (p.kind === 'single') { $('greenClue').textContent = p.clue; $('greenWord').innerHTML = span(p.targets[0]); }
    else if (p.kind === 'multi') {
      $('clueLine').textContent = p.clue;
      p.targets.forEach(function (t, i) { var b = document.querySelector('.obox[data-i="' + i + '"]'); if (b) b.innerHTML = span(t); });
    } else if (p.kind === 'choice') {
      $('clueLine').textContent = '\u201C' + p.quote + '\u201D';
      p.choices.forEach(function (c, i) { var b = document.querySelector('.obox[data-i="' + i + '"]');
        if (b) b.innerHTML = '<span class="choice" data-n="' + E.normalize(c) + '"><b>' + (i + 1) + '</b> ' + esc(c.toUpperCase()) + '</span>'; });
    } else {
      var st = $('story'), max = p.kind === 'storyAll' ? 170 : 150, size = p.kind === 'storyAll' ? 20 : 21;
      st.innerHTML = p.segments.map(function (s) { return s.t != null ? span(p.targets[s.t]) : s.given ? '<span class="given">' + esc(s.text) + '</span>' : esc(s.text); }).join('');
    }
    var ins = (P.instructions && P.instructions[p.kind]) || p.instruction || r.instruction;
    $('instr').textContent = ins + (p.missing ? '  (MISSING LETTERS!)' : '');
    markNext();
    fitPuzzleText();
  }
  // Landscape keeps the original fixed sizes; clear anything the portrait fitter set inline.
  function landscapeFit(p) {
    ['greenClue', 'greenWord', 'clueLine', 'instr', 'story'].forEach(function (id) { $(id).style.fontSize = ''; });
    document.querySelectorAll('.obox').forEach(function (b) { b.style.fontSize = ''; });
    var ob = $('orangeBoxes'); ob.style.top = ''; ob.classList.remove('row3');
    fitText($('catText'), 28, 410);
    if (p.kind === 'choice') {
      var cq = $('clueLine'), cs = 20; cq.style.fontSize = cs + 'px';
      while (cs > 12 && cq.offsetHeight > 108) { cs--; cq.style.fontSize = cs + 'px'; }
      document.querySelectorAll('.obox').forEach(function (b) { var fs = 18; b.style.fontSize = fs + 'px'; while (fs > 10 && b.scrollWidth > b.clientWidth + 1) { fs--; b.style.fontSize = fs + 'px'; } });
    }
    if (p.kind === 'story' || p.kind === 'storyAll') {
      var st = $('story'), max = p.kind === 'storyAll' ? 170 : 150, size = p.kind === 'storyAll' ? 20 : 21;
      st.style.fontSize = size + 'px';
      while (size > 14 && st.scrollHeight > max) { size--; st.style.fontSize = size + 'px'; }
    }
  }
  // Portrait: make the clue and the scrambled words as big as the space allows, never overflowing.
  function fitPuzzleText() {
    if (!game) return;
    var p = game.currentPuzzle && game.currentPuzzle(); if (!p) return;
    if (!isPortrait()) { landscapeFit(p); return; }
    var cat = $('catText'); fitText(cat, 24, Math.max(120, $('catBox').clientWidth - 16));
    var gb = $('greenBox');
    var fits = function () { return gb.scrollHeight <= gb.clientHeight + 1 && gb.scrollWidth <= gb.clientWidth + 1; };
    function shrink(el, hi, lo, ok) {   // largest size in [lo, hi] that passes ok()
      var a = lo, b = hi; el.style.fontSize = hi + 'px'; if (ok()) return hi;
      while (b - a > 1) { var m = (a + b) >> 1; el.style.fontSize = m + 'px'; if (ok()) a = m; else b = m; }
      el.style.fontSize = a + 'px'; return a;
    }
    if (p.kind === 'single') {
      var gw = $('greenWord'), gc = $('greenClue'), inner = gb.clientWidth - 24;
      gc.style.fontSize = '15px';
      var ws = shrink(gw, 76, 20, function () { return gw.scrollWidth <= inner && gb.scrollHeight <= gb.clientHeight + 1; });
      shrink(gc, Math.min(30, Math.max(16, Math.round(ws * 0.45))), 12, fits);
    } else if (p.kind === 'multi' || p.kind === 'choice') {
      var cl = $('clueLine'), ob = $('orangeBoxes'), clMax = p.kind === 'choice' ? Math.max(40, Math.min(170, $('instr').offsetTop - cl.offsetTop - 3 * 36 - 34)) : 56;
      shrink(cl, 24, 12, function () { return cl.scrollHeight <= clMax; });
      ob.style.top = (cl.offsetTop + cl.offsetHeight + 10) + 'px';
      ob.classList.toggle('row3', p.kind !== 'choice' && ob.clientHeight < 2 * 50 + 12);    // short on space: one row of three
      document.querySelectorAll('.obox').forEach(function (b) {
        shrink(b, p.kind === 'choice' ? 30 : 40, 12, function () { return (p.kind === 'choice' && b.firstChild ? b.firstChild.offsetWidth + 30 : b.scrollWidth) <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1 && parseFloat(b.style.fontSize) <= b.clientHeight * 0.62; });
      });
    } else {
      shrink($('story'), p.kind === 'storyAll' ? 34 : 36, 11, fits);
    }
    var ins = $('instr'); shrink(ins, 13, 9, function () { return ins.scrollWidth <= ins.clientWidth + 1; });
  }
  function markWord(id, cls) {
    var p = game.currentPuzzle(), t = p && p.targets[id]; if (!t || !t.answer) return;
    if (p.kind === 'choice') {              // light up the right name
      document.querySelectorAll('.choice[data-n="' + t.answer + '"]').forEach(function (el) { el.className = 'choice ' + cls; el.parentNode.classList.add(cls === 'solved' ? 'picked' : 'shown'); }); return;
    }
    document.querySelectorAll('.scr[data-t="' + id + '"]').forEach(function (el) { el.textContent = t.answer; el.className = 'scr ' + cls; });
  }
  function markNext() {                       // storybooks: highlight the earliest unsolved word as a hint (any order is accepted)
    document.querySelectorAll('.scr.next').forEach(function (el) { el.classList.remove('next'); });
    var p = game && game.currentPuzzle(); if (!p || !p.segments || !canType()) return;
    var n = game.unsolved()[0]; if (n) { var el = document.querySelector('.scr[data-t="' + n.id + '"]'); if (el) el.classList.add('next'); }
  }

  // ---------- birds: continuous rock-and-tilt, surging forward on each second (requestAnimationFrame) ----------
  var birdL = $('birdL'), birdR = $('birdR'), crash = $('crashSprite'), birdMode = 'walk';
  var L0 = 2, R0 = 596, ML = 272, MR = 326, FW = 42;
  function birdGeometry() {          // works for either profile's sprite size
    var W = SW, half = W / 2;
    FW = birdL.offsetWidth || 42; L0 = P.classic ? 2 : 16; R0 = W - L0 - FW;
    ML = P.classic ? half - 48 : half - FW + 4; MR = P.classic ? half + 6 : half - 4;
    if (W !== 640) { L0 = 18; R0 = W - L0 - FW; ML = half - FW * 1.15; MR = half + FW * 0.15; }   // portrait: birds are drawn 1.3x
  }
  function placeBirds(f) { f = Math.max(0, Math.min(1, f)); birdL.style.left = (L0 + (ML - L0) * f) + 'px'; birdR.style.left = (R0 + (MR - R0) * f) + 'px'; }
  var birdFrame = -1;
  function resetBirds() {
    birdGeometry(); birdMode = 'walk'; birdFrame = -1; crash.className = '';
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
    if (fl !== birdFrame) { birdFrame = fl; birdL.firstChild.style.backgroundPosition = (-FW * fl) + 'px 0'; birdR.firstChild.style.backgroundPosition = (-FW * frR) + 'px 0'; }
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

  function setFeedback(text, cls) {
    var f = $('feedback'); f.textContent = text; f.className = cls || ''; stage.classList.toggle('fb', !!text);
    f.style.fontSize = '';
    if (isPortrait() && text) { var fs = 19; while (fs > 10 && f.scrollWidth > f.clientWidth + 1) { fs--; f.style.fontSize = fs + 'px'; } }
  }
  // What the next word is worth: drops over the last half of the clock; locked in once you start typing
  // an answer and while a solved word fills in (that is what you are awarded).
  var ptsText = null;
  function updatePoints() {
    var pn = game && game.pointsNow ? game.pointsNow() : null, p = game && game.currentPuzzle && game.currentPuzzle(), txt, cls;
    if (curFill) { txt = '+' + curFill.points; cls = 'frozen'; }
    else if (!pn || !p) { txt = ''; cls = 'off'; }
    else { txt = '+' + pn.points; cls = pn.frozen ? 'frozen' : pn.points < E.pointsFor(p.base, 1, game.cfg) ? 'decay' : ''; }
    if (txt + cls === ptsText) return;
    ptsText = txt + cls; $('ptsNum').textContent = txt; $('ptsBox').className = cls;
    $('ptsLbl').textContent = cls === 'frozen' ? 'LOCKED IN' : 'WORD VALUE';
  }
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
        // the countdown ticks every second, but its sound starts ONCE, when the countdown appears, and plays through
        if (stage.dataset.screen !== 'countdown') { A.themeStop(); if (S.music) A.themeStart(); else A.play('tick3'); }
        setScreen('countdown', 'lobby'); $('cdSec').textContent = (P.classic && ev.seconds < 10 ? '0' : '') + ev.seconds; break;
      case 'roundIntro':
        clearAnim(); $('standings').hidden = true; setScreen('intro', 'back');
        $('introImg').innerHTML = P.classic ? '<img src="classic/assets/img/getrd' + ev.round + '.png" alt="">' : ART.introCard(ev.round);
        $('introTitle').textContent = ev.title; $('introCat').innerHTML = '<small>CATEGORY</small>' + esc(ev.category);
        var rk = (E.ROUND_DEFAULTS[ev.round] || {}).kind;
        $('introInstr').textContent = (P.instructions && P.instructions[rk]) || ev.instruction;
        if (P.sounds && P.sounds.introTheme) { if (S.music && (ev.round > 1 || !A.themePlaying())) A.themeStart(); }   // classic: the theme on every round's get-ready card
        else A.play('update');
        break;
      case 'puzzle':
        clearAnim(); $('standings').hidden = true; A.themeFade(); renderPuzzle(ev.puzzle, g.currentRound());
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
      case 'reveal':                          // storybook auto-unscramble: a free hint, scores nothing
        markWord(ev.id, 'hint'); markNext(); A.play('hint'); break;
      case 'skipped':
        pending = pending.slice(3); renderBox(); boxFlash(null);
        setFeedback('"' + ev.chunk + '" WAS ALREADY UNSCRAMBLED - NO PENALTY', 'time'); break;
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
        later(function () { showStandings(ev.standings); A.play('tally'); }, Math.min(1400, ev.revealMs / 3)); break;   // the scores update
      case 'finished': clearAnim(); showEnd(ev); break;
    }
  }
  // A failed puzzle: after the crash/fall, show every missed word unscrambled at once (no typing sound);
  // the engine holds the screen cfg.failShowMs before moving on.
  function revealQueue(ids) {
    enqueue({ kind: 'fn', fn: function () { ids.forEach(function (id) { markWord(id, 'revealed'); }); } });
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
    A.play('final'); if (S.music) setTimeout(function () { if (stage.dataset.screen === 'end') A.themeStart(); }, 500);
    showBest();
  }

  // ---------- loop ----------
  var clockText = '';
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(250, t - (lastT || t)); lastT = t;   // clamp: a hidden tab pauses the solo clock
    if (!game) return;
    game.tick(dt);
    if (game.phase === 'playing' || game.phase === 'feedback') {     // touch the DOM only when the number changes
      var ct = '\u23F1 ' + Math.ceil(game.timeLeft / 1000) + 's'; if (ct !== clockText) { clockText = ct; $('clockNum').textContent = ct; }
    }
    updatePoints();
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
    if (params.get('fast')) Object.assign(cfg, { countdownMs: 1200, roundIntroMs: 600, correctPauseMs: 600, failLeadMs: 500, revealTailMs: 300, failShowMs: 900, letterMs: 45, wordHoldMs: 120, revealGapMs: 150 });
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
    var link = N.Net.shareBase() + '?room=' + room.code;
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
      case '_auth':                         // password-gated server (private app): ask once, then connect
        $('keyMsg').textContent = m.reason === 'denied' ? 'That password did not work. Try again.' : 'This private game server needs the password.';
        lobbyMsg(m.reason === 'denied' ? 'Wrong password.' : 'Enter the password to play online.');
        closeModals(); $('keyInput').value = ''; $('keyModal').hidden = false;
        setTimeout(function () { try { $('keyInput').focus(); } catch (e) {} }, 50); break;
      case '_status':
        if (m.status === 'closed' && room) { lobbyMsg('Connection lost - reconnecting...'); if (stage.dataset.screen === 'play') setFeedback('RECONNECTING...', 'time'); }
        if (m.status === 'connecting' && !room) setTimeout(function () {   // hosted servers can be asleep
          if (net && net.status === 'connecting' && !room) lobbyMsg('Connecting to the game server... it can take up to a minute to wake up.');
        }, 1500);
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
    $('keyForm').addEventListener('submit', function (e) {
      e.preventDefault(); var pw = $('keyInput').value; if (!pw) return;
      N.Net.setPassword(pw).then(function () { $('keyInput').value = ''; closeModals(); lobbyMsg(''); ensureNet().connect(); });
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
    // warm the cache with the profile's in-game images once the page is idle (no fetch mid-game)
    if (P.preload && P.preload.length) setTimeout(function () { P.preload.forEach(function (u) { var im = new Image(); im.src = u; }); }, 800);
  }
  window.OOO = window.OOO || {};
  loadData().then(init).catch(function (e) {
    document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;position:fixed;top:8px;left:8px">Could not load puzzles: ' + esc(e) + '</p>');
  });
})();
