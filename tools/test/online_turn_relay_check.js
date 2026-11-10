// node tools/test/online_turn_relay_check.js dbg /tmp/online-turn
// 実の coturn（apt の turnserver）をこの PC で動かし、Worker と同じ作り方の合言葉で、
// ホストとゲストを「中継だけ」（iceTransportPolicy: 'relay'）でつなぐ。直接つながらない回線の代わり。
// turnserver が入っていなければ飛ばす（Ubuntu なら `sudo apt install coturn`）。別回線・本物の NAT の試験ではない。
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { check } = require('./lib');
const { harness, pageFor } = require('./online_test_helpers');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const which = cmd => { try { return execFileSync('sh', ['-c', 'command -v ' + cmd]).toString().trim(); } catch (_) { return ''; } };
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const TURN = which('turnserver');
if (!TURN) { console.log('オンライン中継（実 coturn）：turnserver が無いので飛ばしました'); process.exit(0); }
check('オンライン中継（実 coturn）', async ({ browser, dir, out, ok, errors }) => {
  const h = await harness(dir), port = await freePort(), secret = 'test-' + Math.random().toString(16).slice(2);
  const minPort = 40000 + Math.floor(Math.random() * 20000);
  // 試験だけ、同じ PC の中継を許す（本番の設定 coturn-setup.sh は内向きのアドレスを断る）。
  const conf = path.join(out, 'turnserver.conf');
  fs.writeFileSync(conf, [`listening-ip=127.0.0.1`, `relay-ip=127.0.0.1`, `listening-port=${port}`, `min-port=${minPort}`, `max-port=${minPort + 50}`,
    'fingerprint', 'use-auth-secret', `static-auth-secret=${secret}`, 'realm=core-breaker', 'no-tls', 'no-dtls', 'no-cli', 'allow-loopback-peers', 'simple-log',
    `log-file=${path.join(out, 'turn.log')}`, `pidfile=${path.join(out, 'turn.pid')}`].join('\n') + '\n');
  const turn = spawn(TURN, ['-c', conf], { stdio: 'ignore' });
  let pages = [];
  try {
    await sleep(800);
    ok(turn.exitCode == null, 'coturn を起動した（127.0.0.1:' + port + '）');
    const { fromCoturn } = await import('../turn-worker/worker.mjs');
    const iceServers = await fromCoturn({ TURN_HOST: '127.0.0.1:' + port, TURN_SECRET: secret });
    ok(iceServers.some(s => s.urls.some(u => u.startsWith('turn:')) && s.username && s.credential), 'Worker の作り方で期限つきの合言葉を作った');
    const host = await pageFor(browser, h, errors, { autoApprove: false }), guest = await pageFor(browser, h, errors, { autoApprove: false });
    pages = [host, guest];
    const options = { ...h.peerOptions, config: { iceServers, iceTransportPolicy: 'relay' } };
    const open = (p, role, room) => p.evaluate(async ({ options, role, room }) => {
      window.__t = new CBOnlineTransport({ appVersion: document.getElementById('appVersion').textContent.trim(), peerOptions: options,
        onPeerRequest: id => window.__t.approvePeer(id), onMessage: (type, payload) => { (window.__got ||= []).push([type, payload]); } });
      return role === 'host' ? await window.__t.createRoom() : await window.__t.connect(room);
    }, { options, role, room });
    const room = await open(host, 'host');
    const joined = await Promise.race([open(guest, 'guest', room).then(() => true, e => e.message), sleep(25000).then(() => '25秒でつながらない')]);
    ok(joined === true, '中継だけの設定でゲストが部屋に入れた' + (joined === true ? '' : '：' + joined));
    await sleep(500);
    const routes = await Promise.all(pages.map(p => p.evaluate(() => [...window.__t.links.values()].map(l => l.route))));
    ok(routes.flat().length === 2 && routes.flat().every(r => r === 'relay'), '両側とも経路は「中継」と分かった（' + JSON.stringify(routes) + '）');
    await guest.evaluate(() => window.__t.send('lobbyEditing', { editing: true }));
    await host.waitForFunction(() => (window.__got || []).some(([t]) => t === 'lobbyEditing'), {}, { timeout: 5000, polling: 50 });
    ok(true, '中継を通してゲストからホストへ届いた');
    const status = await guest.evaluate(() => window.__t.relayAvailable);
    ok(status === true, 'ゲストは中継ありと分かっている');
    // 合言葉が違えば coturn が断り、中継だけの設定ではつながらない（正しく時間切れの理由が出る）。
    const bad = await pageFor(browser, h, errors, { autoApprove: false }); pages.push(bad);
    const badReason = await bad.evaluate(async ({ options, room }) => {
      const t = new CBOnlineTransport({ appVersion: document.getElementById('appVersion').textContent.trim(), peerOptions: { ...options, config: { ...options.config, iceServers: options.config.iceServers.map(s => s.credential ? { ...s, credential: 'wrong' } : s) } } });
      window.__bad = t; const p = t.connect(room).then(() => 'joined', e => e.message);
      await new Promise(r => setTimeout(r, 500)); const link = t.links.get(room); if (link) link.opened = performance.now() - 20001; t._tick();
      return await p;
    }, { options, room });
    ok(/中継サーバーを通してもつながりませんでした/.test(badReason) && !/not open/i.test(badReason), '合言葉が違うと断られ、正しい理由を出す（' + badReason + '）');
    for (const p of pages) await p.evaluate(() => { window.__t?.close(); window.__bad?.close(); }).catch(() => {});
  } finally {
    turn.kill('SIGTERM'); await h.close();
  }
}, { page: false, errorsOk: /ICE|TURN|stun|turn|701/ });
