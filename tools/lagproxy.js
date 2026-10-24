// node tools/lagproxy.js LISTEN_PORT TARGET_PORT ONE_WAY_MS [JITTER_MS]
// A TCP proxy that holds every chunk for ONE_WAY_MS (+ random jitter) in each direction, in order:
// a stand-in for a far-away / slow mobile player (RTT = 2 x ONE_WAY_MS). Used by tools/e2e_lag.py.
'use strict';
const net = require('net');
const [listen, target, oneWay, jitter] = process.argv.slice(2).map(Number);
function pipe(from, to) {
  let last = 0;
  from.on('data', buf => {
    const at = Math.max(last, Date.now() + oneWay + Math.random() * (jitter || 0)); last = at;   // keep order
    setTimeout(() => { if (!to.destroyed) to.write(buf); }, at - Date.now());
  });
  from.on('close', () => setTimeout(() => to.destroy(), oneWay + (jitter || 0) + 5));
  from.on('error', () => {});
}
net.createServer(c => {
  c.setNoDelay(true);
  const s = net.connect(target, '127.0.0.1'); s.setNoDelay(true);
  pipe(c, s); pipe(s, c);
}).listen(listen, '127.0.0.1', () => console.log('lag proxy :' + listen + ' -> :' + target + ' one-way ' + oneWay + 'ms'));
