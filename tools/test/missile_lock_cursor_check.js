// ミサイルの捕捉カーソル（2026-11-05、オーナー「ミサイルロックのロックオンカーソルが地味だからもうちょい派手にしたい」）
// 捕捉中は金色の進み具合の輪、捕捉した敵には赤い菱形と広がる輪が出ること。捕捉の仕組み（時間・数）は変えない。
// node tools/test/missile_lock_cursor_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('ミサイルの捕捉カーソル', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('wide', { render: true });
  await ev(() => { const g = __g, p = g.player; p.slots.sub = g.slotOf('missile'); g.selectWeapon(p, 'sub'); p.switchT = 0;
    window.__foe = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__foe) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const run = n => ev(n => { const g = __g, p = g.player, e = window.__foe;
    for (let i = 0; i < n; i++) { const f = g.fwdOf(p); Object.assign(e, { alive: true, downT: 0, cloak: false }); e.pos.copy(p.pos).addScaledVector(f, 30); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); p.pitch = 0; g.loop(window.__t = (window.__t || 0) + 1000 / 60); } }, n);
  // 敵の位置のまわりで、ある色の画素を数える
  const count = test => ev(test => { const g = __g, c = document.getElementById('missileHud'), s = g.screenOf(window.__foe); if (!s) return -1;
    const x = Math.round((s.x + 1) * c.width / 2), y = Math.round((1 - s.y) * c.height / 2), R = 60, d = c.getContext('2d').getImageData(x - R, y - R, R * 2, R * 2).data, f = new Function('r', 'g', 'b', 'a', 'return ' + test);
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 150 && f(d[i], d[i + 1], d[i + 2])) n++; return n; }, test);
  const gold = 'r > 220 && g > 170 && b < 140', red = 'r > 220 && g < 130 && b < 110';
  await run(4); // 1回の loop は 0.05 秒
  ok(await ev(() => { const sl = __g.player.slots.sub; return !sl.missileLocks.length && sl.missileProgress.get(window.__foe) > 0; }), '捕捉の途中');
  ok(await count(gold) > 40, '捕捉中は敵のまわりに金色の進み具合の輪');
  ok(await count(red) < 10, '捕捉の前は赤い印を出さない');
  await page.screenshot({ path: out + '/missile_lock_acquire.png' });
  await run(6);
  ok(await ev(() => __g.player.slots.sub.missileLocks.length === 1 && __g.missileHudFx.get(window.__foe)?.n === 1), '捕捉した（時間は今までどおり 0.39 秒）');
  ok(await count(red) > 80, '捕捉した敵に赤い菱形と矢じり');
  await page.screenshot({ path: out + '/missile_lock_locked.png' });
  await ev(() => __g.player.slots.sub.missileLocks.length = 0); await run(1);
  ok(await ev(() => !__g.missileHudFx.get(window.__foe)?.n), '捕捉を解くと赤い印も消える');
});
