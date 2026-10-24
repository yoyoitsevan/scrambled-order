"""Classic-profile smoke test (private build): PROFILE=classic node server/server.js, then
python tools/e2e_classic.py http://localhost:PORT/ . Checks the original assets load and a word solves."""
import sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8781/'
G = 'window.OOO.game'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 800, 'height': 600}); errs = []; bad = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)
    pg.goto(URL + '?fast=1&seed=21'); pg.wait_for_function('window.OOO && window.OOO.ready'); pg.wait_for_timeout(800)
    assert pg.evaluate('OOO_PROFILE.id') == 'classic'
    assert pg.evaluate("document.querySelector('#logoFrame img').naturalWidth") > 0
    pg.screenshot(path='classic/screenshots/classic-title.png')
    pg.click('#btnPlay', force=True); pg.wait_for_function(G + ".phase==='playing'", timeout=15000)
    t = pg.evaluate(G + '.unsolved()[0]'); pg.keyboard.type(t['key'].lower(), delay=30); pg.wait_for_timeout(len(t['answer']) * 45 + 300)
    pg.screenshot(path='classic/screenshots/classic-round1.png')
    assert pg.evaluate(G + '.score') > 0
    assert not errs and not bad, (errs, bad)
    print('classic e2e ok')
    b.close()
