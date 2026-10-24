"""Latency fairness e2e: two browsers play one multiplayer game; B goes through tools/lagproxy.js with
ONE_WAY ms each way (RTT = 2x), A connects directly. Both bots react the same REACT ms after the puzzle
appears on THEIR screen and type the key one letter every 60 ms. Checks that both see the puzzle at
the same moment, both clocks run out at the same moment, both earn the same points, and B stays smooth.
Usage: python tools/e2e_lag.py [base-url] [one_way_ms]   (classic: CLASSIC_PW=... for login + app key)
Env: EXPECT_FAIR=1 asserts; FAST=0 real timings; JITTER=ms random extra delay; PUZZLES=n (default 6)"""
import sys, os, re, json, time, subprocess, hmac, hashlib, statistics
from playwright.sync_api import sync_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8780').rstrip('/')
ONE_WAY = int(sys.argv[2]) if len(sys.argv) > 2 else 400
LIVE = not re.search(r'://(localhost|127\.0\.0\.1):\d+$', BASE)   # a deployed site: no proxy, both connect directly
PORT = 0 if LIVE else int(re.search(r':(\d+)$', BASE).group(1)); PROXY = PORT + 6
PW = os.environ.get('CLASSIC_PW'); G = 'window.OOO.game'; REACT = 1500; PUZZLES = int(os.environ.get('PUZZLES', '6'))
data = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'puzzles.json')))
words = set()
def walk(o):
    if isinstance(o, str): words.update(w for w in re.findall(r'[A-Z]+', o.upper()) if len(w) >= 3)
    elif isinstance(o, list): [walk(x) for x in o]
    elif isinstance(o, dict): [walk(v) for k, v in o.items() if k != '_readme']
walk(data['rounds'])
AGENT = """(() => { const WORDS = %s, REACT = %d;
  function solve(t) { const clue = t.clue.toUpperCase(); let c;
    if (t.style === 'missing') { const rx = new RegExp('^' + clue.replace(/_/g, '.') + '$'); c = WORDS.filter(w => rx.test(w)); }
    else { const s = clue.split('').sort().join(''); c = WORDS.filter(w => w.length === t.len && w.split('').sort().join('') === s && w !== clue);
           if (!c.length) c = WORDS.filter(w => w.split('').sort().join('') === s); }
    return c.sort()[0] || 'QZX'; }
  const R = window._lag = { shown: [], deadline: [], pts: [], fr: [], typedAt: [] }; let g = null, last = 0;
  function attach(game) { g = game; game.on(ev => {
      if (ev.type === 'puzzle') { const now = Date.now(); R.shown.push(now); R.deadline.push(now + (game.endsAt - game.net.serverNow()));
        const t = game.unsolved()[0], key = solve(t).slice(0, 3).toLowerCase();
        setTimeout(() => { let i = 0; (function k() { if (i < key.length) { R.typedAt.push(Date.now()); game.feed(key[i++]); setTimeout(k, 60); } })(); }, REACT); }
      if (ev.type === 'solved') R.pts.push(ev.points);
      if (ev.type === 'timeout') R.pts.push(0); }); }
  (function f(t) { if (window.OOO && window.OOO.game && window.OOO.game !== g && window.OOO.game.multiplayer) attach(window.OOO.game);
    if (last && g && g.phase === 'playing') R.fr.push(t - last); last = t; requestAnimationFrame(f); })(0);
})();""" % (json.dumps(sorted(words)), REACT)
JITTER = int(os.environ.get('JITTER', '0')); Q = '/?fast=1' if os.environ.get('FAST', '1') == '1' else '/'
proxy = None if LIVE else subprocess.Popen(['node', os.path.join(os.path.dirname(__file__), 'lagproxy.js'), str(PROXY), str(PORT), str(ONE_WAY), str(JITTER)], stdout=subprocess.PIPE)
time.sleep(0 if LIVE else 0.6)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        def page(lagged, w, h):
            kw = {'viewport': {'width': w, 'height': h}}
            if PW: kw['http_credentials'] = {'username': 'friends', 'password': PW}
            if lagged: kw.update(is_mobile=True, has_touch=True)
            ctx = b.new_context(**kw); errs = []
            if lagged and not LIVE:
                init = "window.OOO_SERVER = 'ws://127.0.0.1:%d/ws';" % PROXY
                if PW:
                    label = 'scrambled-order-classic-app-v1'
                    init += "localStorage.setItem('ooo.appKey', %r);" % hmac.new(PW.encode(), label.encode(), hashlib.sha256).hexdigest()
                ctx.add_init_script(init)
            pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg._errs = errs
            pg.goto(BASE + Q); pg.wait_for_function('window.OOO && window.OOO.ready'); pg.evaluate(AGENT); return pg
        A = page(False, 800, 600); B = page(True, 390, 844)
        A.click('#btnMulti', force=True); A.fill('#nick', 'Near'); A.click('#btnCreate', force=True)
        A.wait_for_function("/^[A-Z]{4}$/.test(document.getElementById('roomCode').textContent)", timeout=90000); code = A.text_content('#roomCode')
        B.wait_for_timeout(300)
        if B.is_visible('#btnMulti'): B.click('#btnMulti', force=True)
        B.fill('#nick', 'Far'); B.fill('#joinCode', code); B.click('#btnJoin', force=True)
        B.wait_for_function(f"document.getElementById('roomCode').textContent === {code!r}", timeout=30000)
        A.wait_for_function("document.body.innerText.includes('Far')", timeout=15000)
        rtt = B.evaluate("window.OOO.net && (window.OOO.net.rtt || null)")
        A.click('#btnStart', force=True)
        A.wait_for_function(f"window._lag.pts.length >= {PUZZLES} ", timeout=180000)
        B.wait_for_function(f"window._lag.pts.length >= {PUZZLES}", timeout=60000)
        ra, rb = A.evaluate('window._lag'), B.evaluate('window._lag')
        n = min(len(ra['shown']), len(rb['shown']), PUZZLES)
        show = [rb['shown'][i] - ra['shown'][i] for i in range(n)]
        dead = [rb['deadline'][i] - ra['deadline'][i] for i in range(n)]
        fr = rb['fr'][10:]
        out = {'live': LIVE, 'one_way_ms': 0 if LIVE else ONE_WAY, 'jitter_ms': JITTER, 'rtt_ms_seen_by_far_client': B.evaluate("window.OOO.net.rtt || null"),
               'puzzle_shown_skew_ms(far-near)': show, 'clock_deadline_skew_ms(far-near)': [round(x) for x in dead],
               'points_near': ra['pts'][:n], 'points_far': rb['pts'][:n],
               'far_frame_ms_median': round(statistics.median(fr), 1) if fr else None, 'far_long_frames_over_50ms': sum(1 for x in fr if x > 50)}
        print(json.dumps(out))
        errs = A._errs + B._errs; assert not errs, errs
        if os.environ.get('EXPECT_FAIR'):
            assert all(abs(x) <= 120 for x in show), ('puzzle shown at different moments', show)
            assert all(abs(x) <= 120 for x in dead), ('clocks run out at different moments', dead)
            assert ra['pts'][:n] == rb['pts'][:n], ('unequal points for equal play', ra['pts'][:n], rb['pts'][:n])
            print('lag fairness ok')
        b.close()
finally:
    if proxy: proxy.kill()
