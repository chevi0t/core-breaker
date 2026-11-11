// 頭上を越えた・越えられたときのロックの戻り（2026-11-11 オーナーがカードで「振り返れば戻る」）。
//  - 敵の頭上を越すと今までどおりロックは外れる。視点は勝手に回らない。
//  - 外れてから LOCK_BACK_T（1.5秒）以内に、同じ敵を右クリックで捕捉できる所へ入れ直すと、右クリック無しでロックが戻る。視点は合わせ直さない。
//  - 時間切れ・迷彩・撃破・遮蔽・持ち替えでは戻らない。頭上ではない外れ方（横へ外す・右クリック・遮蔽・距離）では覚えない。
// python3 tools/test/make_dbg.py dbg && node tools/test/lock_back_check.js dbg
const { check } = require('./lib');
check('頭上を越えたときのロックの戻り', async ({ ev, ok }) => {
  const r = await ev(() => {
    const g = __g, dt = 1 / 60, out = {};
    g.selectMap('dock'); g.setup(); g.running = true; document.getElementById('overlay').hidden = true;
    const u = g.player, foes = g.units.filter(q => q.team !== u.team), e = foes[0], e2 = foes[1];
    for (const q of g.units) { q.alive = q === u; q.frozen = true; }
    for (const q of g.turrets) q.alive = false;
    g.equip(u, 'assault');
    const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; } g.scene.updateMatrixWorld(true); g.updateCamera(u, 0); g.camera.updateMatrixWorld(true); };
    const frame = () => { g.updateLocalHumanAim(u, dt, false); g.updateCamera(u, dt); g.camera.updateMatrixWorld(true); };
    const FAR = [500, 300, 500];
    // 高い所に置く（地形や建物が間に入らないように）。自機は -z を向き、25m 先に敵
    const reset = (uy = 0, ey = 0) => {
      g.releaseLock();
      Object.assign(u, { alive: true, weapon: 'main', switchT: 0, repairing: false, transfer: null, stun: '', jamT: 0, yaw: 0, pitch: 0, recoil: 0 });
      u.pos.set(0, 300 + uy, 0); u.vel.set(0, 0, 0);
      Object.assign(e, { alive: true, cloak: false, downT: 0 }); e.pos.set(0, 300 + ey, -25); e.vel.set(0, 0, 0);
      e2.alive = false; e2.pos.set(...FAR);
      sync();
    };
    // 画面の中心を敵（の胴）へ向ける。off は横へずらす角度
    const face = (off = 0) => {
      const at = g.targetPoint(e), view = new g.T.Vector3();
      for (let i = 0; i < 8; i++) {
        g.updateCamera(u, 0); g.camera.updateMatrixWorld(true);
        const to = at.clone().sub(g.camera.position); g.camera.getWorldDirection(view);
        u.yaw += g.wrapAngle(Math.atan2(-to.x, -to.z) - Math.atan2(-view.x, -view.z));
        u.pitch = Math.max(-0.9, Math.min(0.7, u.pitch + Math.atan2(to.y, Math.hypot(to.x, to.z)) - Math.atan2(view.y, Math.hypot(view.x, view.z))));
      }
      u.yaw += off; g.updateCamera(u, 0); g.camera.updateMatrixWorld(true);
    };
    // 自機が高さ h・速さ v で敵の頭上を越える（who='me'）か、敵が自機の頭上を越える（who='foe'）。外れた所で止める
    const pass = (who, h = 6, v = 20, x = 0) => {
      reset(who === 'me' ? h : 0, who === 'foe' ? h : 0);
      g.setLock(u, e);
      for (let t = 0; t < 2.5 && g.lock.target; t += dt) {
        if (who === 'me') u.pos.set(x, 300 + h, -v * t); else { e.pos.set(x, 300 + h, -25 + v * t); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true); }
        frame();
      }
      return { lost: !g.lock.target, back: g.lock.back?.e === e, gap: who === 'me' ? u.pos.z - e.pos.z : e.pos.z - u.pos.z };
    };
    const wait = sec => { for (let t = 0; t < sec; t += dt) frame(); };

    // 1. 自分が越える：外れて、覚えていて、視点は回らない
    let p = pass('me');
    out.meLost = p.lost && p.back; out.meGap = +p.gap.toFixed(1);
    const yaw0 = u.yaw, pitch0 = u.pitch;
    u.pos.set(0, 306, -45); sync(); wait(.5);
    out.noAutoTurn = u.yaw === yaw0 && u.pitch === pitch0 && !g.lock.target && g.lock.back?.e === e;
    // 2. 振り返ると（外れてから0.5秒＋）右クリック無しで戻る。視点は合わせ直さない（少し横へずらした照準のまま）
    face(.03); const yaw1 = u.yaw, pitch1 = u.pitch, seq = g.lock.visualSeq;
    frame();
    out.returned = g.lock.target === e && g.lock.visible && !g.lock.back;
    out.keptAim = u.yaw === yaw1 && u.pitch === pitch1;
    out.cue = g.lock.visualSeq === seq + 1;
    wait(.5); out.staysLocked = g.lock.target === e;
    // 戻ったロックを右クリックで外すと、もう戻らない
    g.toggleLock(u); wait(.3); out.manualOff = !g.lock.target && !g.lock.back;

    // 3. 時間切れ：1.5秒を過ぎてから振り返っても戻らない
    p = pass('me'); u.pos.set(0, 306, -45); sync(); wait(g.LOCK_BACK_T + .1); face(); wait(.3);
    out.expired = !g.lock.target && !g.lock.back;
    // ぎりぎり間に合う（1.3秒）
    p = pass('me'); u.pos.set(0, 306, -45); sync(); wait(g.LOCK_BACK_T - .2); face(); frame();
    out.justInTime = g.lock.target === e;

    // 4. 敵に越えられる：同じく外れて、振り返れば戻る
    p = pass('foe');
    out.foeLost = p.lost && p.back; out.foeGap = +p.gap.toFixed(1);
    e.pos.set(0, 300, 20); sync(); wait(.3);
    out.foeNoAuto = !g.lock.target;
    face(); frame();
    out.foeReturned = g.lock.target === e;
    // 高く速く越えても同じ
    p = pass('me', 10, 30); out.highLost = p.lost && p.back;
    u.pos.set(0, 310, -50); sync(); face(); frame(); out.highReturned = g.lock.target === e;

    // 高さ・速さ・横のずれを変えても、越えれば外れて覚える（低い跳び越えから高い所まで）
    out.sweep = []; out.sweepBad = []; out.sweepKept = 0;
    for (const who of ['me', 'foe']) for (const h of [4.5, 6, 8, 12]) for (const v of [12, 20, 30]) for (const x of [0, 1.5]) {
      p = pass(who, h, v, x); out.sweep.push(1);
      if (!p.lost) { out.sweepKept++; continue; } // 低くゆっくり横を越えると、視点が追い切ってロックが続くことがある（それでよい）
      if (!(p.back && Math.abs(p.gap) < 8)) out.sweepBad.push(`${who} h${h} v${v} x${x}：${p.back ? '' : '覚えない '}${p.gap.toFixed(1)}m`);
    }

    // 5. 戻らない場合：円の外（捕捉できない所）に置いたまま
    p = pass('me'); u.pos.set(0, 306, -45); sync(); face(.5); wait(.3);
    out.outsideCircle = !g.lock.target && g.lock.back?.e === e;
    face(); frame(); out.thenInside = g.lock.target === e;
    // 迷彩
    p = pass('me'); u.pos.set(0, 306, -45); sync(); e.cloak = true; face(); wait(.2); e.cloak = false; wait(.2);
    out.cloakDrops = !g.lock.target && !g.lock.back;
    // 撃破
    p = pass('me'); u.pos.set(0, 306, -45); e.alive = false; sync(); face(); wait(.2); e.alive = true; sync(); wait(.2);
    out.deadDrops = !g.lock.target && !g.lock.back;
    // 別の敵の機体の陰：見えるようになるまで戻らない
    p = pass('me'); u.pos.set(0, 300, -55); e2.alive = true; e2.pos.set(0, 300, -40); sync(); face(); wait(.3);
    out.blocked = !g.lock.target && g.lock.back?.e === e;
    e2.alive = false; e2.pos.set(...FAR); sync(); frame();
    out.unblocked = g.lock.target === e;
    // 副武器へ持ち替え
    p = pass('me'); u.pos.set(0, 306, -45); sync(); u.weapon = 'sub'; face(); wait(.2); u.weapon = 'main'; wait(.2);
    out.switchDrops = !g.lock.target && !g.lock.back;
    // 右クリックで別の捕捉をしたら、覚えた敵は忘れる（setLock）
    p = pass('me'); u.pos.set(0, 306, -45); sync(); face(); g.toggleLock(u);
    out.clickWorks = g.lock.target === e && !g.lock.back;

    // 6. 頭上ではない外れ方では覚えない
    reset(); g.setLock(u, e); wait(.2); u.yaw += .6; wait(.2);           // 横へ外す
    out.sideNoBack = !g.lock.target && !g.lock.back; face(); wait(.3); out.sideNoReturn = !g.lock.target;
    reset(); g.setLock(u, e); wait(.2); g.toggleLock(u);                  // 右クリックで外す
    out.clickNoBack = !g.lock.target && !g.lock.back; wait(.3); out.clickNoReturn = !g.lock.target;
    reset(); g.setLock(u, e); wait(.2); e2.alive = true; e2.pos.set(0, 300, -12); sync(); wait(1); // 遮蔽0.6秒
    out.losNoBack = !g.lock.target && !g.lock.back; e2.alive = false; e2.pos.set(...FAR); sync(); wait(.3); out.losNoReturn = !g.lock.target;
    reset(); g.setLock(u, e); wait(.2); e.pos.set(0, 300, -(u.lockRange * 1.15 + 20)); sync(); face(); wait(.2); // 距離の外
    out.rangeNoBack = !g.lock.target && !g.lock.back;
    // 段差の上の敵（4.5m 上、25m 先）から照準を横へ外しても覚えない（近くないので頭上ではない）
    reset(0, 4.5); g.setLock(u, e); wait(.2); u.yaw += .6; wait(.2);
    out.ledgeNoBack = !g.lock.target && !g.lock.back;
    return out;
  });
  console.log(JSON.stringify({ ...r, sweep: r.sweep.length }));
  ok(r.meLost, `敵の頭上を越すと今までどおりロックが外れ、その敵を覚えている（真上の ${r.meGap}m 手前）`);
  ok(r.noAutoTurn, '外れた後、視点は勝手に回らない（0.5秒たっても向きは同じで、ロックも戻らない）');
  ok(r.returned, '振り返って敵を捕捉の円へ入れると、右クリック無しでロックが戻る');
  ok(r.keptAim, '戻るとき視点を合わせ直さない（横へずらした照準のまま）');
  ok(r.cue && r.staysLocked, '戻ったときに捕捉の合図が1回出て、ロックは続く');
  ok(r.manualOff, '戻ったロックを右クリックで外すと、もう戻らない');
  ok(r.expired, '1.5秒を過ぎてから振り返っても戻らない');
  ok(r.justInTime, '1.3秒なら間に合って戻る');
  ok(r.foeLost && r.foeNoAuto && r.foeReturned, `敵に頭上を越えられたときも、外れて（真上から ${r.foeGap}m）、振り返れば戻る`);
  ok(r.highLost && r.highReturned, '高さ10m・速さ30m/sで越えても同じ');
  ok(!r.sweepBad.length, `高さ4.5〜12m・速さ12〜30m/s・横のずれ0〜1.5mの${r.sweep.length}通りで、外れたときは必ず覚えている（${r.sweepKept}通りは視点が追い切って外れない）` + (r.sweepBad.length ? '：' + r.sweepBad.slice(0, 6).join('、') : ''));
  ok(r.outsideCircle && r.thenInside, '捕捉の円の外に置いたままでは戻らず、円へ入れると戻る');
  ok(r.cloakDrops, '覚えている間に光学迷彩で消えたら忘れる');
  ok(r.deadDrops, '覚えている間に撃破されたら忘れる');
  ok(r.blocked && r.unblocked, '別の敵の機体の陰では戻らず、見えるようになると戻る');
  ok(r.switchDrops, '副武器へ持ち替えたら忘れる');
  ok(r.clickWorks, '覚えている間の右クリックは今までどおり捕捉する');
  ok(r.sideNoBack && r.sideNoReturn, '照準を横へ外して外れたときは覚えない（今までどおり自動では戻らない）');
  ok(r.clickNoBack && r.clickNoReturn, '右クリックで外したときは覚えない');
  ok(r.losNoBack && r.losNoReturn, '遮蔽で外れたときは覚えない');
  ok(r.rangeNoBack, '距離の外へ出て外れたときは覚えない');
  ok(r.ledgeNoBack, '離れた段差の上の敵から照準を外したときは覚えない');
});
