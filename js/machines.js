/*
 * Scrambled Order - explicit state machines shared by the server and the browser.
 * One table per machine: the state names and the transitions that actually happen.
 * A self-transition (from === to) is always allowed so a repeated message is a no-op.
 *
 * Apply a move with Machines.apply(name, obj, key, next). It returns {ok, state, error}
 * and writes obj[key] only when the move is allowed. Timers must no-op when the
 * state they captured is no longer current (see Room.later).
 *
 * Game.reset() is the one edge outside a table: it forces the solo phase back to
 * 'idle' from anywhere, because "start over" is not a step in the round.
 *
 * PuzzleState (engine.js) is a reducer, not a stored status. Its label() is derived
 * from failed / buffer / unsolved: ready, buffering, failed, complete.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OOOMachines = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MACHINES = {
    // Server room lifecycle (server/room.js state). The clock, reveals and
    // "everyone is done" timer only run in 'playing'; they no-op after it leaves.
    room: {
      initial: 'lobby',
      transitions: {
        lobby: ['countdown'],
        countdown: ['intro'],
        intro: ['playing'],
        playing: ['reveal'],
        reveal: ['playing', 'intro', 'finished'],   // next puzzle, next round, or game over
        finished: ['lobby']
      }
    },
    // One player's puzzle status (server/room.js player.status, mirrored on the client).
    // 'idle' is the lobby / between-games seat. The client may also adopt whatever
    // status the server reports on rejoin (Machines.adopt), which is a sync, not a step.
    player: {
      initial: 'idle',
      transitions: {
        idle: ['playing'],
        playing: ['done', 'out', 'timeout', 'idle'],
        done: ['playing', 'idle'],
        out: ['playing', 'idle'],
        timeout: ['playing', 'idle']
      }
    },
    // Solo Game.phase and multiplayer RemoteGame.phase. Same names, so the UI
    // can render either. Extra edges out of 'countdown' are multiplayer rejoin:
    // a fresh RemoteGame starts at 'countdown' and then lands on the server's state.
    // 'roundIntro' → 'feedback' is a late puzzleEnd (the card was still up).
    phase: {
      initial: 'idle',
      remoteInitial: 'countdown',
      transitions: {
        idle: ['countdown'],
        countdown: ['roundIntro', 'playing', 'feedback', 'finished'],
        roundIntro: ['playing', 'feedback'],
        playing: ['feedback'],
        feedback: ['playing', 'roundIntro', 'finished'],
        finished: []
      }
    },
    // Browser WebSocket (js/net.js Net.status).
    // 'open' → 'connecting' is a send that races a socket already closing.
    net: {
      initial: 'idle',
      transitions: {
        idle: ['connecting', 'auth'],
        connecting: ['open', 'closed', 'auth'],
        open: ['closed', 'auth', 'connecting'],
        closed: ['connecting', 'auth'],
        auth: ['connecting']
      }
    },
    // One socket's membership (server/server.js). create/join only from 'out'.
    seat: {
      initial: 'out',
      transitions: {
        out: ['in'],
        in: ['out']
      }
    },
    // Which full-screen panel is showing (js/ui.js stage data-screen).
    // Modals are a separate machine; they do not change the screen.
    screen: {
      initial: 'title',
      transitions: {
        title: ['lobby', 'countdown'],
        lobby: ['title', 'countdown', 'intro', 'play', 'end'],
        countdown: ['intro', 'play', 'lobby'],          // 'play': puzzle arrived before the intro card
        intro: ['play', 'lobby'],
        play: ['intro', 'end', 'lobby'],
        end: ['title', 'lobby', 'countdown']
      }
    },
    // Tightrope birds (js/ui.js). 'crash' → 'walk' is the next puzzle clearing the fall timer.
    bird: {
      initial: 'walk',
      transitions: {
        walk: ['frozen', 'fallen', 'crash'],
        frozen: ['walk'],
        fallen: ['walk'],
        crash: ['fallen', 'walk']
      }
    },
    // At most one modal. Opening another replaces it.
    modal: {
      initial: 'none',
      transitions: {
        none: ['help', 'settings', 'scores', 'key'],
        help: ['none', 'settings', 'scores', 'key'],
        settings: ['none', 'help', 'scores', 'key'],
        scores: ['none', 'help', 'settings', 'key'],
        key: ['none', 'help', 'settings', 'scores']
      }
    },
    // Create / join / start. 'pending' ignores a second click until the server answers.
    lobbyForm: {
      initial: 'idle',
      transitions: {
        idle: ['pending'],
        pending: ['idle']
      }
    }
  };

  function spec(name) {
    var m = MACHINES[name];
    if (!m) throw new Error('unknown machine ' + name);
    return m;
  }
  function known(name, state) {
    return !!spec(name).transitions[state];
  }
  function allows(name, from, to) {
    var t = spec(name).transitions[from];
    if (!t) return false;
    return from === to || t.indexOf(to) >= 0;
  }
  function step(name, from, to) {
    if (!allows(name, from, to)) {
      return { ok: false, state: from, error: name + ': ' + from + ' → ' + to + ' is not allowed' };
    }
    return { ok: true, state: to };
  }
  // Write obj[key] when the move is allowed. The only way those fields should change.
  function apply(name, obj, key, to) {
    var r = step(name, obj[key], to);
    if (r.ok) obj[key] = to;
    return r;
  }
  // Snapshot sync: take a state the server already decided, if it is a real state.
  function adopt(name, obj, key, to) {
    if (!known(name, to)) return { ok: false, state: obj[key], error: name + ': unknown state ' + to };
    obj[key] = to;
    return { ok: true, state: to };
  }
  function states(name) { return Object.keys(spec(name).transitions); }

  return { MACHINES: MACHINES, known: known, allows: allows, step: step, apply: apply, adopt: adopt, states: states };
});
