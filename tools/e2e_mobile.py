"""Mobile (touch) + offline file:// test: solo works with no server, multiplayer explains itself."""
import re
from playwright.sync_api import sync_playwright
G = 'window.OOO.game'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(**p.devices['iPhone 13 landscape'])
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: reqs.append(r.url))
    pg.goto('file:///workspace/ooo-web/index.html?fast=1&seed=5'); pg.wait_for_function('window.OOO && window.OOO.ready')
    pg.tap('#btnMulti', force=True); pg.wait_for_timeout(200)
    msg = pg.text_content('#lobbyMsg'); assert 'server' in msg, msg
    pg.screenshot(path='screenshots/20-mobile-offline-multiplayer-note.png')
    pg.tap('#btnLobbyBack', force=True)
    pg.tap('#btnPlay', force=True); pg.wait_for_selector('#screen-play', state='visible', timeout=15000)
    pg.wait_for_function(G + ".phase==='playing'"); pg.wait_for_timeout(200)
    pg.tap('#greenBox', force=True)                       # tapping anywhere keeps the typebox active
    t = pg.evaluate(G + '.unsolved()[0]')
    pg.keyboard.type(t['key'][:2], delay=40); pg.keyboard.press('Backspace'); pg.keyboard.press('Backspace')   # mobile-style backspace on the sentinel
    assert pg.evaluate(G + '.buffer()') == '', pg.evaluate(G + '.buffer()')
    pg.keyboard.type(t['key'], delay=40); pg.wait_for_timeout(len(t['answer']) * 45 + 300)
    pg.screenshot(path='screenshots/21-mobile-landscape-solved.png')
    score = pg.evaluate(G + '.score'); assert score >= 100, score
    pg.wait_for_function(G + ".phase==='playing'", timeout=8000)
    pg.keyboard.type('qzx', delay=40); pg.wait_for_timeout(300)
    assert pg.evaluate(G + '.lastResult.status') == 'wrong'
    pg.wait_for_function(G + ".phase==='playing'", timeout=8000)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    pg.screenshot(path='screenshots/22-mobile-portrait.png')
    assert not errs, errs
    leaked = [u for u in reqs if re.search(r'/classic/|\.(wav|gif|png)(\?|$)', u)]
    assert reqs and not leaked, ('public build requested classic/raster assets', leaked)
    assert pg.evaluate('OOO_PROFILE.id') == 'public'
    print('mobile ok: score', score)
    b.close()
