// 反射衛星砲（2026-11-05、オーナーのオリジナル）：型の数値、マップで2点、始点の細いレーザー、溜め、照射、行先の変更、動けない、敵のマップに映る、味方に当たらない、中断、警告、Bot の線
// node tools/test/reflector_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('反射衛星砲', async ({ ev, ok, sortie }) => {
  await sortie('dock');
  const log = await ev(() => {
    const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), a = g.units.find(q => q.team === u.team && q !== u), out = [];
    const yes = (v, m) => { if (!v) throw new Error(m); out.push(m); };
    const want = { reflector: [12000, 12, 80, 4, 300], reflectorW: [10000, 25, 120, 3, 250], reflectorG: [15000, 6, 40, 7, 250], reflectorF: [9000, 10, 60, 4, 500] };
    for (const [k, [dps, speed, sweep, radius, range]] of Object.entries(want)) {
      const w = g.WEAPONS[k];
      yes(w && w.type === 'reflector' && w.dps === dps && w.speed === speed && w.sweep === sweep && w.radius === radius && w.range === range && g.ARMORY.heavy.sp.includes(k), `${w?.name}：毎秒${dps}・毎秒${speed}m・最長${sweep}m・半径${radius}m・射程${range}m`);
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
    const step = (t, aim = P(0), alt = false) => { for (let n = 0; n < Math.round(t / .02); n++) { g.weaponsTick(u, .02, false, aim, 0, alt); g.reflectorUpdate(); sync(); } };
    let sl = reset(), w = sl.w;
    yes(g.isArtilleryMode(u) && u.planted, '選ぶとマップの射撃モード（動けない）');
    yes(g.reflectorConfirm(u, P(0)) && u.reflect.phase === 'aim' && sl.heat === 100, '1回目のクリックで始点。SPはまだ使わない');
    step(.1);
    yes(u.reflectVisual?.root.visible && u.reflectVisual.downCore.visible && u.reflectVisual.downCore.scale.x < .2 && u.reflectVisual.ret.visible, '始点に細いターゲットレーザーと照準マーカーが出る');
    yes(g.spotted[e.team].has(u), '始点を決めた時から敵のマップに映る');
    yes(g.reflectDanger(e, 10) === null && (e.pos.copy(P(2)), sync(), g.reflectDanger(e, 10)?.by === u), '始点の近くの敵機に警告が出る（遠ければ出ない）');
    e.pos.copy(P(20)); sync();
    u.reflectClickAt = -9;
    yes(g.reflectorConfirm(u, P(200)) && u.reflect.phase === 'warn', '2回目のクリックで終点、予告が始まる');
    yes(Math.abs(u.reflect.len - w.sweep) < .01, `終点は最長${w.sweep}mに収まる`);
    yes(sl.heat === 0 && sl.overheat, '予告が始まるとSPを全部使う');
    yes(u.reflectVisual?.root.visible && u.reflectVisual.upCore.scale.y > 200, '真上へ光の柱が伸びる');
    step(w.warn);
    yes(u.reflect?.phase === 'fire' && u.reflectFired === 1, `終点を決めて${w.warn}秒で照射`);
    yes(u.reflectVisual.downCore.scale.x > 1 && !u.reflectVisual.ret.visible, '照射が始まるとターゲットレーザーと照準マーカーは消え、太い光になる');
    const hp0 = e.hp, ahp0 = a.hp, pos0 = u.pos.clone();
    step(4);
    const got = hp0 - e.hp, expect = w.dps * g.armorMult(e) * (2 * (w.radius + g.R)) / w.speed; // 装甲の倍率込み
    yes(got > expect * .8 && got < expect * 1.2, `光が通った敵機に約${Math.round(expect)}のダメージ（${Math.round(got)}）`);
    yes(a.hp === ahp0, '光が通った味方には当たらない');
    yes(u.pos.distanceTo(pos0) < .01 && u.planted && g.isArtilleryMode(u), '照射中は構えたまま動けない');
    step(w.sweep / w.speed);
    yes(!g.isArtilleryMode(u) && u.weapon === 'sub' && !u.reflect, '最後までなぞると前の武器に戻る');
    yes(!u.reflectVisual.root.visible, '終わると光が消える');
    // 中断
    sl = reset(); sl.heat = 100; sl.overheat = false;
    g.reflectorConfirm(u, P(0)); u.reflectClickAt = -9; g.reflectorConfirm(u, P(40)); step(w.warn + .5);
    step(.02, P(0), true);
    yes(!g.isArtilleryMode(u) && !u.reflect && !u.reflectVisual.root.visible, '右クリックで中断できる');
    // 照射中の左クリックで行先の変更（今の光の位置から、なぞれる残りまで）
    sl = reset(); g.reflectorConfirm(u, P(0)); u.reflectClickAt = -9; g.reflectorConfirm(u, P(60)); step(w.warn + 2);
    const at0 = u.reflect.at.clone(), gone = u.reflect.along; u.reflectClickAt = -9;
    const side = P(0); side.x += 200;
    yes(g.reflectorConfirm(u, side) && u.reflect.redirects === 1 && u.reflect.phase === 'fire', '照射中の左クリックで行先を変えられる');
    yes(Math.hypot(u.reflect.a.x - at0.x, u.reflect.a.z - at0.z) < .01 && u.reflect.dir.x > .99, '新しい線は今の光の位置から、クリックした向きへ');
    yes(Math.abs(u.reflect.len - (w.sweep - gone)) < .01, `なぞれる長さは最長${w.sweep}mから通った分（${gone.toFixed(1)}m）を引いた残り`);
    step(.5); yes(u.reflect.at.x > at0.x + 1, '光が新しい向きへ進む');
    step(.04, P(0), true);
    yes(!u.reflect, '照射中も右クリックで中断できる');
    // 満タンでなければ構えない
    sl = reset(); sl.heat = 60; sl.overheat = false; step(.04);
    yes(!g.isArtilleryMode(u), 'SPが満タンでなければ構えを解く');
    // 型ごとの最長
    for (const k of ['reflectorW', 'reflectorG', 'reflectorF']) {
      sl = reset(k); g.reflectorConfirm(u, P(0)); u.reflectClickAt = -9; g.reflectorConfirm(u, P(sl.w.sweep + 20));
      yes(Math.abs(u.reflect.len - sl.w.sweep) < .01, `${sl.w.name}：最長${sl.w.sweep}m`);
    }
    // Bot の線：狙う敵機を通り、味方と自分を避ける
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
    bot.weapon = 'main'; g.selectWeapon(bot, 'sp'); bot.switchT = 0; bot.reflectPlan = plan;
    g.weaponsTick(bot, .02, true, plan.a, 0, false);
    yes(bot.reflect?.phase === 'aim', 'Bot もまず始点を決める（細いレーザーが先に見える）');
    bot.reflect.since -= plan.wait; bot.reflectClickAt = -9; g.weaponsTick(bot, .02, true, plan.a, 0, false);
    yes(bot.reflect?.phase === 'warn' && Math.abs(bot.reflect.len - plan.len) < .01, `Bot は${plan.wait.toFixed(1)}秒おいて終点を決める`);
    // 線の近くの敵機への警告と、地面の照準マーカー
    g.reflectorUpdate(); sync();
    const rv = bot.reflectVisual;
    yes(rv && rv.ret.visible && rv.downCore.visible && rv.downCore.scale.x < .2, '溜めの間は始点に照準マーカーと細いレーザー');
    const hz = g.reflectDanger(u, 10), off = dist(plan.a, plan.b, u.pos.clone().addScaledVector(hz?.dir || new T.Vector3(), 5));
    yes(hz && hz.by === bot && off > dist(plan.a, plan.b, u.pos), '線の上の敵機には、線から離れる向きを返す');
    g.reflectWarning(u, .02);
    yes(!g.$('reflectAlert').hidden && /照射まで/.test(g.$('reflectAlertInfo').textContent), '線の近くのプレイヤーに「照射警告」が出る');
    u.pos.copy(P(0)); u.pos.x += 60; g.reflectWarning(u, .02);
    yes(g.$('reflectAlert').hidden, '線から離れれば警告は消える');
    const warns = { reflector: .5, reflectorW: .3, reflectorG: 1, reflectorF: .7 };
    yes(Object.entries(warns).every(([k, t]) => g.WEAPONS[k].warn === t), '溜め時間：標準0.5秒・広域0.3秒・高出力1秒・長射程0.7秒（1秒以内）');
    g.clearArtillery();
    return out;
  });
  for (const m of log) ok(true, m);
});
