/* Scrambled Order - original vector art drawn in code: the title logo, round intro cards and
   the dancing letter-tile mascots. (Birds, crash, posts, backdrops and icons: assets/svg/.) */
(function () {
  'use strict';
  var COLORS = ['#ff8a00', '#22b14c', '#ffd23f', '#ff5fa2', '#27c2e8', '#9b5cff'];
  var INK = '#12206a';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function star(cx, cy, r, fill, rot) {
    var p = [];
    for (var i = 0; i < 10; i++) { var a = (rot + i * 36 - 90) * Math.PI / 180, rr = i % 2 ? r * 0.45 : r; p.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); }
    return '<polygon points="' + p.join(' ') + '" fill="' + fill + '" stroke="#7a4a00" stroke-width="1"/>';
  }
  function burst(cx, cy, r1, r2, n, fill, stroke) {
    var p = [];
    for (var i = 0; i < n * 2; i++) { var a = Math.PI * i / n, r = i % 2 ? r2 : r1; p.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1)); }
    return '<polygon points="' + p.join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="3" stroke-linejoin="round"/>';
  }
  function tile(x, y, s, ch, color, rot, delay) {
    return '<g transform="translate(' + (x + s / 2).toFixed(1) + ' ' + (y + s / 2).toFixed(1) + ') rotate(' + rot + ')"><g class="ltile" style="animation-delay:' + delay + 's">' +
      '<rect x="' + (-s / 2 + 2) + '" y="' + (-s / 2 + 3) + '" width="' + s + '" height="' + s + '" rx="' + s * 0.18 + '" fill="#0005"/>' +
      '<rect x="' + (-s / 2) + '" y="' + (-s / 2) + '" width="' + s + '" height="' + s + '" rx="' + s * 0.18 + '" fill="' + color + '" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<rect x="' + (-s / 2 + 4) + '" y="' + (-s / 2 + 3) + '" width="' + (s - 8) + '" height="' + s * 0.22 + '" rx="' + s * 0.1 + '" fill="#fff" opacity=".35"/>' +
      '<text x="0" y="' + (s * 0.3) + '" text-anchor="middle" font-family="Arial Black, Impact, Arial, sans-serif" font-weight="900" font-size="' + (s * 0.78).toFixed(1) +
      '" fill="#fff" stroke="' + INK + '" stroke-width="' + (s * 0.06).toFixed(1) + '" paint-order="stroke">' + esc(ch) + '</text></g></g>';
  }
  // Title logo: the working title spelled in jumbled letter tiles over a starburst.
  function logo(title, tagline) {
    var W = 317, H = 283, words = String(title || 'Scrambled Order').toUpperCase().split(/\s+/).filter(Boolean);
    var rows = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : words;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(title) + '">';
    out += '<defs><radialGradient id="lg" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#4a7bff"/><stop offset="1" stop-color="#2a14a8"/></radialGradient></defs>';
    out += '<rect width="' + W + '" height="' + H + '" fill="url(#lg)"/>';
    for (var i = 0; i < 24; i++) { var a1 = Math.PI * 2 * i / 24, a2 = a1 + Math.PI / 24;
      out += '<polygon points="158,128 ' + (158 + 400 * Math.cos(a1)).toFixed(0) + ',' + (128 + 400 * Math.sin(a1)).toFixed(0) + ' ' + (158 + 400 * Math.cos(a2)).toFixed(0) + ',' + (128 + 400 * Math.sin(a2)).toFixed(0) + '" fill="#fff" opacity=".07"/>'; }
    out += burst(158, 126, 112, 92, 18, '#ffd23f', '#e07b00');
    var n = 0, top = rows.length === 1 ? 92 : 58;
    rows.forEach(function (row, r) {
      var chars = row.split(''), s = Math.min(rows.length === 1 ? 58 : 46, Math.floor(290 / chars.length) - 3), gap = 3;
      var w = chars.length * (s + gap) - gap, x0 = (W - w) / 2, y = top + r * (s + 14);
      chars.forEach(function (ch, k) {
        if (ch === ' ') return;
        var rot = ((n * 37) % 23) - 11, dy = (n % 3 - 1) * 4;
        out += tile(x0 + k * (s + gap), y + dy, s, ch, COLORS[n % COLORS.length], rot, (n * 0.07).toFixed(2)); n++;
      });
    });
    out += '<g transform="translate(158 246)"><path d="M-128 -14 H128 L116 0 L128 14 H-128 L-116 0 Z" fill="#e8333a" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<text x="0" y="6" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="12.5" fill="#fff" letter-spacing="1">' + esc((tagline || 'THE WORD-SCRAMBLE GAME SHOW').toUpperCase()) + '</text></g>';
    [[30, 30, 9], [290, 40, 10], [28, 200, 8], [292, 196, 9]].forEach(function (s, i) { out += '<g class="twinkle" style="animation-delay:' + i * 0.4 + 's">' + star(s[0], s[1], s[2], '#ffe94d', i * 20) + '</g>'; });
    return out + '</svg>';
  }
  // "Get ready for round N" card (302 x 249).
  function introCard(n) {
    var W = 302, H = 249, out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
    out += '<defs><radialGradient id="ob" cx=".35" cy=".3"><stop offset="0" stop-color="#ffc46b"/><stop offset=".55" stop-color="#ff8a00"/><stop offset="1" stop-color="#d35400"/></radialGradient></defs>';
    out += burst(151, 132, 116, 96, 16, '#ffd23f', '#e07b00') + burst(151, 132, 92, 80, 16, '#fff3a6', '#ffd23f');
    out += '<g transform="translate(151 34) rotate(-4)"><path d="M-110 -18 H110 L96 0 L110 18 H-110 L-96 0 Z" fill="#22b14c" stroke="' + INK + '" stroke-width="3"/>' +
      '<text x="0" y="7" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="19" fill="#fff" letter-spacing="2">GET READY FOR</text></g>';
    out += '<text x="151" y="104" text-anchor="middle" font-family="Arial Black, Impact, Arial, sans-serif" font-weight="900" font-size="42" fill="#fff" stroke="' + INK + '" stroke-width="7" paint-order="stroke" letter-spacing="3">ROUND</text>';
    out += '<circle cx="151" cy="166" r="52" fill="url(#ob)" stroke="#fff3c4" stroke-width="6"/><circle cx="151" cy="166" r="52" fill="none" stroke="' + INK + '" stroke-width="2"/>';
    out += '<text x="151" y="192" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="74" fill="#fff" stroke="#8a3500" stroke-width="4" paint-order="stroke">' + (+n || 1) + '</text>';
    [[30, 60, 10], [272, 70, 11], [40, 214, 9], [262, 216, 10]].forEach(function (s, i) { out += star(s[0], s[1], s[2], '#ffe94d', i * 15); });
    return out + '</svg>';
  }
  // A dancing letter-tile mascot (64 x 100) with gloves and sneakers; CSS animates the parts.
  function mascot(ch, i) {
    var c = COLORS[i % COLORS.length], out = '<svg class="mascot m' + (i % 3) + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 100" width="64" height="100">';
    out += '<ellipse cx="32" cy="96" rx="20" ry="3.5" fill="#0003"/>';
    out += '<g class="m-legs"><g class="m-leg-l"><path d="M24 64 L20 86" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="17" cy="88" rx="8" ry="4.5" fill="#e8333a" stroke="' + INK + '" stroke-width="2"/></g>' +
      '<g class="m-leg-r"><path d="M40 64 L44 86" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="47" cy="88" rx="8" ry="4.5" fill="#e8333a" stroke="' + INK + '" stroke-width="2"/></g></g>';
    out += '<g class="m-body"><g class="m-arm-l"><path d="M12 42 L2 28" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/><circle cx="2" cy="26" r="5.5" fill="#fff" stroke="' + INK + '" stroke-width="2"/></g>' +
      '<g class="m-arm-r"><path d="M52 42 L62 28" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/><circle cx="62" cy="26" r="5.5" fill="#fff" stroke="' + INK + '" stroke-width="2"/></g>';
    out += '<rect x="11" y="22" width="42" height="44" rx="9" fill="' + c + '" stroke="' + INK + '" stroke-width="3"/><rect x="15" y="25" width="34" height="8" rx="4" fill="#fff" opacity=".35"/>';
    out += '<text x="32" y="60" text-anchor="middle" font-family="Arial Black, Impact, Arial, sans-serif" font-weight="900" font-size="27" fill="#fff" stroke="' + INK + '" stroke-width="2.5" paint-order="stroke">' + esc(ch) + '</text>';
    out += '<g class="m-face"><circle cx="24" cy="12" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="40" cy="12" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/>' +
      '<circle class="m-eye" cx="25.5" cy="13" r="3" fill="#111"/><circle class="m-eye" cx="41.5" cy="13" r="3" fill="#111"/>' + '</g></g>';
    return out + '</svg>';
  }
  window.OOOArt = { logo: logo, introCard: introCard, mascot: mascot, COLORS: COLORS };
})();
