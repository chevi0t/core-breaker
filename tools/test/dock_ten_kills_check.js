// 港の2対2で、チーム合計9機までは続行し、10機目で勝敗が決まることを実処理で確かめる。
// node tools/test/dock_ten_kills_check.js dbg/dock-ten-kills [結果JSON]
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg/dock-ten-kills', 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, checks = [], yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      g.renderer.render = () => {}; g.selectMap('dock');
      const reset = () => { g.setup(); for (const u of g.units) u.frozen = true; g.running = true; document.getElementById('overlay').hidden = true; };
      const frame = () => g.loop(performance.now());
      const defeat = (victim, attacker) => { if (!victim.alive) g.spawn(victim); g.kill(victim, attacker, false); frame(); };
      for (const winner of ['B', 'R']) {
        reset();
        const attackers = g.units.filter(u => u.team === winner), victims = g.units.filter(u => u.team !== winner);
        yes(attackers.length === 2 && victims.length === 2 && g.timeLeft === 300, winner + '：2対2・制限時間5分');
        for (let n = 1; n <= 10; n++) {
          defeat(victims[(n - 1) % 2], attackers[(n - 1) % 2]);
          yes(g.ended === (n === 10), winner + '：' + n + '機目は' + (n === 10 ? '決着' : '続行'));
        }
        yes(attackers.every(u => u.sc.kills === 5), winner + '：2人の5機ずつを合計して勝利');
        yes(document.getElementById('ovTitle').textContent.includes(winner === 'B' ? '勝利' : '敗北'), winner + '：勝った陣営の結果を表示');
      }
      reset(); g.timeLeft = 0; frame();
      yes(g.ended && document.getElementById('ovTitle').textContent.includes('引き分け'), '時間切れで撃破数が同じなら引き分け');
      reset(); defeat(g.units.find(u => u.team === 'R'), g.player); g.timeLeft = 0; frame();
      yes(g.ended && document.getElementById('ovTitle').textContent.includes('勝利'), '時間切れは撃破数が多い側の勝利');
      return { passed: checks.length, checks };
    });
    if (errors.length) throw Error(errors.join('\n'));
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify({ ...result, errors }, null, 2) + '\n');
    console.log(`2対2の10機先取：${result.passed}項目、成功。ブラウザのエラーなし`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
