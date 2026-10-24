"""Portrait layout check in the simulated app (Capacitor flag), with safe areas and the keyboard open.
Usage: python portrait.py [www_index_url] [ws_url] [outdir]"""
import os, sys, time
from playwright.sync_api import sync_playwright
WWW = sys.argv[1] if len(sys.argv) > 1 else 'file:///workspace/ooo-web/index.html'
WS = sys.argv[2] if len(sys.argv) > 2 else 'ws://localhost:8780/ws'
OUT = sys.argv[3] if len(sys.argv) > 3 else '/tmp/portrait-shots'
G = 'window.OOO.game'
os.makedirs(OUT, exist_ok=True)
DEVICES = [  # name, w, h, top inset, bottom inset, keyboard height
    ('iphone-se', 375, 667, 20, 0, 260),
    ('iphone-15', 393, 852, 59, 34, 336),
    ('pixel-8', 412, 915, 24, 0, 315),
]
problems = []
def check(pg, dev, label, kb_h):
    r = pg.evaluate("""() => {
      const q = id => document.getElementById(id), vis = el => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      const R = el => el.getBoundingClientRect();
      const out = { overflow: [], outside: [] };
      const vp = R(q('viewport'));
      ['greenBox', 'clueLine', 'catBox', 'typeBox', 'instr', 'scoreBox', 'clockNum', 'roundCircle', 'orangeBoxes', 'lobbyJoin', 'lobbyRoom', 'endPanel'].forEach(id => {
        const el = q(id); if (!vis(el)) return; const b = R(el);
        if (b.left < vp.left - 1 || b.right > vp.right + 1 || b.top < vp.top - 1 || b.bottom > vp.bottom + 1) out.outside.push(id + ' ' + [b.left, b.top, b.right, b.bottom].map(Math.round));
      });
      const gb = q('greenBox'); if (vis(gb) && (gb.scrollHeight > gb.clientHeight + 1 || gb.scrollWidth > gb.clientWidth + 1)) out.overflow.push('greenBox ' + gb.scrollHeight + '>' + gb.clientHeight);
      document.querySelectorAll('.obox').forEach(b => { if (vis(b) && b.textContent && b.scrollWidth > b.clientWidth + 1) out.overflow.push('obox ' + b.textContent); });
      const gb2 = vis(gb) ? R(gb) : (vis(q('orangeBoxes')) ? R(q('orangeBoxes')) : null), ins = R(q('instr')), tb = R(q('typeBox'));
      if (gb2 && vis(q('instr')) && gb2.bottom > ins.top + 1) out.overflow.push('clue area overlaps instr');
      out.typeBottom = tb.bottom; out.vpBottom = vp.bottom; out.portrait = q('viewport').classList.contains('portrait');
      out.story = q('story').style.fontSize; out.word = q('greenWord').style.fontSize;
      return out; }""")
    if not r['portrait']: problems.append((dev, label, 'not portrait'))
    if r['overflow'] or r['outside']: problems.append((dev, label, r['overflow'], r['outside']))
    return r
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for dev, W, H, top, bot, kb in DEVICES:
        ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script("window.Capacitor = { isNativePlatform: function(){ return true; }, Plugins: {} }; window.OOO_SERVER = %r;" % WS)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(WWW + '?fast=1&seed=7'); pg.wait_for_function('window.OOO && window.OOO.ready')
        def insets(t, bt):
            pg.evaluate("([t,b]) => { const s = document.documentElement.style; s.setProperty('--safe-area-inset-top', t + 'px'); s.setProperty('--safe-area-inset-bottom', b + 'px'); window.dispatchEvent(new Event('resize')); }", [t, bt])
            pg.wait_for_timeout(150)
        def keyboard(on):   # native resize: the web view shrinks above the keyboard (no bottom inset then)
            pg.set_viewport_size({'width': W, 'height': H - kb if on else H}); insets(top, 0 if on else bot); pg.wait_for_timeout(250)
        insets(top, bot)
        pg.screenshot(path='%s/%s-01-title.png' % (OUT, dev)); check(pg, dev, 'title', 0)
        pg.tap('#btnHow', force=True); pg.wait_for_timeout(150); pg.screenshot(path='%s/%s-02-help.png' % (OUT, dev)); pg.tap('#helpModal [data-close]', force=True)
        pg.tap('#btnMulti', force=True); pg.wait_for_timeout(200); pg.focus('#nick'); keyboard(True)
        pg.fill('#nick', 'Evan'); pg.screenshot(path='%s/%s-03-lobby-keyboard.png' % (OUT, dev)); check(pg, dev, 'lobby', kb)
        pg.tap('#btnCreate', force=True)
        pg.wait_for_function("/^[A-Z0-9]{4}$/.test(document.getElementById('roomCode').textContent)", timeout=30000)
        pg.focus('#chatInput'); pg.fill('#chatInput', 'hi from the portrait layout!'); pg.press('#chatInput', 'Enter'); pg.wait_for_timeout(300)
        pg.screenshot(path='%s/%s-04-room-chat-keyboard.png' % (OUT, dev)); check(pg, dev, 'room', kb)
        pg.evaluate('document.activeElement.blur()'); keyboard(False)
        pg.screenshot(path='%s/%s-05-room.png' % (OUT, dev)); check(pg, dev, 'room-nokb', 0)
        pg.tap('#btnLeave', force=True); pg.wait_for_timeout(300); pg.tap('#btnLobbyBack', force=True)
        pg.tap('#btnPlay', force=True); pg.wait_for_selector('#screen-countdown', state='visible'); pg.wait_for_timeout(100)
        pg.screenshot(path='%s/%s-06-countdown.png' % (OUT, dev))
        shots = set(); deadline = time.time() + 200; kbon = False
        while time.time() < deadline:
            scr = pg.get_attribute('#stage', 'data-screen')
            if scr == 'end': break
            if scr == 'intro' and 'intro' not in shots: pg.screenshot(path='%s/%s-07-intro.png' % (OUT, dev)); shots.add('intro')
            ph = pg.evaluate(G + ' && ' + G + '.phase')
            if ph != 'playing': pg.wait_for_timeout(50); continue
            if not kbon: keyboard(True); kbon = True
            s = pg.evaluate('(()=>{const g=window.OOO.game;return {r:g.roundIdx+1,i:g.puzzleIdx}})()')
            key = 'r%d' % s['r']
            res = check(pg, dev, 'play r%d p%d' % (s['r'], s['i'] + 1), kb)
            if res['typeBottom'] > H - kb + 0.5: problems.append((dev, key, 'typebox under keyboard', res['typeBottom']))
            if key not in shots:
                pg.screenshot(path='%s/%s-1%d-round%d-keyboard.png' % (OUT, dev, s['r'], s['r'])); shots.add(key)
                print(dev, key, 'story font', res['story'], 'word font', res['word'], flush=True)
            if s['r'] == 1 and s['i'] == 1 and 'nokb' not in shots:
                keyboard(False); pg.screenshot(path='%s/%s-18-round1-no-keyboard.png' % (OUT, dev)); check(pg, dev, 'play nokb', 0); keyboard(True); shots.add('nokb')
            if s['r'] == 4 and s['i'] == 2 and 'r4last' not in shots:
                pg.keyboard.type(''.join(t['key'] for t in pg.evaluate(G + '.unsolved()')[:3]).lower(), delay=25); pg.wait_for_timeout(900)
                pg.screenshot(path='%s/%s-19-round4-typeahead.png' % (OUT, dev)); shots.add('r4last')
            keys = ''.join(t['key'] for t in pg.evaluate(G + '.unsolved()')).lower()
            pg.keyboard.type(keys, delay=20)
            pg.wait_for_function(G + ".phase!=='playing'", timeout=60000)
        pg.evaluate('document.activeElement && document.activeElement.blur()'); keyboard(False); pg.wait_for_timeout(600)
        pg.screenshot(path='%s/%s-20-end.png' % (OUT, dev)); check(pg, dev, 'end', 0)
        if errs: problems.append((dev, 'errors', errs))
        ctx.close()
    b.close()
print('PROBLEMS' if problems else 'portrait ok')
for x in problems: print(x)
