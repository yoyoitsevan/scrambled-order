"""Builds the two bundles:
  /workspace/ooo-public.zip   - public profile: original art/sound only (no classic/ folder)
  /workspace/ooo-classic.zip  - classic profile: everything + classic/profile.js as js/profile.js
Usage: python3 tools/package.py [outdir]"""
import os, sys, zipfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace'
SKIP_DIRS = {'node_modules', '.git', '__pycache__', 'dist'}
def files(public):
    for d, dirs, fs in os.walk(ROOT):
        rel = os.path.relpath(d, ROOT)
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not (public and rel == '.' and x == 'classic'))
        for f in sorted(fs):
            if f.endswith('.zip'): continue
            yield os.path.join(d, f), os.path.normpath(os.path.join(rel, f))
def build(public, path, top):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for full, rel in files(public):
            if not public and rel == os.path.join('js', 'profile.js'):
                z.write(os.path.join(ROOT, 'classic', 'profile.js'), top + '/js/profile.js'); continue
            z.write(full, top + '/' + rel)
        n = len(z.namelist())
    print('%s: %d files, %.1f MB' % (path, n, os.path.getsize(path) / 1e6))
build(True, os.path.join(OUT, 'ooo-public.zip'), 'scrambled-order')
build(False, os.path.join(OUT, 'ooo-classic.zip'), 'ooo-classic')
