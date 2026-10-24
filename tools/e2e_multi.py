"""Multiplayer e2e: 3 headless browsers join one room (create / share link / typed code), chat,
play a full fast-mode game against the real server, one reloads mid-game (reconnect), and the
host takes everyone back to the lobby. Usage: python tools/e2e_multi.py [base-url]"""
import sys, re, time, json
from playwright.sync_api import sync_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8780').rstrip('/')
OUT = 'screenshots/'; G = 'window.OOO.game'

# The bots only see what a real player sees (scrambles / blanks); they solve them like a human
# would, from a word list. The server never sends answers before a word is solved.
data = json.load(open('data/puzzles.json'))
words = set()
def walk(o):
    if isinstance(o, str): words.update(w for w in re.findall(r'[A-Z]+', o.upper()) if len(w) >= 3)
    elif isinstance(o, list): [walk(x) for x in o]
    elif isinstance(o, dict): [walk(v) for k, v in o.items() if k != '_readme']
walk(data['rounds'])
def solve(t):
    clue = t['clue'].upper()
    if t['style'] == 'missing':
        rx = re.compile('^' + clue.replace('_', '.') + '$'); c = [w for w in words if rx.match(w)]
    else:
        c = [w for w in words if len(w) == t['len'] and sorted(w) == sorted(clue) and w != clue] or [w for w in words if sorted(w) == sorted(clue)]
    return sorted(c)[0] if c else 'QZX'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    errs = []; reqs = []; pages = []
    for i in range(3):
        ctx = b.new_context(viewport={'width': 800, 'height': 600}); pg = ctx.new_page()
        pg.on('pageerror', lambda e, i=i: errs.append((i, str(e))))
        pg.on('request', lambda r: reqs.append(r.url))
        pg.on('console', lambda m, i=i: errs.append((i, m.text)) if m.type == 'error' else None)
        pages.append(pg)
    A, B, C = pages
    A.goto(BASE + '/?fast=1'); A.wait_for_function('window.OOO && window.OOO.ready')
    A.click('#btnMulti'); A.fill('#nick', 'Ann'); A.screenshot(path=OUT + '30-lobby-join.png'); A.click('#btnCreate')
    A.wait_for_function("/^[A-Z]{4}$/.test(document.getElementById('roomCode').textContent)")
    code = A.text_content('#roomCode'); link = A.text_content('#roomLink')
    assert link.endswith('?room=' + code), link
    B.goto(BASE + '/r/' + code + '?fast=1'); B.wait_for_function('window.OOO && window.OOO.ready')     # shareable link
    assert B.input_value('#joinCode') == code
    B.fill('#nick', 'Bo'); B.click('#btnJoin')
    C.goto(BASE + '/?fast=1'); C.wait_for_function('window.OOO && window.OOO.ready')
    C.click('#btnMulti'); C.fill('#nick', 'Cy'); C.fill('#joinCode', code.lower()); C.click('#btnJoin')
    A.wait_for_function("document.querySelectorAll('#playerList li').length===3")
    assert B.is_hidden('#btnStart') and A.is_enabled('#btnStart')
    B.fill('#chatInput', 'hi all, ready when you are!'); B.press('#chatInput', 'Enter')
    C.fill('#chatInput', 'lets go'); C.press('#chatInput', 'Enter')
    A.wait_for_function("document.getElementById('chatLog').textContent.includes('lets go')")
    A.screenshot(path=OUT + '31-lobby-room.png')
    A.click('#btnStart')

    shots = set(); stats = {'bursts': 0, 'solvedEvents': 0, 'reloaded': False, 'wrong': 0}
    def shot(pg, k, name):
        if k not in shots: pg.screenshot(path=OUT + name); shots.add(k)
    last_typed = [None, None, None]
    deadline = time.time() + 400
    while time.time() < deadline:
        scr = [pg.get_attribute('#stage', 'data-screen') for pg in pages]
        if all(s == 'end' for s in scr): break
        for n, pg in enumerate(pages):
            if scr[n] == 'play' and pg.is_visible('#standings'):
                shot(pg, 'board%d' % n, '33-mp-scoreboard.png' if n == 0 else '33-mp-scoreboard-%s.png' % 'ABC'[n])
            st = pg.evaluate("(()=>{const g=window.OOO.game;if(!g||!g.multiplayer)return null;const r=g.currentRound();return {ph:g.phase,my:g.myStatus,r:r&&r.round,i:g.puzzleIdx,id:g.endsAt}})()")
            if not st or st['ph'] != 'playing' or st['my'] != 'playing': continue
            key = (st['r'], st['i'], st['id'])
            if last_typed[n] == key: continue
            last_typed[n] = key
            un = pg.evaluate(G + '.unsolved()')
            if n == 2 and st['r'] == 2 and st['i'] == 0 and not stats['reloaded']:
                pg.reload(); pg.wait_for_function("window.OOO && window.OOO.game && window.OOO.game.phase==='playing'", timeout=15000)
                stats['reloaded'] = True; last_typed[n] = None; continue   # rejoins the same seat, same puzzle
            if n == 0 and st['r'] == 4: shot(pg, 'r4', '34-mp-round4-storybook.png')
            if n == 2 and st['r'] == 3 and st['i'] == 2:
                pg.keyboard.type('qzx', delay=20); stats['wrong'] += 1; continue
            if n == 1 and len(un) > 1:
                pg.keyboard.type(solve(un[0])[:3].lower(), delay=40); continue      # Bo only gets the first word
            k = ''.join(solve(t)[:3] for t in un).lower()
            pg.keyboard.type(k, delay=8 if n == 0 else 60)                          # Ann bursts the whole puzzle (type-ahead)
            stats['bursts'] += 1
            if n == 0 and st['r'] == 2 and st['i'] == 1: pg.wait_for_timeout(150); shot(pg, 'mpplay', '32-mp-play.png')
        time.sleep(0.05)
    for pg in pages: pg.wait_for_timeout(300)
    A.screenshot(path=OUT + '35-mp-final-standings.png')
    final = A.evaluate("[...document.querySelectorAll('#finalList li')].map(l=>l.textContent)")
    print('final', final, stats)
    assert all(pg.get_attribute('#stage', 'data-screen') == 'end' for pg in pages)
    assert len(final) == 3 and 'Ann' in final[0], final
    assert stats['reloaded'] and stats['wrong'] == 1 and stats['bursts'] >= 12, stats
    assert {'board0', 'mpplay', 'r4'} <= shots, shots
    assert B.is_disabled('#btnToLobby')
    A.click('#btnToLobby')
    for pg in pages: pg.wait_for_function("document.getElementById('stage').dataset.screen==='lobby'", timeout=10000)
    C.click('#btnLeave'); A.wait_for_function("document.querySelectorAll('#playerList li').length===2")
    assert not errs, errs
    leaked = [u for u in reqs if re.search(r'/classic/|\.(wav|gif|png)(\?|$)', u)]
    assert reqs and not leaked, ('public build requested classic/raster assets', leaked)
    assert pg.evaluate('OOO_PROFILE.id') == 'public'
    print('multiplayer e2e ok: room', code)
    b.close()
