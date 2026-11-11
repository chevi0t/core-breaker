// 格闘アクションではスタンガンの充填を消さず、発射は動作・硬直の後まで待つ。
// node tools/test/stunner_melee_charge_check.js [dbg]
const { check } = require('./lib');
check('格闘中のスタンガン充填', async ({ ev, ok, sortie }) => {
  await sortie('dock');
  const checks = await ev(() => {
    const g = __g, p = g.player, bot = g.units.find(u => !u.isPlayer), out = [], dt = 1 / 120, stop = new g.T.Vector3();
    const yes = (v, label) => { if (!v) throw Error(label); out.push(label); };
    const near = (a, b) => Math.abs(a - b) < 1e-7;
    g.obstacles.splice(0, g.obstacles.length, { minX: -150, maxX: 150, minZ: -150, maxZ: 150, top: 200 });
    g.waters.length = 0;
    function reset(key = 'stunner', actionId = 'tackle', actor = p, air = false) {
      for (const u of g.units) { u.alive = false; u.pos.set(10000, 0, 10000); }
      g.resetLifeState(actor);
      Object.assign(actor, { alive: true, downT: 0, hp: actor.maxHp, invulT: 0, actionId, boost: actor.maxBoost,
        overheat: false, onGround: !air, yaw: 0, pitch: 0, weapon: 'aux', switchT: 0, actionHeld: false, actionPressed: false });
      actor.pos.set(0, air ? 230 : 200, 20); actor.vel.set(0, 0, 0);
      actor.slots.aux = g.slotOf(key); actor.slots.aux.cd = 0;
      for (const f of g.stunFields.splice(0)) g.scene.remove(f.mesh);
      return actor.slots.aux;
    }
    const aim = u => u.pos.clone().add(new g.T.Vector3(0, 2, -40));
    function tick(u, trigger) { g.physics(u, stop, false, false, dt, false); g.weaponsTick(u, dt, trigger, aim(u), 0); }
    for (const key of ['stunner', 'stunnerD', 'stunnerW']) for (const [id, air] of [['tackle', false], ['kick', false], ['kick', true]]) {
      for (const ratio of [.4, 1]) for (const actor of [p, bot]) {
        const label = `${key} ${air ? '空中' : ''}${id} ${ratio * 100}% ${actor === p ? '自機' : 'Bot'}`;
        const sl = reset(key, id, actor, air), charge = sl.w.chargeTime * ratio, hold = ratio === 1 ? 3.2 : 0;
        sl.chargeT = charge; sl.holdT = hold;
        yes(g.actionMoveStart(actor), label + '：発動');
        let frames = 0, recovery = false;
        while (g.actionBusy(actor) && frames++ < 250) {
          // 最後のコマは硬直が解けてから武器を進めるため、終了境界を別に確認する。
          g.physics(actor, stop, false, false, dt, false);
          if (!g.actionBusy(actor)) break;
          recovery ||= actor.actionRecoverT > 0;
          g.weaponsTick(actor, dt, frames % 2 === 0, aim(actor), 0);
          if (!near(sl.chargeT, charge) || !near(sl.holdT, hold) || g.stunFields.length) throw Error(label + '：格闘中に充填消失・進行または誤発射');
        }
        yes(frames < 250 && recovery, label + '：予備動作・突進・硬直を通して充填と保持時間を保存し、離しても撃たない');
        g.weaponsTick(actor, dt, false, aim(actor), 0);
        const f = g.stunFields[0], F = sl.w.stunField;
        yes(g.stunFields.length === 1 && near(f.dmg, F.dmg[0] + (F.dmg[1] - F.dmg[0]) * ratio) && sl.chargeT === 0 && sl.holdT === 0,
          label + '：硬直終了後に保存した威力で1発だけ発射して充填を消費');
        g.weaponsTick(actor, dt, false, aim(actor), 0);
        yes(g.stunFields.length === 1 && sl.ammo === 1 && sl.reloadT === 0, label + '：連続誤発射せず弾無限・リロードなし');
      }
    }
    let sl = reset(); sl.chargeT = .4; g.actionMoveStart(p);
    while (g.actionBusy(p)) tick(p, true);
    yes(sl.chargeT > .4 && !g.stunFields.length, '押し続けた場合は硬直後に残量から充填再開');
    sl = reset(); sl.chargeT = sl.w.chargeTime; sl.holdT = sl.w.chargeHold - .05; g.actionMoveStart(p);
    while (g.actionBusy(p)) tick(p, true);
    for (let n = 0; n < 8; n++) g.weaponsTick(p, dt, true, aim(p), 0);
    yes(sl.overheat && sl.chargeT === 0 && sl.holdT === 0 && !g.stunFields.length, '格闘で満充填保持時間を巻き戻さず、再開後は元の8秒制限で過熱');
    sl = reset(); sl.overheat = true; sl.ohT = 1; g.actionMoveStart(p);
    for (let n = 0; n < 30; n++) tick(p, true);
    yes(near(sl.ohT, .75) && sl.overheat, '格闘中も過熱の冷却時間は進む');
    sl = reset(); sl.cd = .5; g.actionMoveStart(p);
    for (let n = 0; n < 30; n++) tick(p, true);
    yes(near(sl.cd, .25) && sl.chargeT === 0 && !g.stunFields.length, '格闘中も射撃間隔は進むが新しく充填はしない');
    for (const [name, block] of [
      ['被電撃', u => { u.electricT = 1; }], ['よろけ', u => { u.stun = 'stagger'; }],
      ['修理ポッド', u => { u.repairing = true; }], ['持ち替え', u => { u.weapon = 'main'; }],
      ['持ち替え待ち', u => { u.switchT = .5; }], ['照準なし', () => {}]
    ]) {
      sl = reset(); sl.chargeT = .7; sl.holdT = 2; g.actionMoveStart(p); block(p);
      g.weaponsTick(p, dt, true, name === '照準なし' ? null : aim(p), 0);
      yes(sl.chargeT === 0 && sl.holdT === 0 && !g.stunFields.length, name + 'は格闘と同時でも従来どおり充填をキャンセル');
    }
    for (const key of ['wave', 'charge', 'pike', 'waveSword']) {
      sl = reset(key); sl.chargeT = .5; sl.holdT = 1; g.actionMoveStart(p); g.weaponsTick(p, dt, true, aim(p), 0);
      yes(sl.chargeT === 0 && sl.holdT === 0, key + '：他のチャージ武器のキャンセル規則は変更しない');
    }
    sl = reset(); sl.chargeT = .6; g.actionMoveStart(p); g.spawn(p);
    yes(!g.actionBusy(p) && p.slots.aux.chargeT === 0, '再出撃で格闘と充填を初期化');
    return out;
  });
  for (const label of checks) ok(true, label);
});
