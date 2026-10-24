/* Scrambled Order - sound. Public profile: every sound is synthesized here with WebAudio
   (original designs, no samples). The classic profile may map names to its own sample files.
   Each voice is drawn at roughly unit level; LEVEL[] (measured with tools/measure_audio.py,
   target about -20 dBFS RMS) evens out loudness, then everything goes through one compressor. */
(function () {
  'use strict';
  var P = window.OOO_PROFILE || {}, SAMPLES = P.sounds || null;
  // Measured by tools/measure_audio.py (each voice -> about -20 dBFS RMS, peaks <= 0.9); the
  // rapid-fire ones (typing, clock) then sit 4 dB lower so they never tire the ear.
  var LEVEL = { type: 0.85, tick: 0.52, tock: 0.5, tick3: 0.37, correct: 0.48, wrong: 0.4, bad: 0.84, update: 0.41,
                whistle: 0.16, crash: 0.63, tally: 0.93, join: 0.77, theme: 0.56 };
  var muted = false, counts = {}, ctx = null, master = null, themeBus = null;
  try { muted = localStorage.getItem('ooo.mute') === '1'; } catch (e) {}

  function actx() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      ctx = new C(); master = chain(ctx, ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function chain(c, dest) {             // master gain -> gentle compressor -> output
    var comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.15;
    var g = c.createGain(); g.gain.value = 0.9; g.connect(comp); comp.connect(dest); return g;
  }
  // ---------- building blocks ----------
  function env(c, out, t, a, hold, rel, peak) {
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak || 1, t + a);
    g.gain.setValueAtTime(peak || 1, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    g.connect(out); return g;
  }
  function tone(c, out, t, f, dur, type, peak, opt) {
    opt = opt || {};
    var o = c.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + (opt.glide || dur));
    var dest = env(c, out, t, opt.a || 0.004, opt.hold || 0, dur, peak);
    if (opt.lp) { var fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = opt.lp; o.connect(fl); fl.connect(dest); } else o.connect(dest);
    o.start(t); o.stop(t + (opt.a || 0.004) + (opt.hold || 0) + dur + 0.05); return o;
  }
  var noiseBuf = null;
  function noise(c, out, t, dur, peak, filt) {
    if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); var d = noiseBuf.getChannelData(0), x = 12345;
      for (var i = 0; i < d.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x / 0x3fffffff - 1; }
    }
    var s = c.createBufferSource(); s.buffer = noiseBuf;
    var f = c.createBiquadFilter(); f.type = filt.type || 'bandpass'; f.frequency.setValueAtTime(filt.f, t); f.Q.value = filt.q || 1;
    if (filt.to) f.frequency.exponentialRampToValueAtTime(filt.to, t + dur);
    s.connect(f); f.connect(env(c, out, t, 0.002, 0, dur, peak)); s.start(t); s.stop(t + dur + 0.05);
  }
  var NOTE = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  // ---------- the voices (each returns its length in seconds) ----------
  var V = {
    type: function (c, o, t) { noise(c, o, t, 0.028, 1, { f: 3200, q: 1.4 }); tone(c, o, t, 210, 0.03, 'triangle', 0.6); return 0.06; },
    tick: function (c, o, t) { tone(c, o, t, 1250, 0.05, 'sine', 1); tone(c, o, t, 2500, 0.02, 'sine', 0.3); return 0.08; },
    tock: function (c, o, t) { tone(c, o, t, 820, 0.06, 'sine', 1); tone(c, o, t, 1640, 0.02, 'sine', 0.3); return 0.09; },
    tick3: function (c, o, t) { tone(c, o, t, 880, 0.12, 'triangle', 1, { hold: 0.04 }); tone(c, o, t, 1760, 0.06, 'sine', 0.25); return 0.2; },
    correct: function (c, o, t) {
      [84, 88, 91, 96].forEach(function (m, i) { var s = t + i * 0.07; tone(c, o, s, NOTE(m), 0.45, 'sine', 0.8); tone(c, o, s, NOTE(m) * 2, 0.2, 'triangle', 0.18); });
      return 0.75; },
    wrong: function (c, o, t) {
      [0, 0.2].forEach(function (d) { tone(c, o, t + d, 138, 0.16, 'sawtooth', 0.7, { lp: 900, hold: 0.06 }); tone(c, o, t + d, 146, 0.16, 'sawtooth', 0.7, { lp: 900, hold: 0.06 }); });
      return 0.45; },
    bad: function (c, o, t) { tone(c, o, t, 220, 0.08, 'square', 0.7, { lp: 1200 }); return 0.1; },
    update: function (c, o, t) {           // little round-intro fanfare
      [[67, 0, 0.1], [72, 0.11, 0.1], [76, 0.22, 0.1], [79, 0.33, 0.42]].forEach(function (n) {
        tone(c, o, t + n[1], NOTE(n[0]), n[2], 'sawtooth', 0.55, { lp: 2400, hold: n[2] * 0.6 }); tone(c, o, t + n[1], NOTE(n[0]) / 2, n[2], 'triangle', 0.35, { hold: n[2] * 0.6 }); });
      return 0.9; },
    whistle: function (c, o, t) {          // slide whistle: a breathy sine that wobbles and swoops down
      var dur = 1.15, osc = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(2300, t);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.18); osc.frequency.exponentialRampToValueAtTime(220, t + dur);
      lfo.frequency.value = 9; lg.gain.value = 40; lfo.connect(lg); lg.connect(osc.frequency);
      osc.connect(env(c, o, t, 0.04, dur - 0.24, 0.2, 1)); osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      noise(c, o, t, dur, 0.06, { f: 2000, q: 0.7 }); return dur; },
    crash: function (c, o, t) {
      noise(c, o, t, 0.45, 1, { type: 'lowpass', f: 4000, to: 250, q: 0.8 });
      tone(c, o, t, 150, 0.3, 'sine', 1, { to: 45 });
      [0.06, 0.16, 0.27].forEach(function (d, i) { tone(c, o, t + d, 620 - i * 120, 0.09, 'triangle', 0.4, { to: 300 - i * 50 }); });
      return 0.55; },
    tally: function (c, o, t) { for (var i = 0; i < 10; i++) tone(c, o, t + i * 0.035, NOTE(72 + i * 2), 0.04, 'square', 0.5, { lp: 3000 }); return 0.4; },
    join: function (c, o, t) { tone(c, o, t, 660, 0.07, 'sine', 0.9); tone(c, o, t + 0.08, 990, 0.12, 'sine', 0.9); return 0.24; },
    theme: function (c, o, t) {            // original jingle, about 7 s
      var beat = 60 / 140;
      var mel = [[67, .5], [72, .5], [76, .5], [79, .5], [81, 1], [79, .5], [76, .5], [77, .5], [74, .5], [77, .5], [81, .5], [79, 1.5], [0, .5],
                 [76, .5], [79, .5], [84, .5], [83, .5], [81, .5], [79, .5], [76, .5], [74, .5], [72, .5], [76, .5], [79, .5], [74, .5], [72, 2]];
      var s = t;
      mel.forEach(function (n) { if (n[0]) { tone(c, o, s, NOTE(n[0]), n[1] * beat * 0.55, 'square', 0.32, { lp: 2600, hold: n[1] * beat * 0.35 }); tone(c, o, s, NOTE(n[0]) * 2, n[1] * beat * 0.4, 'sine', 0.1); } s += n[1] * beat; });
      var bass = [48, 45, 41, 43, 48, 45, 41, 43, 48];
      bass.forEach(function (m, i) { for (var k = 0; k < 4 && i * 2 + k * 0.5 < 18; k++) tone(c, o, t + (i * 2 + k * 0.5) * beat, NOTE(k % 2 ? m + 7 : m), beat * 0.35, 'triangle', 0.5); });
      for (var b = 0; b < 32; b++) { var tt = t + b * beat * 0.5; noise(c, o, tt, 0.03, b % 2 ? 0.12 : 0.18, { type: 'highpass', f: 7000 }); if (b % 4 === 0) tone(c, o, tt, 120, 0.14, 'sine', 0.6, { to: 50 }); }
      return s - t + 0.6; }
  };

  // ---------- sample playback (classic profile only) ----------
  var cache = {}, themeEl = null;
  function sample(name) {
    if (!SAMPLES || !SAMPLES.files[name]) return null;
    if (!cache[name]) { var a = new Audio(SAMPLES.base + SAMPLES.files[name]); a.preload = 'auto'; cache[name] = a; }
    return cache[name];
  }
  function playSample(name, rate) {
    var a = sample(name); if (!a) return false;
    try { a = a.cloneNode(); a.volume = (SAMPLES.volume || {})[name] != null ? SAMPLES.volume[name] : 0.9;
          if (rate) { a.playbackRate = rate; if ('preservesPitch' in a) a.preservesPitch = false; }
          var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    return true;
  }
  function synth(name) {
    var c = actx(); if (!c || !V[name]) return;
    var g = c.createGain(); g.gain.value = LEVEL[name] || 0.5; g.connect(master);
    var len = V[name](c, g, c.currentTime + 0.005);
    setTimeout(function () { try { g.disconnect(); } catch (e) {} }, (len + 0.5) * 1000);
    return g;
  }
  function play(name) {
    counts[name] = (counts[name] || 0) + 1;
    if (muted) return;
    if (playSample(name)) return;
    synth(name);
  }
  var tickN = 0;
  function tickTock() {
    if (muted) return;
    var odd = tickN++ % 2;
    if (playSample('clock', odd ? 0.72 : 1.0)) return;
    synth(odd ? 'tock' : 'tick');
  }
  function whistle() { window.OOOAudio.whistles = (window.OOOAudio.whistles || 0) + 1; if (!muted) synth('whistle'); }
  function themeStart() {
    if (muted) return;
    var a = sample('theme');
    if (a) { try { themeEl = themeEl || a.cloneNode(); themeEl.volume = (SAMPLES.volume || {}).theme || 0.55; themeEl.currentTime = 0; var p = themeEl.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} return; }
    themeStop(); themeBus = synth('theme');
  }
  function themeStop() {
    try { if (themeEl) themeEl.pause(); } catch (e) {}
    if (themeBus && ctx) { try { themeBus.gain.setTargetAtTime(0, ctx.currentTime, 0.05); var b = themeBus; setTimeout(function () { b.disconnect(); }, 400); } catch (e) {} themeBus = null; }
  }
  function unlock() { if (SAMPLES) Object.keys(SAMPLES.files).forEach(sample); actx(); }
  function setMuted(m) { muted = !!m; try { localStorage.setItem('ooo.mute', muted ? '1' : '0'); } catch (e) {} if (muted) themeStop(); }
  // Offline render of one voice (used by tools/measure_audio.py to normalize levels).
  function measure(name) {
    var O = window.OfflineAudioContext; var len = 8, c = new O(1, 44100 * len, 44100), g = c.createGain(); g.gain.value = 1; g.connect(c.destination);
    var dur = V[name](c, g, 0.01);
    return c.startRendering().then(function (buf) {
      var d = buf.getChannelData(0), n = Math.min(d.length, Math.ceil((dur + 0.02) * 44100)), pk = 0, ss = 0;
      for (var i = 0; i < n; i++) { var v = Math.abs(d[i]); if (v > pk) pk = v; ss += d[i] * d[i]; }
      return { name: name, dur: dur, peak: pk, rms: Math.sqrt(ss / n) };
    });
  }
  window.OOOAudio = { counts: counts, whistle: whistle, tickTock: tickTock, play: play, themeStart: themeStart, themeStop: themeStop, unlock: unlock,
                      setMuted: setMuted, isMuted: function () { return muted; }, voices: Object.keys(V), measure: measure, LEVEL: LEVEL };
})();
