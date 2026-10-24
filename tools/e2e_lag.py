"""Latency fairness e2e: two browsers play one multiplayer game; B goes through tools/lagproxy.js with
ONE_WAY ms each way (RTT = 2x), A connects directly. Both bots react the same REACT ms after the puzzle
appears on THEIR screen and type the key one letter every 60 ms. Checks that both see the puzzle at
the same moment, both clocks run out at the same moment, both earn the same points, and B stays smooth.
Usage: python tools/e2e_lag.py [base-url] [one_way_ms]   (classic: CLASSIC_PW=... for login + app key)
Env: EXPECT_FAIR=1 asserts; FAST=0 real timings; JITTER=ms random extra delay; PUZZLES=n (default 6)
HINTS=1: play the whole game. Rounds 1-2 are solved outright; in the storybooks each bot solves one word, then
at 70% of the clock starts another (first letter, the rest 1.5 s later: its value is frozen meanwhile) and lets
the clock run out, so both see every auto-reveal. Checks both get the same reveals at the same moment, the same
on-screen word value at each reveal, and the same points."""
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
HINTS = os.environ.get('HINTS') == '1'
AGENT = """(() => { const WORDS = %s, REACT = %d, HINTS = %s;
  function solve(t) { const clue = t.clue.toUpperCase(); let c;
    if (t.style === 'missing') { const rx = new RegExp('^' + clue.replace(/_/g, '.') + '$'); c = WORDS.filter(w => rx.test(w)); }
    else { const s = clue.split('').sort().join(''); c = WORDS.filter(w => w.length === t.len && w.split('').sort().join('') === s && w !== clue);
           if (!c.length) c = WORDS.filter(w => w.split('').sort().join('') === s); }
    return c.sort()[0] || 'QZX'; }
  const R = window._lag = { shown: [], deadline: [], pts: [], fr: [], typedAt: [], rev: [], revAt: [], revPts: [], done: false }; let g = null, last = 0;
  function type(game, key, then) { let i = 0; (function k() { if (i < key.length) { R.typedAt.push(Date.now()); game.feed(key[i++]); setTimeout(k, 60); } else if (then) then(); })(); }
  function attach(game) { g = game; game.on(ev => {
      if (ev.type === 'puzzle') { const now = Date.now(); R.shown.push(now); R.deadline.push(now + (game.endsAt - game.net.serverNow()));
        const p = ev.puzzle, story = p.kind === 'story' || p.kind === 'storyAll';
        const keys = (HINTS && !story ? game.unsolved() : game.unsolved().slice(0, 1)).map(t => solve(t).slice(0, 3).toLowerCase()).join('');
        setTimeout(() => type(game, keys), REACT);
        if (HINTS && story) setTimeout(() => { const u = game.unsolved()[1] || game.unsolved()[0]; if (!u || game.puzzle !== p) return;
          const key = solve(u).slice(0, 3).toLowerCase(); type(game, key[0]); setTimeout(() => type(game, key.slice(1)), 1500); }, 0.7 * game.timeTotal); }
      if (ev.type === 'reveal') { R.rev.push(game.round.round + '.' + game.puzzleIdx + ':' + ev.answer); R.revAt.push(Date.now());
        const pn = game.pointsNow(); R.revPts.push(pn ? pn.points : null); }
      if (ev.type === 'finished') R.done = true;
      if (ev.type === 'solved') R.pts.push(ev.points);
      if (ev.type === 'timeout') R.pts.push(0); }); }
  (function f(t) { if (window.OOO && window.OOO.game && window.OOO.game !== g && window.OOO.game.multiplayer) attach(window.OOO.game);
    if (last && g && g.phase === 'playing') R.fr.push(t - last); last = t; requestAnimationFrame(f); })(0);
})();""" % (json.dumps(sorted(words)), REACT, 'true' if HINTS else 'false')
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
        if HINTS:
            A.wait_for_function("window._lag.done", timeout=600000); B.wait_for_function("window._lag.done", timeout=60000)
        else:
            A.wait_for_function(f"window._lag.pts.length >= {PUZZLES} ", timeout=180000)
            B.wait_for_function(f"window._lag.pts.length >= {PUZZLES}", timeout=60000)
        ra, rb = A.evaluate('window._lag'), B.evaluate('window._lag')
        n = min(len(ra['shown']), len(rb['shown']), 12 if HINTS else PUZZLES)
        np_ = len(ra['pts']) if HINTS else n
        show = [rb['shown'][i] - ra['shown'][i] for i in range(n)]
        dead = [rb['deadline'][i] - ra['deadline'][i] for i in range(n)]
        fr = rb['fr'][10:]
        out = {'live': LIVE, 'one_way_ms': 0 if LIVE else ONE_WAY, 'jitter_ms': JITTER, 'rtt_ms_seen_by_far_client': B.evaluate("window.OOO.net.rtt || null"),
               'puzzle_shown_skew_ms(far-near)': show, 'clock_deadline_skew_ms(far-near)': [round(x) for x in dead],
               'points_near': ra['pts'][:np_], 'points_far': rb['pts'][:np_],
               'far_frame_ms_median': round(statistics.median(fr), 1) if fr else None, 'far_long_frames_over_50ms': sum(1 for x in fr if x > 50)}
        if HINTS:
            out.update({'reveals_near': ra['rev'], 'reveals_far': rb['rev'], 'reveal_skew_ms(far-near)': [rb['revAt'][i] - ra['revAt'][i] for i in range(min(len(ra['revAt']), len(rb['revAt'])))],
                        'word_value_at_reveal_near': ra['revPts'], 'word_value_at_reveal_far': rb['revPts']})
        print(json.dumps(out))
        errs = A._errs + B._errs; assert not errs, errs
        if os.environ.get('EXPECT_FAIR'):
            assert all(abs(x) <= 120 for x in show), ('puzzle shown at different moments', show)
            assert all(abs(x) <= 120 for x in dead), ('clocks run out at different moments', dead)
            assert ra['pts'][:np_] == rb['pts'][:np_], ('unequal points for equal play', ra['pts'][:np_], rb['pts'][:np_])
            if HINTS:
                assert ra['rev'] and ra['rev'] == rb['rev'], ('different reveals', ra['rev'], rb['rev'])
                assert all(abs(x) <= 120 for x in out['reveal_skew_ms(far-near)']), ('reveals at different moments', out['reveal_skew_ms(far-near)'])
                assert all(x is not None and y is not None and abs(x - y) <= 5 for x, y in zip(ra['revPts'], rb['revPts'])), ('different word values', ra['revPts'], rb['revPts'])
                assert len(ra['pts']) == len(rb['pts']) >= 12, ('both scored the same words', ra['pts'], rb['pts'])
            print('lag fairness ok')
        b.close()
finally:
    if proxy: proxy.kill()
