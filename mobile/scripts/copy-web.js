// Copies the shared web client (repo root) into mobile/www for Capacitor. Only the public files are
// copied: never the private classic/ folder, the server, tools or screenshots.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'www');
const ITEMS = ['index.html', 'css', 'js', 'assets', 'data'];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else { fs.copyFileSync(src, dst); n++; }
}
for (const item of ITEMS) copy(path.join(ROOT, item), path.join(OUT, item));
if (fs.existsSync(path.join(OUT, 'classic'))) throw new Error('classic/ must never ship');
console.log('copied ' + n + ' web files into mobile/www');
