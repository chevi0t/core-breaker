// 1大破あたりのコアの減り：潮路搬送区の50対50だけ1/800、通常の試合は1/160（ユーザー指定 2026-10-20）
// 使い方: node tools/test/core_loss_check.js dbg
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dbg = path.resolve(process.argv[2] || 'dbg');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + dbg + '/dbg.html'); await p.waitForTimeout(1500);
  const drop = (large, map) => p.evaluate(([large, map]) => {
    const g = __g; g.selectMap(map);
    const sw = document.getElementById('largeBattleSw'); sw.checked = large; sw.dispatchEvent(new Event('change'));
    g.setup();
    const v = g.units.find(u => u.team === 'R'), by = g.units.find(u => u.team === 'B' && !u.isPlayer);
    const before = g.cores.R.hp; g.kill(v, by, false);
    return { units: g.units.length, ratio: Math.round(before / (before - g.cores.R.hp)) };
  }, [large, map]);
  const cases = [[true, 'tidal', 100, 800], [true, 'tidal-v2', 100, 800], [false, 'tidal', 20, 160], [false, 'city', 20, 160]];
  let ok = true;
  for (const [large, map, units, ratio] of cases) {
    const r = await drop(large, map), pass = r.units === units && r.ratio === ratio;
    console.log(`${pass ? 'OK' : 'NG'} ${map}${large ? '（50対50）' : ''}：${r.units}機、1大破でコアの1/${r.ratio}`);
    ok = ok && pass;
  }
  if (errs.length) { ok = false; console.log('ブラウザのエラー', errs.slice(0, 3).join(' | ')); }
  console.log(ok ? 'コアの減り：成功' : 'コアの減り：失敗'); process.exitCode = ok ? 0 : 1;
  await b.close();
})();
