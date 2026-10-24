"""Proves the public bundle carries none of the original assets:
 * SHA-256 of every file in classic/assets vs every file in the public zip and the Docker context
 * no .gif/.wav/.png/.med files, and no GIF/RIFF-WAVE signatures inside any file
 * no original company / show name text (except the README's non-affiliation disclaimer)
 * screenshots/*.png are allowed: they are fresh captures of the public build
Usage: python3 tools/check_public.py [/workspace/ooo-public.zip]"""
import fnmatch, hashlib, os, re, sys, zipfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ZIP = sys.argv[1] if len(sys.argv) > 1 else '/workspace/ooo-public.zip'
sha = lambda b: hashlib.sha256(b).hexdigest()
classic = {}
for d, _, fs in os.walk(os.path.join(ROOT, 'classic')):
    for f in fs: classic[sha(open(os.path.join(d, f), 'rb').read())] = os.path.relpath(os.path.join(d, f), ROOT)
orig_assets = sum(1 for v in classic.values() if v.startswith('classic/assets/'))
def docker_context():                      # what `docker build .` would send, honoring .dockerignore
    pats = [l.strip() for l in open(os.path.join(ROOT, '.dockerignore')) if l.strip() and not l.startswith('#')]
    def ignored(rel):
        parts = rel.split('/')
        return any(fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(parts[0], p) or any(fnmatch.fnmatch(x, p.replace('**/', '')) for x in parts) for p in pats)
    for d, dirs, fs in os.walk(ROOT):
        rd = os.path.relpath(d, ROOT)
        dirs[:] = [x for x in dirs if not ignored(os.path.normpath(os.path.join(rd, x)).replace(os.sep, '/'))]
        for f in fs:
            rel = os.path.normpath(os.path.join(rd, f)).replace(os.sep, '/')
            if not ignored(rel): yield rel, open(os.path.join(d, f), 'rb').read()
def zip_entries(path):
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if not n.endswith('/'): yield n.split('/', 1)[1], z.read(n)
NAME = re.compile(('box' + 'er\\s*jam|out\\s+of' + '\\s+order').encode(), re.I)
GIF, RIFF, WAVE = b'GI' + b'F8', b'RI' + b'FF', b'WA' + b'VEfmt'
def check(label, entries):
    problems, n = [], 0
    for rel, data in entries:
        n += 1
        if sha(data) in classic: problems.append('%s: identical to %s' % (rel, classic[sha(data)]))
        if rel.startswith('classic/'): problems.append(rel + ': classic folder')
        if re.search(r'\.(gif|wav|png|med|bmp)$', rel, re.I) and not re.match(r'screenshots/[^/]+\.png$', rel): problems.append(rel + ': raster/sample file')
        if data[:4] in (GIF, RIFF) or (GIF in data and not rel.endswith('.png')) or (RIFF in data and WAVE in data): problems.append(rel + ': GIF/WAV bytes inside')
        for m in NAME.finditer(data):
            line = data[data.rfind(b'\n', 0, m.start()) + 1: data.find(b'\n', m.end())]
            if not (rel == 'README.md' and b'not affiliated' in line): problems.append('%s: name "%s"' % (rel, m.group().decode()))
    print('%-15s %4d files checked against %d classic hashes (%d original assets): %s' % (label, n, len(classic), orig_assets, 'CLEAN' if not problems else 'PROBLEMS'))
    for p in problems: print('   ', p)
    return not problems
ok = check('public zip', zip_entries(ZIP)) & check('docker context', docker_context())
sys.exit(0 if ok else 1)
