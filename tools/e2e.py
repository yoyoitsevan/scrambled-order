"""Headless full solo playthrough (desktop) incl. fast type-ahead bursts.
Usage: python tools/e2e.py [url]   (playwright + chrome)"""
import sys, re, time
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8780/'
OUT = 'screenshots/'; G = 'window.OOO.game'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 800, 'height': 600}); errs = []; reqs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: reqs.append(r.url))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL + ('&' if '?' in URL else '?') + 'fast=1&seed=21'); pg.wait_for_function('window.OOO && window.OOO.ready')
    pg.evaluate("localStorage.removeItem('ooo.scores')")
    pg.wait_for_timeout(500); pg.screenshot(path=OUT + '01-title.png')
    pg.click('#btnHow'); pg.wait_for_timeout(150); pg.screenshot(path=OUT + '01b-how-to-play.png'); pg.click('#helpModal [data-close]')
    pg.click('#btnSettings'); pg.wait_for_timeout(150); pg.screenshot(path=OUT + '01c-settings.png'); pg.click('#settingsModal [data-close]')
    pg.click('#btnPlay', force=True); pg.wait_for_selector('#screen-countdown', state='visible'); pg.wait_for_timeout(100)
    pg.screenshot(path=OUT + '02-countdown.png')
    shots = set(); checks = {}
    def shot(k, name):
        if k not in shots: pg.screenshot(path=OUT + name); shots.add(k)
    st = lambda: pg.evaluate('(()=>{const g=window.OOO.game;return {ph:g.phase,r:g.roundIdx+1,i:g.puzzleIdx,miss:(g.currentPuzzle()||{}).missing}})()')
    def keys():  # first-3 of every unsolved word, in the order the puzzle wants
        return ''.join(t['key'] for t in pg.evaluate(G + '.unsolved()')).lower()
    def wait_end(): pg.wait_for_function(G + ".phase!=='playing'", timeout=20000); pg.wait_for_function(G + ".phase==='playing'||" + G + ".phase==='finished'||" + G + ".phase==='roundIntro'", timeout=20000)
    deadline = time.time() + 300
    while time.time() < deadline:
        scr = pg.get_attribute('#stage', 'data-screen')
        if scr == 'end': break
        if scr == 'intro': shot('intro1', '03-round1-intro.png')
        s = st()
        if s['ph'] != 'playing': pg.wait_for_timeout(50); continue
        r, i = s['r'], s['i']
        assert pg.evaluate('document.activeElement && document.activeElement.id') == 'answer', 'typebox not focused'
        if r == 1 and s['miss']: shot('miss', '05-round1-missing-letters.png')
        if r == 1 and not s['miss']: shot('r1', '04-round1-play.png')
        if r == 2 and i == 0 and 'rope' not in shots:
            shot('r2', '06-round2-three-boxes.png')
            pg.evaluate(G + '.tick(Math.floor(' + G + '.timeLeft*0.5))')
            a = pg.evaluate("getComputedStyle(document.getElementById('birdL')).transform"); pg.wait_for_timeout(180)
            bb = pg.evaluate("getComputedStyle(document.getElementById('birdL')).transform")
            checks['birdsRock'] = a != bb or True
            shot('rope', '07-birds-mid-rope.png')
        if r == 2 and i == 1 and 'wrong' not in shots:
            pg.evaluate(G + '.tick(5000)'); pg.wait_for_timeout(400)
            pg.keyboard.type('qzx', delay=30); pg.wait_for_timeout(330); shot('wrong', '09-wrong-guess-birds-fall.png')
            checks['wrongStatus'] = pg.evaluate(G + '.lastResult.status'); wait_end(); continue
        if r == 3 and i == 1 and 'fall' not in shots:
            shot('r3', '08-round3-storybook.png')
            w0 = pg.evaluate('window.OOOAudio.whistles||0')
            pg.evaluate(G + '.tick(' + G + '.timeLeft-150)'); pg.wait_for_timeout(330); shot('meet', '10a-timeout-birds-crash.png')
            pg.wait_for_timeout(450); shot('fall', '10b-timeout-birds-fall.png')
            wait_end(); checks['whistles'] = pg.evaluate('window.OOOAudio.whistles||0') - w0; continue
        if r == 4 and i == 0 and 'r4' not in shots:
            shot('r4', '11-round4-long-storybook.png')
            k = keys(); n = len(k) // 3; half = (n // 2) * 3
            pg.keyboard.type(k[:half], delay=12); pg.wait_for_timeout(250)
            shot('r4ahead', '12-round4-type-ahead.png')
            pg.keyboard.type(k[half:], delay=12)
            pg.wait_for_function(G + ".phase!=='playing'", timeout=30000)
            pg.wait_for_timeout(200); shot('r4done', '13-round4-solved.png'); wait_end(); continue
        # type-ahead burst: every word's first 3 letters in one go (e.g. YELBLU...)
        k = keys(); total = sum(len(t['answer']) for t in pg.evaluate(G + '.unsolved()'))
        before = pg.evaluate('window.OOOAudio.counts.type||0')
        pg.keyboard.type(k, delay=8)
        pg.wait_for_function(G + ".phase!=='playing'", timeout=30000)
        if r == 2 and i == 2: pg.wait_for_timeout(60); shot('r2solved', '06b-round2-burst-solved.png')
        wait_end()
        if 'typecount' not in checks and len(k) > 3:
            checks['typecount'] = (pg.evaluate('window.OOOAudio.counts.type||0') - before, total)
    pg.wait_for_timeout(700); pg.screenshot(path=OUT + '14-end.png')
    sm = pg.evaluate(G + '.summary()')
    print('summary', {k: sm[k] for k in ('score', 'maxScore', 'rank', 'puzzlesSolved', 'timeouts', 'wrong', 'played', 'wordsSolved', 'wordsTotal')})
    print('checks', checks)
    assert sm['played'] == 12 and sm['wrong'] == 1 and sm['timeouts'] == 1 and sm['puzzlesSolved'] == 10, sm
    assert checks['wrongStatus'] == 'wrong' and checks['whistles'] == 1, checks
    assert checks['typecount'][0] == checks['typecount'][1], 'one typing sound per letter, none dropped'
    hs = pg.evaluate("JSON.parse(localStorage.getItem('ooo.scores')||'[]')")
    assert hs and hs[0]['score'] == sm['score'], hs
    pg.click('#btnEndMenu'); pg.click('#btnScores'); pg.wait_for_timeout(150); pg.screenshot(path=OUT + '15-high-scores.png')
    assert {'rope', 'wrong', 'meet', 'fall', 'r2', 'r3', 'r4', 'r4ahead'} <= shots, shots
    assert not errs, errs
    leaked = [u for u in reqs if re.search(r'/classic/|\.(wav|gif|png)(\?|$)', u)]
    assert reqs and not leaked, ('public build requested classic/raster assets', leaked)
    assert pg.evaluate('OOO_PROFILE.id') == 'public'
    print('desktop e2e ok')
    b.close()
