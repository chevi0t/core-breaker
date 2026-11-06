// 狙撃銃を右クリックで覗けることを確かめる（2026-11-06、オーナー「遊撃の副武器狙撃銃、覗けなくなってない？」）。
// #198（斬馬刀）で u.scoped を決める行がコメントの中に入り、プレイヤーが覗けなくなっていた。
// node tools/test/sniper_scope_check.js [dbg]
const { check } = require('./lib');
check('狙撃銃のスコープ', async ({ ev, step, ok, sortie }) => {
  await sortie('wide');
  const put = key => ev(key => { const g = __g, p = g.player;
    for (const q of g.units) if (q !== p) { q.alive = false; q.pos.set(9999, 0, 9999); }
    p.slots.sub = g.slotOf(key);
    g.selectWeapon(p, 'sub'); p.switchT = 0; g.releaseLock(); }, key);
  const scoped = () => ev(() => __g.player.scoped);
  const fov = () => ev(() => __g.camera.fov);
  const press = () => ev(() => { __g.aimPress(2, true); });
  const release = () => ev(() => dispatchEvent(new MouseEvent('mouseup', { button: 2 })));

  await put('sniper'); await step(2);
  ok(!(await scoped()), '持ち替えた直後は覗いていない');
  const f0 = await fov();
  await press(); await step(10);
  ok(await scoped(), '右を押している間は覗く（狙撃銃）');
  ok((await fov()) < f0 * .7, `覗くと視野が狭くなる（${f0.toFixed(1)} → ${(await fov()).toFixed(1)}）`);
  ok(await ev(() => !document.getElementById('scope').hidden), 'スコープの枠を出す');
  await release(); await step(10);
  ok(!(await scoped()), '離すと覗くのをやめる');

  await put('zoom'); await step(2);
  await press(); await release(); await step(10);
  ok(await ev(() => __g.player.scoped && __g.player.scopeStep === 1), '二段ズーム：1回目で低倍率');
  await press(); await release(); await step(10);
  ok(await ev(() => __g.player.scoped && __g.player.scopeStep === 2), '二段ズーム：2回目で高倍率');
  await press(); await release(); await step(10);
  ok(await ev(() => !__g.player.scoped && __g.player.scopeStep === 0), '二段ズーム：3回目で通常視点');
});
