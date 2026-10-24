"""Generates the public build's ORIGINAL vector art into assets/svg/ (all drawn here in code).
Run: python3 tools/make_art.py"""
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'svg'); os.makedirs(OUT, exist_ok=True)
def save(name, w, h, body):
    open(os.path.join(OUT, name), 'w').write(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s</svg>\n' % (w, h, w, h, body))

FW, FH = 48, 42      # bird frame (feet touch the rope at the bottom edge)

# ---- "Tuki": a round teal toucan-ish bird with a banana beak (faces right) ----
def toucan(f):
    panic = f == 3; ox = FW * f
    wing = {0: -12, 1: -34, 2: 10}.get(f, -80)
    foot = [(0, 0), (0, -2), (-2, 0)][f % 3] if not panic else (-4, -6)
    pup = (1.0, 0.4) if not panic else (0, 0)
    s = '<g transform="translate(%d 0)">' % ox
    s += '<path d="M9 25 L1 31 L4 35 L14 31 Z" fill="#0b3d5c"/>'                                   # tail
    s += '<g stroke="#ff8c1a" stroke-width="2.2" stroke-linecap="round" fill="none">'
    s += '<path d="M18 35 L%g %g"/><path d="M24 35 L%g %g"/>' % (17 + foot[0], 41 + foot[1], 25 - foot[0], 41 + (foot[1] if panic else 0))
    s += '</g>'
    s += '<ellipse cx="21" cy="26" rx="13" ry="11.5" fill="#1fb5a8" stroke="#0b3d5c" stroke-width="1.6"/>'
    s += '<ellipse cx="25" cy="29" rx="7.5" ry="6.8" fill="#fff3c4"/>'
    s += '<circle cx="27" cy="15" r="8.5" fill="#1fb5a8" stroke="#0b3d5c" stroke-width="1.6"/>'
    s += '<circle cx="24" cy="19" r="2" fill="#ff9fc0" opacity=".85"/>'
    if panic:   # beak wide open
        s += '<path d="M33 11 C40 7 46 9 47 12 L35 15 Z" fill="#ffd23f" stroke="#0b3d5c" stroke-width="1.2"/>'
        s += '<path d="M34 16 L45 19 C42 23 37 22 33 19 Z" fill="#ff8c1a" stroke="#0b3d5c" stroke-width="1.2"/>'
    else:
        s += '<path d="M33 10.5 C40 9 46 12 47 15.5 C42 19 37 19.5 33 19 Z" fill="#ff8c1a" stroke="#0b3d5c" stroke-width="1.2"/>'
        s += '<path d="M34 11.5 C40 10.5 44.5 12.5 46 14.5 C41 13.5 37 13.6 34 14 Z" fill="#ffd23f"/>'
        s += '<path d="M44 13.2 C46 14 47 15 47 15.5 C45.7 16.6 44.7 17.2 43.6 17.6 Z" fill="#e8333a"/>'
    er = 4.3 if panic else 3.7
    s += '<circle cx="29" cy="12.5" r="%g" fill="#fff" stroke="#0b3d5c" stroke-width="1"/>' % er
    s += '<circle cx="%g" cy="%g" r="%g" fill="#111"/>' % (29 + pup[0], 12.5 + pup[1], 1.1 if panic else 1.9)
    if panic: s += '<path d="M11 6 C9 9 9 11 11 12 C13 11 13 9 11 6 Z" fill="#9be7ff" stroke="#0b3d5c" stroke-width=".7"/>'
    s += '<ellipse cx="16" cy="25" rx="8.5" ry="5" fill="#138a80" stroke="#0b3d5c" stroke-width="1.2" transform="rotate(%d 21 24)"/>' % wing
    if panic: s += '<ellipse cx="22" cy="25" rx="8" ry="4.6" fill="#16a093" stroke="#0b3d5c" stroke-width="1.1" transform="rotate(70 22 24)"/>'
    return s + '</g>'

# ---- "Flora": a lanky pink flamingo-ish bird on one leg (faces left) ----
def flamingo(f):
    panic = f == 3; ox = FW * f
    s = '<g transform="translate(%d 0)">' % ox
    if panic:
        s += '<g stroke="#d63c75" stroke-width="1.8" fill="none" stroke-linecap="round"><path d="M27 27 L22 34 L18 39"/><path d="M31 27 L37 33 L42 37"/></g>'
    else:
        tuck = f == 1
        s += '<g stroke="#d63c75" stroke-width="1.8" fill="none" stroke-linecap="round">'
        s += '<path d="M28 27 L%g 35 L28 42"/>' % (27 if f == 2 else 29)                              # standing leg
        s += ('<path d="M31 27 L37 32 L31 34"/>' if not tuck else '<path d="M31 27 L36 34 L32 37"/>')  # tucked leg
        s += '<path d="M26 42 L31 42"/></g>'
    s += '<path d="M36 17 C44 14 46 20 44 24 C41 22 39 22 36 23 Z" fill="#f2458b" stroke="#8a1d4f" stroke-width="1.1"/>'   # tail
    s += '<ellipse cx="29" cy="21" rx="10.5" ry="7" fill="#ff7bb2" stroke="#8a1d4f" stroke-width="1.5"/>'
    if panic:
        s += '<path d="M21 19 C19 13 17 9 15 4" stroke="#ff7bb2" stroke-width="4" fill="none" stroke-linecap="round"/>'
        hx, hy = 14, 4
    else:
        sway = [0, 1.5, -1.5][f]
        s += '<path d="M21 19 C%g 16 %g 9 %g 7" stroke="#8a1d4f" stroke-width="5.6" fill="none" stroke-linecap="round"/>' % (11 + sway, 22 + sway, 14 + sway)
        s += '<path d="M21 19 C%g 16 %g 9 %g 7" stroke="#ff7bb2" stroke-width="3.4" fill="none" stroke-linecap="round"/>' % (11 + sway, 22 + sway, 14 + sway)
        hx, hy = 14 + sway, 7
    s += '<circle cx="%g" cy="%g" r="4.6" fill="#ff7bb2" stroke="#8a1d4f" stroke-width="1.3"/>' % (hx, hy)
    if panic:
        s += '<path d="M%g %g l-7 -2 l1 3 Z" fill="#fff" stroke="#222" stroke-width=".9"/><path d="M%g %g l-7 3 l2 2 Z" fill="#222"/>' % (hx - 3, hy - 1, hx - 3, hy + 1)
    else:
        s += '<path d="M%g %g C%g %g %g %g %g %g L%g %g Z" fill="#fff" stroke="#222" stroke-width=".9"/>' % (hx - 3.5, hy - 1.5, hx - 8, hy - 2, hx - 10, hy + 1, hx - 8.5, hy + 5, hx - 4, hy + 2)
        s += '<path d="M%g %g L%g %g L%g %g Z" fill="#222"/>' % (hx - 8.2, hy + 1, hx - 8.5, hy + 5, hx - 6.6, hy + 3.2)
    s += '<circle cx="%g" cy="%g" r="%g" fill="#fff" stroke="#8a1d4f" stroke-width=".8"/><circle cx="%g" cy="%g" r="%g" fill="#111"/>' % (
        hx - 0.6, hy - 1, 2.6 if panic else 2, hx - 1.2, hy - 1, .8 if panic else 1.2)
    wing = {0: 8, 1: -14, 2: 18}.get(f, -60)
    s += '<path d="M24 19 C29 15 36 17 37 21 C32 24 27 24 24 19 Z" fill="#e64d8f" stroke="#8a1d4f" stroke-width="1" transform="rotate(%d 30 20)"/>' % wing
    if panic: s += '<path d="M24 19 C29 15 36 17 37 21 C32 24 27 24 24 19 Z" fill="#f0609d" stroke="#8a1d4f" stroke-width="1" transform="rotate(50 30 20)"/>'
    return s + '</g>'

save('bird-toucan.svg', FW * 4, FH, ''.join(toucan(f) for f in range(4)))
save('bird-flamingo.svg', FW * 4, FH, ''.join(flamingo(f) for f in range(4)))

# ---- crash: the two birds in a tangle, feathers and stars ----
def star(cx, cy, r, fill, rot=0):
    pts = []
    for i in range(10):
        a = math.radians(rot + i * 36 - 90); rr = r if i % 2 == 0 else r * 0.45
        pts.append('%.1f,%.1f' % (cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return '<polygon points="%s" fill="%s" stroke="#7a4a00" stroke-width=".8"/>' % (' '.join(pts), fill)
c = '<g opacity=".95"><circle cx="48" cy="30" r="22" fill="#fff" opacity=".55"/><circle cx="30" cy="34" r="12" fill="#fff" opacity=".5"/><circle cx="66" cy="34" r="12" fill="#fff" opacity=".5"/></g>'
c += '<ellipse cx="38" cy="34" rx="14" ry="12" fill="#1fb5a8" stroke="#0b3d5c" stroke-width="1.6" transform="rotate(-25 38 34)"/>'
c += '<ellipse cx="59" cy="30" rx="12" ry="8.5" fill="#ff7bb2" stroke="#8a1d4f" stroke-width="1.5" transform="rotate(20 59 30)"/>'
c += '<path d="M52 24 C46 10 64 10 56 22 C50 30 70 30 66 16" stroke="#ff7bb2" stroke-width="3.6" fill="none" stroke-linecap="round"/>'
c += '<path d="M26 26 C32 14 44 18 40 24 Z" fill="#ff8c1a" stroke="#0b3d5c" stroke-width="1.1"/>'
for (x, y) in [(36, 30), (61, 27)]:
    c += '<g stroke="#111" stroke-width="1.6" stroke-linecap="round"><path d="M%g %g l4 4 M%g %g l-4 4"/></g>' % (x - 2, y - 2, x + 2, y - 2)
for (x, y, r) in [(18, 12, 5), (80, 10, 5.5), (48, 5, 4.5), (86, 40, 4), (10, 40, 4)]: c += star(x, y, r, '#ffe94d', x)
for (x, y, a, col) in [(14, 24, 30, '#1fb5a8'), (82, 24, -40, '#ff7bb2'), (70, 50, 70, '#ff7bb2'), (24, 50, -60, '#1fb5a8')]:
    c += '<ellipse cx="%g" cy="%g" rx="5" ry="2" fill="%s" stroke="#333" stroke-width=".5" transform="rotate(%d %g %g)"/>' % (x, y, col, a, x, y)
save('crash.svg', 96, 56, c)

# ---- tightrope post: candy-striped pole with a gold knob ----
p = '<defs><pattern id="st" width="16" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="16" height="6" fill="#e8333a"/><rect y="6" width="16" height="6" fill="#fff"/></pattern>'
p += '<radialGradient id="kn" cx=".35" cy=".35"><stop offset="0" stop-color="#fff6b0"/><stop offset=".5" stop-color="#ffc400"/><stop offset="1" stop-color="#b37a00"/></radialGradient></defs>'
p += '<rect x="4" y="9" width="8" height="90" fill="url(#st)" stroke="#5a1010" stroke-width="1"/><circle cx="8" cy="8" r="7" fill="url(#kn)" stroke="#7a4a00" stroke-width="1"/>'
save('post.svg', 16, 100, p)

# ---- backdrops ----
def rays(cx, cy, n, r, col, op):
    out = ''
    for i in range(n):
        a1 = 2 * math.pi * i / n; a2 = a1 + math.pi / n
        out += '<polygon points="%g,%g %.1f,%.1f %.1f,%.1f" fill="%s" opacity="%g"/>' % (cx, cy, cx + r * math.cos(a1), cy + r * math.sin(a1), cx + r * math.cos(a2), cy + r * math.sin(a2), col, op)
    return out
def bulbs(x0, y0, x1, y1, n, r=3.2):
    out = ''
    for i in range(n):
        t = i / (n - 1); x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
        out += '<circle cx="%.1f" cy="%.1f" r="%g" fill="%s"/>' % (x, y, r, '#ffe94d' if i % 2 else '#fff7c9')
    return out
bg = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b3be0"/><stop offset=".55" stop-color="#3a20c4"/><stop offset="1" stop-color="#6a16b0"/></linearGradient>'
bg += '<radialGradient id="spot" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>'
bg += '<rect width="640" height="480" fill="url(#g)"/>' + rays(320, 300, 28, 700, '#ffffff', .06) + '<rect width="640" height="480" fill="url(#spot)"/>'
bg += '<rect x="14" y="10" width="612" height="300" rx="18" fill="none" stroke="#f6d312" stroke-width="4" opacity=".8"/>'
bg += bulbs(30, 10, 610, 10, 30) + bulbs(30, 310, 610, 310, 30) + bulbs(14, 26, 14, 294, 14) + bulbs(626, 26, 626, 294, 14)
for (x, y, r) in [(70, 60, 6), (560, 80, 7), (520, 250, 5), (110, 240, 5), (600, 170, 4), (40, 160, 4)]: bg += star(x, y, r, '#ffe94d', x)
save('stage-bg.svg', 640, 480, bg)

lb = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1230b8"/><stop offset="1" stop-color="#4a1ab0"/></linearGradient>'
lb += '<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
lb += '<rect width="640" height="480" fill="url(#g)"/>'
lb += '<polygon points="60,0 110,0 330,300 150,300" fill="url(#cone)"/><polygon points="530,0 580,0 490,300 310,300" fill="url(#cone)"/>'
for row in range(6):                                            # perspective checker floor
    y0 = 300 + row * row * 5 + row * 6; y1 = 300 + (row + 1) ** 2 * 5 + (row + 1) * 6
    for col in range(-8, 9):
        if (row + col) % 2: continue
        def X(c, y): return 320 + (c * 40) * (0.5 + (y - 300) / 180)
        lb += '<polygon points="%.1f,%d %.1f,%d %.1f,%d %.1f,%d" fill="#ffffff" opacity=".10"/>' % (X(col, y0), y0, X(col + 1, y0), y0, X(col + 1, y1), y1, X(col, y1), y1)
lb += '<rect x="0" y="298" width="640" height="4" fill="#f6d312" opacity=".7"/>' + bulbs(8, 8, 632, 8, 36) + bulbs(8, 8, 8, 290, 16) + bulbs(632, 8, 632, 290, 16)
for (x, y, r) in [(90, 120, 5), (550, 140, 6), (320, 40, 5), (200, 70, 4), (450, 60, 4)]: lb += star(x, y, r, '#ffe94d', y)
save('lobby-bg.svg', 640, 480, lb)

# ---- icons ----
save('icon-help.svg', 44, 44, '<circle cx="22" cy="22" r="19" fill="#ffd23f" stroke="#12206a" stroke-width="3"/><path d="M16 17 C16 10 28 10 28 17 C28 22 22 22 22 27" stroke="#12206a" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="22" cy="33" r="2.6" fill="#12206a"/>')
spk = '<path d="M6 14 H12 L20 7 V29 L12 22 H6 Z" fill="#ffd700" stroke="#12206a" stroke-width="1.2"/>'
save('icon-sound.svg', 36, 36, spk + '<path d="M24 12 C28 15 28 21 24 24 M27 8 C34 13 34 23 27 28" stroke="#ffd700" stroke-width="2.6" fill="none" stroke-linecap="round"/>')
save('icon-sound-off.svg', 36, 36, spk.replace('#ffd700', '#8890b0') + '<path d="M24 12 L32 24 M32 12 L24 24" stroke="#ff8a80" stroke-width="3" stroke-linecap="round"/>')
save('favicon.svg', 64, 64, '<rect x="4" y="4" width="56" height="56" rx="12" fill="#ff8a00" stroke="#12206a" stroke-width="4" transform="rotate(-8 32 32)"/><text x="32" y="45" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="38" fill="#fff" stroke="#12206a" stroke-width="2" transform="rotate(-8 32 32)">S</text>')
print('art written to', os.path.abspath(OUT)); print(sorted(os.listdir(OUT)))
