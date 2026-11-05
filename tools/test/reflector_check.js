// 反射衛星砲（2026-11-05、オーナーのオリジナル）：型の数値、左クリックを押している間の照射（2026-11-06 オーナー：左で照射・右で構えを解く）とカーソルの追従、離して終了、照射した時間のSP、始点の細いレーザー、溜め、動けない、敵のマップに映る、味方に当たらない、警告、Bot の線
// node tools/test/reflector_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('反射衛星砲', async ({ page, ev, step, ok, sortie }) => {
  await sortie('dock');
  const log = await ev(() => {
    const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), a = g.units.find(q => q.team === u.team && q !== u), out = [];
    const yes = (v, m) => { if (!v) throw new Error(m); out.push(m); };
    const want = { reflector: [12000, 4, 6.7, 4, 300], reflectorW: [10000, 8.3, 4.8, 3, 250], reflectorG: [15000, 2, 6.7, 7, 250], reflectorF: [9000, 3.3, 6, 4, 500] };
    for (const [k, [dps, speed, fireTime, radius, range]] of Object.entries(want)) {
      const w = g.WEAPONS[k];
      yes(w && w.type === 'reflector' && w.dps === dps && w.speed === speed && w.fireTime === fireTime && w.radius === radius && w.range === range && g.ARMORY.heavy.sp.includes(k), `${w?.name}：毎秒${dps}・毎秒${speed}m・照射${fireTime}秒・半径${radius}m・射程${range}m`);
    }
    for (const q of g.units) { q.alive = false; q.downT = 0; q.respawnT = 1e9; q.pos.set(10000, 0, 10000); }
    // 開けた平らな所を探す
    let spot;
    for (let z = 60; z >= -60 && !spot; z -= 6) for (let x = -50; x <= 50 && !spot; x += 6) {
      const y = g.terrainH(x, z); let flat = true;
      for (let d = 0; d <= 70 && flat; d += 5) { const s = g.artillerySurface(new T.Vector3(x, 0, z - d)); if (Math.abs(s.point.y - y) > .3 || s.ref) flat = false; }
      if (flat) spot = [x, y, z];
    }
    yes(!!spot, '開けた70mの試験場所');
    const P = d => new T.Vector3(spot[0], spot[1], spot[2] - d);
    const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; } g.scene.updateMatrixWorld(true); };
    const reset = (key = 'reflector') => {
      g.clearArtillery();
      for (const q of [u, e, a]) Object.assign(q, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, downT: 0, stun: '', repairing: false, transfer: null, barrierOn: false });
      g.loadout.heavy.sp = key; g.equip(u, 'heavy'); Object.assign(u, { isPlayer: true, onGround: true, alive: true, hp: 1e6, maxHp: 1e6 });
      u.pos.set(spot[0] - 30, spot[1], spot[2]); u.vel.set(0, 0, 0); u.yaw = 0;
      e.pos.copy(P(20)); a.pos.copy(P(30)); a.pos.x += .5; for (const q of g.spotted[u.team === 'B' ? 'R' : 'B'].keys()) g.spotted[u.team === 'B' ? 'R' : 'B'].delete(q);
      g.selectWeapon(u, 'sub'); u.switchT = 0; g.selectWeapon(u, 'sp'); u.switchT = 0; u.reflectClickAt = -9; sync();
      return u.slots.sp;
    };
    const step = (t, aim = P(0), hold = false) => { for (let n = 0; n < Math.round(t / .02); n++) { g.weaponsTick(u, .02, hold, aim, 0, false); g.reflectorUpdate(); sync(); } };
    let sl = reset(), w = sl.w;
    const T0 = w.fireTime, rate = 100 / T0; // 照射できる秒と、毎秒のSP
    yes(g.isArtilleryMode(u) && u.planted, '選ぶとマップの射撃モード（動けない）');
    yes(g.reflectorConfirm(u, P(0)) && u.reflect.phase === 'warn' && sl.heat === 100, '左クリックを押した所が始点で、溜めに入る。SPはまだ減らない');
    step(.1, P(0), true);
    yes(u.reflectVisual?.root.visible && u.reflectVisual.downCore.visible && u.reflectVisual.downCore.scale.x < .2 && u.reflectVisual.ret.visible, '溜めの間は始点に細いターゲットレーザーと照準マーカー');
    yes(u.reflectVisual.upCore.scale.y > 200, '真上へ光の柱が伸びる');
    yes(g.spotted[e.team].has(u), '押した時から敵のマップに映る');
    yes(g.reflectDanger(e, 10) === null && (e.pos.copy(P(2)), sync(), g.reflectDanger(e, 10)?.by === u), '始点の近くの敵機に警告が出る（遠ければ出ない）');
    e.pos.copy(P(20)); sync();
    step(w.warn, P(0), true);
    yes(u.reflect?.phase === 'fire' && u.reflectFired === 1, `押したまま${w.warn}秒で照射が始まる`);
    yes(u.reflectVisual.downCore.scale.x > 1 && !u.reflectVisual.ret.visible, '照射が始まるとターゲットレーザーと照準マーカーは消え、太い光になる');
    // カーソルを止めると同じ所を照射し続ける
    const h0 = sl.heat; step(.5, P(0), true);
    yes(Math.hypot(u.reflect.at.x - P(0).x, u.reflect.at.z - P(0).z) < .01, 'カーソルを動かさなければ、同じ所を照射し続ける');
    yes(Math.abs(h0 - sl.heat - rate / 2) < .6, `SPは照射した時間の分だけ減る（0.5秒で${(h0 - sl.heat).toFixed(1)}、最長${T0.toFixed(1)}秒で全部）`);
    // カーソルを遠くへ動かすと、光は最大の速さで追う
    e.pos.copy(P(10)); a.pos.copy(P(14)); a.pos.x += .5; sync();
    const at0 = u.reflect.at.clone(); step(1, P(70), true);
    const moved = Math.hypot(u.reflect.at.x - at0.x, u.reflect.at.z - at0.z);
    yes(Math.abs(moved - w.speed) < .3, `光はカーソルを毎秒${w.speed}mまでの速さで追う（1秒で${moved.toFixed(1)}m）`);
    const hp0 = e.hp, ahp0 = a.hp, pos0 = u.pos.clone();
    step(4, P(70), true);
    const got = hp0 - e.hp, expect = w.dps * g.armorMult(e) * (2 * (w.radius + g.R)) / w.speed; // 装甲の倍率込み
    yes(got > expect * .8 && got < expect * 1.2, `光が通った敵機に約${Math.round(expect)}のダメージ（${Math.round(got)}）`);
    yes(a.hp === ahp0, '光が通った味方には当たらない');
    yes(u.pos.distanceTo(pos0) < .01 && u.planted && g.isArtilleryMode(u), '照射中は構えたまま動けない');
    const hMid = sl.heat;
    step(.02, P(70), false);
    yes(!g.isArtilleryMode(u) && u.weapon === 'sub' && !u.reflect, '左クリックを離すと照射が終わり、前の武器に戻る');
    yes(Math.abs(sl.heat - hMid) < .5 && !sl.overheat, `離した所でSPは止まり、残り${sl.heat.toFixed(0)}`);
    g.reflectorUpdate(); yes(!u.reflectVisual.root.visible, '終わると光が消える');
    // 押し続ければ、SPが尽きた所で終わる
    sl = reset(); sl.heat = 100; sl.overheat = false;
    g.reflectorConfirm(u, P(0)); step(w.warn + T0 - .3, P(0), true);
    yes(u.reflect?.phase === 'fire', `SP満タンから${T0.toFixed(1)}秒近く照射できる`);
    step(.6, P(0), true);
    yes(!u.reflect && !g.isArtilleryMode(u) && sl.overheat, 'SPが尽きると照射が終わる');
    // 溜めの間に離せば中止（SPは減らない）
    sl = reset(); sl.heat = 100; sl.overheat = false;
    const fired0 = u.reflectFired; g.reflectorConfirm(u, P(0)); step(w.warn / 2, P(0), true); step(.02, P(0), false);
    yes(!u.reflect && !g.isArtilleryMode(u) && u.reflectFired === fired0 && sl.heat === 100, '溜めの間に離すと中止になり、SPは減らない');
    // 射程の外へカーソルを出しても、光は射程の円の中で止まる
    sl = reset(); sl.heat = 100; sl.overheat = false;
    const far = u.pos.clone(); far.x -= w.range + 200;
    const gl = g.reflectGoal(u, far);
    yes(Math.hypot(gl.x - u.pos.x, gl.z - u.pos.z) <= w.range, '射程の外のカーソルは、射程の円の端に収める');
    // 照射していない時に左を押し続けても構えは解けない（構えを解くのは右クリック）
    g.weaponsTick(u, .02, true, P(0), 0, false);
    yes(g.isArtilleryMode(u) && !u.reflect, '照射していない時に左を押していても、構えは解けない');
    g.aimPress(2, false);
    yes(!g.isArtilleryMode(u) && !u.reflect, '右クリックで構えを解く');
    // 満タンでなければ構えない
    sl = reset(); sl.heat = 60; sl.overheat = false; step(.04);
    yes(!g.isArtilleryMode(u), 'SPが満タンでなければ構えを解く');
    // 型ごとの照射できる秒
    const secs = { reflectorW: 4.8, reflectorG: 6.7, reflectorF: 6 };
    for (const [k, t] of Object.entries(secs)) yes(Math.abs(g.reflectTime(g.WEAPONS[k]) - t) < .01, `${g.WEAPONS[k].name}：最長${t.toFixed(1)}秒`);
    // Bot の線：狙う敵機を通り、味方と自分を避ける。押して、光が終点に着くまで押し続ける
    reset();
    const bot = e; g.loadout.heavy.sp = 'reflector'; g.equip(bot, 'heavy'); bot.slots.sp = g.slotOf('reflector'); Object.assign(bot, { alive: true, isPlayer: false, onGround: true, stun: '' });
    bot.pos.copy(P(-60)); u.pos.copy(P(0)); u.vel.set(0, 0, 0); a.pos.set(10000, 0, 10000); a.alive = false;
    const plan = g.reflectorPlan(bot, u);
    const dist = (p, q, r) => { const d = q.clone().sub(p); d.y = 0; const k = Math.max(0, Math.min(1, ((r.x - p.x) * d.x + (r.z - p.z) * d.z) / d.lengthSq())); return Math.hypot(p.x + d.x * k - r.x, p.z + d.z * k - r.z); };
    yes(plan && dist(plan.a, plan.b, u.pos) < 1, 'Bot は狙う敵機を通る線を決める');
    const mate = g.units.find(q => q.team === bot.team && q !== bot);
    mate.alive = true; mate.pos.copy(u.pos); mate.pos.x += 2;
    yes(!g.reflectorPlan(bot, u), '味方が線の近くにいれば Bot は撃たない');
    mate.alive = false; mate.pos.set(10000, 0, 10000);
    bot.weapon = 'main'; g.selectWeapon(bot, 'sp'); bot.switchT = 0; bot.reflectPlan = plan; bot.slots.sp.heat = 100; bot.slots.sp.overheat = false;
    g.weaponsTick(bot, .02, true, plan.a, 0, false);
    yes(bot.reflect?.phase === 'warn' && bot.reflect.a.distanceTo(plan.a) < .5, 'Bot も始点で押して溜めに入る');
    // 溜めの間の警告と照準マーカー
    g.reflectorUpdate(); sync();
    const rv = bot.reflectVisual;
    yes(rv && rv.ret.visible && rv.downCore.visible && rv.downCore.scale.x < .2, '溜めの間は始点に照準マーカーと細いレーザー');
    const keepU = u.pos.clone(); u.pos.copy(plan.a); u.pos.x += 1;
    g.reflectWarning(u, .02);
    yes(!g.$('reflectAlert').hidden && /照射まで/.test(g.$('reflectAlertInfo').textContent), '始点の近くのプレイヤーに「照射警告」が出る');
    u.pos.copy(keepU);
    let n = 0; while (bot.reflect && n++ < 600) g.weaponsTick(bot, .02, true, plan.a, 0, false);
    yes(!bot.reflect && bot.reflectFired === 1 && n * .02 > w.warn + plan.len / w.speed - .1, `Bot は光が終点に着くまで照射して離す（${(n * .02).toFixed(1)}秒）`);
    // 照射中、光とカーソルの間にいる敵機には、線から離れる向き
    bot.weapon = 'main'; g.selectWeapon(bot, 'sp'); bot.switchT = 0; bot.slots.sp.heat = 100; bot.slots.sp.overheat = false;
    g.weaponsTick(bot, .02, true, plan.a, 0, false); for (let i = 0; i < Math.ceil(w.warn / .02) + 2; i++) g.weaponsTick(bot, .02, true, plan.a, 0, false);
    const hz = g.reflectDanger(u, 10), off = dist(bot.reflect.at, plan.b, u.pos.clone().addScaledVector(hz?.dir || new T.Vector3(), 5));
    yes(bot.reflect?.phase === 'fire' && hz && hz.by === bot && off > dist(bot.reflect.at, plan.b, u.pos), '光の先にいる敵機には、線から離れる向きを返す');
    u.pos.copy(P(0)); u.pos.x += 60; g.reflectWarning(u, .02);
    yes(g.$('reflectAlert').hidden, '線から離れれば警告は消える');
    const warns = { reflector: .5, reflectorW: .3, reflectorG: 1, reflectorF: .7 };
    yes(Object.entries(warns).every(([k, t]) => g.WEAPONS[k].warn === t), '溜め時間：標準0.5秒・広域0.3秒・高出力1秒・長射程0.7秒（1秒以内）');
    g.clearArtillery();
    return out;
  });
  for (const m of log) ok(true, m);
  // 射撃場（時間が進まない）でも、実際のクリックで2点目が決まる（2026-11-05 オーナー「2点目クリック出来ねぇ」：clock() が止まり、2回目を同じクリックと見ていた）
  await ev(() => { const g = __g; g.running = false; g.loadout.heavy.sp = 'reflector'; g.startRange('heavy'); });
  await step(10);
  await ev(() => { const u = __g.player; u.slots.sp.heat = 100; u.slots.sp.overheat = false; });
  await page.keyboard.press('4'); await step(20);
  ok(await ev(() => !!__g.range && __g.isArtilleryMode(__g.player)), '射撃場で反射衛星砲を構える');
  await ev(() => { __g.mapCur.x = __g.player.pos.x; __g.mapCur.z = __g.player.pos.z - 40; });
  await page.mouse.down({ button: 'left' }); await step(2);
  ok(await ev(() => __g.player.reflect?.phase === 'warn'), '射撃場：左クリックを押すと溜めに入る');
  await step(20);
  const at1 = await ev(() => __g.player.reflect?.phase === 'fire' && __g.player.reflect.at.x);
  await ev(() => { __g.mapCur.x = __g.player.pos.x + 30; }); await step(20);
  ok(await ev(x => __g.player.reflect?.phase === 'fire' && __g.player.reflect.at.x > x + 3, at1), '射撃場：押したままカーソルを動かすと光が追う');
  await page.mouse.up({ button: 'left' }); await step(2);
  ok(await ev(() => !__g.player.reflect && !__g.isArtilleryMode(__g.player)), '射撃場：離すと照射が終わる');
  // 構えて、右クリックで解く
  await ev(() => { const u = __g.player; u.slots.sp.heat = 100; u.slots.sp.overheat = false; });
  await page.keyboard.press('4'); await step(20);
  ok(await ev(() => __g.isArtilleryMode(__g.player) && !__g.player.reflect), '射撃場：もう一度構える');
  await page.mouse.down({ button: 'right' }); await step(2); await page.mouse.up({ button: 'right' }); await step(2);
  ok(await ev(() => !__g.player.reflect && !__g.isArtilleryMode(__g.player) && __g.player.slots.sp.heat > 99), '射撃場：右クリックで構えを解く（SPは減らない）');
});
