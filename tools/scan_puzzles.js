const E = require('../js/engine.js'); const data = require('../data/puzzles.json');
const rng = () => 0.42; const issues = { dupKeys: [], punct: [], plainAlsoTarget: [], plainSameKey: [], shortKey: [] };
data.rounds.forEach((r, ri) => (r.sets || []).forEach(set => set.items.forEach(it => {
  const kind = ri === 2 ? 'story' : ri === 3 ? 'storyAll' : (it.answers ? 'multi' : 'single');
  let targets = [], segs = null;
  if (it.story) segs = E.parseStory(it.story, kind, r.minLen || 4, rng, targets, it);
  else (it.answers || [it.answer]).forEach((a, i) => targets.push({ id: i, answer: E.normalize(a), key: E.normalize(a).slice(0, 3), raw: a }));
  const label = 'R' + (ri + 1) + ' ' + set.category + ': ' + (it.story || it.clue);
  const byKey = {}; targets.forEach(t => (byKey[t.key] = byKey[t.key] || []).push(t.answer));
  Object.entries(byKey).forEach(([k, v]) => { if (v.length > 1) issues.dupKeys.push(label + '  [' + k + ': ' + v.join(', ') + ']'); });
  targets.forEach(t => { if (t.answer.length < 4) issues.shortKey.push(label + ' ' + t.answer); });
  (it.answers || (it.answer ? [it.answer] : [])).forEach(a => { if (/[^A-Za-z]/.test(a)) issues.punct.push(label + '  answer "' + a + '"'); });
  if (it.story) {
    const words = it.story.replace(/[\[\]]/g, '').split(/\s+/);
    words.forEach(w => { if (/[A-Za-z]['\u2019-][A-Za-z]/.test(w)) issues.punct.push(label + '  word "' + w + '"'); });
    const plain = segs.filter(s => s.text != null).map(s => s.text).join(' ').match(/[A-Za-z']+/g) || [];
    const ans = new Set(targets.map(t => t.answer)), keys = new Set(targets.map(t => t.key));
    plain.forEach(w => { const n = E.normalize(w); if (n.length >= 3 && ans.has(n)) issues.plainAlsoTarget.push(label + '  "' + w + '"');
      else if (n.length >= 4 && keys.has(n.slice(0, 3))) issues.plainSameKey.push(label + '  plain "' + w + '" shares key with a scrambled word'); });
  }
})));
for (const [k, v] of Object.entries(issues)) { console.log('== ' + k + ' (' + v.length + ')'); v.forEach(x => console.log('  ' + x)); }
// Hint density for the storybooks: how many readable (unscrambled) words of 4+ letters each passage shows.
console.log('== storybook hints (eligible = words of 4+ letters; plain = shown unscrambled)');
const tot = {};
data.rounds.forEach((r, ri) => (r.sets || []).forEach(set => set.items.forEach(it => {
  if (!it.story) return;
  const kind = ri === 2 ? 'story' : 'storyAll', targets = [];
  const segs = E.parseStory(it.story, kind, r.minLen || 4, rng, targets, it);
  const plain = (segs.filter(s => s.text != null).map(s => s.text).join(' ').match(/[A-Za-z']+/g) || []).filter(w => E.normalize(w).length >= (r.minLen || 4));
  const elig = plain.length + targets.length, k = 'R' + (ri + 1);
  const t = tot[k] = tot[k] || { n: 0, elig: 0, plain: 0, scr: 0, min: 1e9 };
  t.n++; t.elig += elig; t.plain += plain.length; t.scr += targets.length; t.min = Math.min(t.min, plain.length);
  console.log('  ' + k + ' ' + set.category + ': ' + targets.length + ' scrambled, ' + plain.length + '/' + elig + ' plain (' + Math.round(100 * plain.length / elig) + '%)  ' + (plain.join(' ') || '-'));
})));
Object.entries(tot).forEach(([k, t]) => console.log('  ' + k + ' total: ' + t.n + ' passages, ' + t.scr + ' scrambled, ' + t.plain + '/' + t.elig + ' plain (' + Math.round(100 * t.plain / t.elig) + '%), fewest plain in a passage: ' + t.min));
