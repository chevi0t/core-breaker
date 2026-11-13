// 試合の始めの降下演出（2026-11-13 試作）。node tools/test/drop_check.js [dbg] [出力フォルダ]
// 確かめること：降下中は時間が止まり、操作もダメージも受けない。全機が出撃位置へ降りる。降りたら時間が進む。
// Space で飛ばせる。2回目の出撃（メニューからの再開）でやり直さない。チュートリアルでは出さない。出力フォルダに途中の画面を残す
const path = require('node:path');
const { check } = require('./lib');
check('降下演出', async ({ page, ev, step, ok, out, open }) => {
  await step(2);
  // 1) 10対10の広域で、最後まで見る（描画あり。何枚か撮る）
  const begin = await ev(() => {
    window.__noDrop = false;
    __g.selectMap('wide');
    document.getElementById('start').click();
    const st = __g.dropState;
    return { st: !!st, n: st?.units.length, planes: st?.planes.length, all: __g.units.length, time: __g.timeLeft, match: __g.MATCH, body: document.body.classList.contains('dropping'), hud: !document.getElementById('dropHud').hidden };
  });
  ok(begin.st && begin.n === begin.all, `全機（${begin.all}機）が降下する`);
  ok(begin.planes >= 2, `輸送機が両軍に出る（${begin.planes}機）`);
  ok(begin.body && begin.hud, '降下の表示を出し、ほかの HUD を隠す');
  const L = await ev(() => __g.units.map(u => u.drop.L.toArray()));
  const shots = [[10, 'hang'], [44, 'release'], [62, 'fall'], [80, 'retro'], [96, 'land']];
  let frame = 0, sawBrake = false, sawAir = false, minHp = Infinity;
  for (const [f, name] of shots) {
    while (frame < f) {
      await step(1); frame++;
      const s = await ev(() => { const p = __g.player; return { brake: !!p.drop?.braking, air: !!p.drop && p.pos.y - p.drop.L.y > 20 }; });
      sawBrake ||= s.brake; sawAir ||= s.air;
      if (frame === 30) {
        // 降下中の機体は撃たれない・動かない
        const d = await ev(() => { const p = __g.player, e = __g.units.find(u => u.team !== p.team); const hp = e.hp; __g.damage(e, p, 3000); return { hp: e.hp === hp, time: __g.timeLeft === __g.MATCH }; });
        ok(d.hp, '降下中の機体はダメージを受けない');
        ok(d.time, '降下中は試合の時間が止まる');
      }
    }
    await page.screenshot({ path: path.join(out, `drop-${String(frame).padStart(3, '0')}-${name}.png`) });
  }
  ok(sawAir && sawBrake, '自機が高い所から落ち、逆噴射で減速する');
  for (let i = 0; i < 80 && await ev(() => __g.dropActive()); i++) await step(1);
  const after = await ev(() => ({ done: !__g.dropActive(), pos: __g.units.map(u => u.pos.toArray()), ground: __g.units.every(u => u.onGround && !u.drop), inv: __g.player.invulT, body: document.body.classList.contains('dropping'), t: __g.dropState.t }));
  ok(after.done, `全機が降りる（${after.t.toFixed(1)}秒）`);
  ok(after.t < 8, '降下演出は8秒より短い');
  // 先に降りた Bot はもう動いているので、出撃位置に立ったかは自機（操作していない）で見る
  ok(Math.hypot(...after.pos[0].map((v, k) => v - L[0][k])) < .01 && after.ground, '全機が地面に立ち、自機は出撃位置にいる');
  ok(!after.body, 'HUD を戻す');
  await step(20);
  ok(await ev(() => __g.timeLeft < __g.MATCH - .5), '降りた後は時間が進む');
  for (let i = 0; i < 260 && await ev(() => __g.dropState.planes.length); i++) await step(1);
  ok(await ev(() => __g.dropState.planes.length === 0), '輸送機は飛び去って消える');
  // 2) メニューを開いて戻っても降下をやり直さない
  await ev(() => { __g.running = false; document.getElementById('overlay').hidden = false; document.getElementById('start').click(); });
  ok(await ev(() => !__g.dropActive() && __g.units.every(u => !u.drop)), 'メニューから戻っても降下をやり直さない');
  // 3) もう一度試合を作り直すと降下する。Space で飛ばせる
  await ev(() => { __g.running = false; __g.selectMap('mesa'); document.getElementById('overlay').hidden = false; document.getElementById('start').click(); });
  ok(await ev(() => __g.dropActive()), '新しい試合ではまた降下する');
  await step(5);
  await ev(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })));
  await step(1);
  const sk = await ev(() => ({ active: __g.dropActive(), ground: __g.units.every(u => !u.drop && u.onGround), air: __g.units.filter(u => !u.onGround).map(u => [u.isPlayer, u.pos.y.toFixed(1)]), planes: __g.dropState.planes.length, t: __g.dropState.t }));
  ok(!sk.active && sk.ground && sk.planes === 0, 'Space で降下を飛ばせる' + (sk.active || !sk.ground || sk.planes ? JSON.stringify(sk) : ''));
  await ev(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })));
  await step(10);
  ok(await ev(() => __g.timeLeft < __g.MATCH), '飛ばした後は時間が進む');
  // 4) 50対50でも動く（輸送機を軍ごとに7機に分ける）。メモリが足りなくならないよう、前のページを閉じて開き直し、描画は止める
  await page.close();
  const p2 = await open();
  const ev2 = (f, a) => p2.evaluate(f, a), step2 = n => ev2(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
  await step2(2);
  const big = await ev2(() => {
    window.__noDrop = false; __g.selectedTeamSize = 50;
    const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld();
    __g.selectMap('wide'); document.getElementById('start').click();
    return { n: __g.dropState.units.length, planes: __g.dropState.planes.length };
  });
  ok(big.n === 100 && big.planes >= 12, `50対50：100機が${big.planes}機の輸送機から降りる`);
  for (let i = 0; i < 200 && await ev2(() => __g.dropActive()); i++) await step2(1);
  ok(await ev2(() => !__g.dropActive() && __g.units.every(u => !u.drop)), `50対50：全機が降りる（${(await ev2(() => __g.dropState.t)).toFixed(1)}秒）`);
});
