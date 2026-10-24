"""Renders every synthesized voice offline in headless Chrome and prints the LEVEL multipliers
that bring each to about -20 dBFS RMS (peaks capped at 0.9). Paste them into js/audio.js."""
import json, math
from playwright.sync_api import sync_playwright
TARGET = 10 ** (-20 / 20)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(); pg.goto('file:///workspace/ooo-web/index.html'); pg.wait_for_function('window.OOOAudio')
    res = pg.evaluate('Promise.all(OOOAudio.voices.map(n=>OOOAudio.measure(n)))')
    out = {}
    for r in res:
        lv = min(TARGET / max(r['rms'], 1e-6), 0.9 / max(r['peak'], 1e-6))
        out[r['name']] = round(lv, 2)
        print('%-8s dur %.2fs peak %.2f rms %.3f (%.1f dBFS) -> level %.2f' % (r['name'], r['dur'], r['peak'], r['rms'], 20 * math.log10(max(r['rms'], 1e-9)), lv))
    print(json.dumps(out)); b.close()
