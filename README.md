# Scrambled Order (working title)

**Scrambled Order** is a fan-inspired, original word-scramble game show for the browser. It is inspired by a late-1990s web game show. It is **not affiliated with, endorsed by or connected to BoxerJam** or any rights holder. The public build's art, sounds, music, puzzles and code are all new: the art is vector drawings made in code, and the sounds are synthesized live with WebAudio.

The title can be changed in `js/profile.js`, or with `GAME_TITLE="My Title" npm start`.

## Play
* **Offline solo:** open `index.html` (works from `file://`).
* **Solo + multiplayer:** `npm install && npm start`, then open http://localhost:8080 (or set `PORT=`).

## Rules
* There are 4 rounds of 3 puzzles, and each puzzle has its own clock. Tuki the toucan and Flora the flamingo walk a tightrope toward each other, rocking on every beat.
* Type the **first three letters** of an answer and the rest fills in. A wrong chunk ends your turn and the birds fall. If the birds meet, they crash, fall, and the answers are revealed.
* **Type-ahead:** keep typing while a word fills in. `YELBLU` solves YELLOW, then BLUE.
* **R1** is one clue and one word (some puzzles have missing letters instead of a scramble). **R2** is three answers in any order. **R3** is a story with scrambled phrases. **R4** is a 10–20 word passage with every 4+ letter word scrambled. Storybooks are solved in order.
* Faster answers score more.

## Multiplayer (2–6 players)
* **Rooms and lobby:** create a room to get a 4-letter code or share link (`/r/CODE`), set a nickname, and chat in the lobby. The host presses Start.
* **Fair play:** the server owns the clock, checks every letter and keeps score. Answers are never sent before a word is solved.
* **Standings:** live standings show between puzzles, with final standings and dancing letter-tile mascots at the end.
* **Connections:** if you drop or reload, you rejoin your seat. If the host leaves, the host role passes to another player.

Also included: How to Play, Settings, mute, and local high scores.

## Build profiles
* **public** (default): `js/profile.js`, with art in `assets/svg/` + `js/art.js` and synthesized sound in `js/audio.js`. It ships no sampled audio or raster art.
* **classic** (private, personal use): `PROFILE=classic npm start` uses the separate `classic/` folder (original extracted assets, `classic/profile.js`, `classic/classic.css`). It is **never** included in the public zip or the Docker image (see `.dockerignore`). `tools/package.py` builds both zips, and `tools/check_public.py` hash-checks that no classic asset is in the public bundle or the Docker context.

## Tests
* `npm test`: engine unit tests and server tests (WebSocket clients, a full game, reconnects, host migration, and a check that public builds don't serve classic files).
* Browser tests (Python Playwright + Chrome):
  * `python tools/e2e.py http://localhost:8080/`: desktop solo.
  * `python tools/e2e_mobile.py`: phone, offline.
  * `python tools/e2e_multi.py http://localhost:8080`: 3 browsers, one room, full game.
* `python tools/measure_audio.py`: prints sound levels for normalization.
* Art source: `python3 tools/make_art.py` regenerates `assets/svg/`.

## Deploying (not done yet)
Any host that runs one long-lived Node process with WebSockets will work. It reads `PORT`, the health check is `/healthz`, and a `Dockerfile` is included. Rooms live in memory, so run a **single instance**.
* **Render:** New Web Service. Build `npm install`, start `npm start`, health path `/healthz`.
* **Railway:** deploy from the repo. It runs `npm start` and sets `PORT` itself. Add a domain under Networking.
* **Fly.io:** run `fly launch` (it uses the Dockerfile, internal port 8080), then `fly deploy`. Keep a single machine.
