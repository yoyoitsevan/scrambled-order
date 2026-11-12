# State machines

Scrambled Order's lifecycle is a handful of explicit machines in [`js/machines.js`](../js/machines.js).
That file is the only list of state names and allowed transitions. The server and the browser both
load it. There is no state-machine library: `Machines.apply(name, obj, key, next)` writes `obj[key]`
when the move is allowed and leaves it alone when it is not.

A repeated move (`from === to`) is always allowed, so a duplicate message is a no-op.

`Game.reset()` is the one move outside a table. It forces the solo phase back to `idle` from
anywhere, because starting over is not a step in the round.

## Room (`server/room.js`, `state`)

`lobby → countdown → intro → playing → reveal → playing | intro | finished → lobby`

| From | To | When |
| --- | --- | --- |
| lobby | countdown | Host starts, with at least two players connected |
| countdown | intro | Countdown timer |
| intro | playing | Round card timer |
| playing | reveal | Buzzer (after latency grace) or every connected player is done |
| reveal | playing | Another puzzle in this round |
| reveal | intro | Next round |
| reveal | finished | Last puzzle |
| finished | lobby | Host presses Back to lobby |

`Room.later` keeps a single timer and an epoch. The callback no-ops if the room has moved on, so a
countdown, buzzer, or "everyone is done" timer cannot fire in the wrong state. `backToLobby` clears
that timer too.

Joining a game that has already started is refused. Rejoining with your token is allowed in every
state. The snapshot carries what that state needs to paint: `countdownEndsAt`, the public puzzle,
and (only once the puzzle is over) `answers` plus standings.

## Player (`server/room.js` `player.status`, client `myStatus`)

`idle → playing → done | out | timeout → playing | idle`

`idle` is the seat in the lobby and on the final screen. `playing` is the live puzzle. `done` solved
it, `out` missed a chunk, `timeout` was still typing at the buzzer. The next puzzle returns any of
those to `playing`. Back to lobby, or the host starting again, returns them to `idle`.

The client copies the server's status with `Machines.adopt` on progress and on rejoin. That is a
sync, not a step: the server already decided. It will not adopt `playing` until the puzzle card is
actually up, so a roster for the next puzzle cannot unlock the keyboard early.

## Phase (`js/engine.js` `Game.phase`, `js/net.js` `RemoteGame.phase`)

`idle → countdown → roundIntro → playing → feedback → playing | roundIntro | finished`

Solo and multiplayer use the same names, so one UI renders both. A new `RemoteGame` starts at
`countdown` (the table's `remoteInitial`). From there a rejoin may land on `playing`, `feedback`,
or `finished`, because the snapshot skips the steps this client was not around for.

Solo `Game._phase` throws if a move is not in the table. The multiplayer client ignores a move that
is not in the table, so a late or repeated packet cannot skip the reveal.

## Seat (`server/server.js`)

`out → in → out`

`create` and `join` are handled only while the socket is `out`. A second create on the same socket
does not open another room. `leave` returns the socket to `out`.

## Connection (`js/net.js` `Net.status`)

`idle → connecting → open → closed → connecting`

`auth` is the password gate (private app builds only): `idle` or `closed` or `connecting` or `open`
can enter it, and a good password leaves it for `connecting`. `open → connecting` is a send that
races a socket already closing.

While a room is open, `closed` and `connecting` show "reconnecting" on the lobby, the countdown,
the round card, the puzzle, and the final screen.

## Screen (`js/ui.js`)

`title`, `lobby`, `countdown`, `intro`, `play`, `end`

`setScreen` is the only writer. The edges are the clicks and the server events that actually happen,
including rejoin (lobby straight to the in-progress panel) and the host sending everyone back to
the lobby. A move that is not listed is ignored.

## Birds, modals, lobby form (`js/ui.js`)

* **bird:** `walk → frozen | fallen | crash`. `crash → fallen` when the crash pose finishes, or
  `crash → walk` when the next puzzle clears that timer. `frozen` and `fallen` return to `walk`
  when the next puzzle resets the rope.
* **modal:** `none`, `help`, `settings`, `scores`, `key`. One is open at a time; opening another
  replaces it. Opening the first one pauses a solo puzzle; closing the last one resumes.
* **lobbyForm:** `idle → pending → idle`. Create, join, and start ignore a second click until the
  server answers (joined, a room that has left the lobby, an error, or the socket dropping).

## Attempt (`js/engine.js` `PuzzleState.label`)

Not stored. Derived from `failed`, the buffer, and the unsolved words, so it cannot drift:

`ready → buffering → ready` (every third letter is judged) and `ready | buffering → failed | complete`.

## Left as they are

The typebox fill queue (`js/ui.js`) is an animation playlist, not a game lifecycle. Turning it into
a machine would not change what players can do. Chat flood control stays a timestamp check.

## Adding a machine

1. Add a key to `MACHINES` in `js/machines.js`: `initial` plus `transitions` (every state must be a key).
2. Keep the current state in one field. Change it only with `Machines.apply` (or `adopt` for a server snapshot).
3. If a timer can outlive the state, capture the epoch (or generation) and no-op when it has moved.
4. Add the edges to the table test in `tools/test-machines.js`. A new edge that is not listed fails that test; a code path that takes an unlisted edge fails it too.
