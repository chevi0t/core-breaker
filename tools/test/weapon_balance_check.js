// 武器バランスの見直し（2026-11-07、オーナー「根深いトコは修正していきたい」。11-06 の武器の点検から）。
// スタンガンの連続拘束はオーナーの意図どおり（将来のタックルなどとの拘束コンボ用）なので変えない。
// ② 説明と性能のずれ：散弾の拡散率、扇形センサーの角度、大型狙撃銃・精密型の収束、光学迷彩・即応型の見えにくさ、波動ライフル・広域型の爆ぜる弾
// ③ 爆風の決まりを1つに（端で25%・壁で遮られる・体の縦の線までの距離。オーナー「統一しないと後々面倒」「間をとって25%」）
// ④ バーストライフルの組の間（0.15→0.08秒）、蓄積エナジー砲の満タン倍率（2→2.5）、満タンの溜め弾は当てた相手に直撃（頭の倍率あり）
// node tools/test/weapon_balance_check.js [dbg]
const { check } = require('./lib');
check('武器バランスの見直し', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  await ev(() => { const g = __g, p = g.player; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); }
    const e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    Object.assign(e, { alive: true, hp: 1e7, maxHp: 1e7, invulT: 0, shockT: 0, stunT: 0, stun: '', downT: 0 });
    e.pos.copy(p.pos).addScaledVector(f, 4); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); });
  // ② 説明と性能
  const W = await ev(() => { const W = __g.WEAPONS, s = k => W[k].spread; return {
    shotgun: [s('shotgun'), s('shotgunW'), s('shotgunH')], autosg: [s('autosg'), s('autosgR')], hsg: [s('hsg'), s('hsgX'), s('hsgW'), s('hsgH')], gale: [s('gale'), s('galeS')],
    fan: [W.fansensor.proj.cone, W.fansensorX.proj.cone, W.fansensorW.proj.cone], lz: [W.lzsniper.settle, W.lzsniperP.settle, W.lzsniperH.settle],
    camo: [W.camo.still, W.camoQ.still, W.camoH.still, W.camo.move[1], W.camoQ.move[1], W.camoH.move[1]], wave: [W.wave.chargeBlast || 0, W.waveW.chargeBlast],
    burst: [W.burst.gap, W.burstX.gap, W.burstP.gap, W.burstH.gap], lec: [W.lec.chargeMul, W.lecS.chargeMul, W.lecH.chargeMul] }; });
  ok(W.shotgun[1] > W.shotgun[0] && W.shotgun[2] > W.shotgun[1], 'ショットガン：広域型（大）と強装型（特大）は標準（中）より広がる ' + W.shotgun);
  ok(W.autosg[1] < W.autosg[0], 'オートショットガン・連射型は散弾が絞られる（極小） ' + W.autosg);
  ok(W.hsg[1] < W.hsg[0] && W.hsg[2] > W.hsg[0] && W.hsg[3] < W.hsg[1], '衝撃散弾銃：大容量型（小）・強装型（極小）は集弾が良く、広域型（大）は広がる ' + W.hsg);
  ok(W.gale[1] > W.gale[0], '軽量散弾銃・瞬発型（中）は標準（小）より広がる ' + W.gale);
  ok(W.fan.join() === '90,120,150', '扇形センサー：標準90度・大容量型120度・広域型150度 ' + W.fan);
  ok(W.lz[1] < W.lz[0] && W.lz[2] === W.lz[0], '大型狙撃銃・精密型は照準の収束が速い ' + W.lz);
  ok(W.camo[1] < W.camo[0] && W.camo[1] > W.camo[2] && W.camo[4] < W.camo[3] && W.camo[4] > W.camo[5], '光学迷彩・即応型は標準より見えにくい（高出力型ほどではない） ' + W.camo);
  ok(!W.wave[0] && W.wave[1] === 6, '波動ライフル・広域型だけ満タンの弾が爆ぜる（6m） ' + W.wave);
  ok(W.burst.every(v => v === .08), 'バーストライフルの組の間は全部の型で0.08秒 ' + W.burst);
  ok(W.lec.join() === '2.5,1.5,2', '蓄積エナジー砲の満タン倍率：標準2.5・瞬発型1.5・強装型2 ' + W.lec);
  // ③ 爆風の決まりを1つに：端で25%、壁で遮られる、距離は体の縦の線まで（旧来のグレネードも追加のミサイルも同じ）
  const bl = await ev(() => { const g = __g, p = g.player, e = window.__e, T = g.T, f = g.fwdOf(p).setY(0).normalize();
    const hit = (key, d, wall) => { Object.assign(e, { hp: 1e7, maxHp: 1e7, invulT: 0, stun: '', stunT: 0, downT: 0 }); e.pos.copy(p.pos).addScaledVector(f, 40); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true);
      const S = g.WEAPONS[key].proj, at = e.pos.clone().add(new T.Vector3(0, 2, 0)).addScaledVector(f, -d);
      let box = null; if (wall) { box = new T.Mesh(new T.BoxGeometry(6, 8, .6), new T.MeshBasicMaterial()); box.position.copy(e.pos).addScaledVector(f, -d / 2).add(new T.Vector3(0, 3, 0)); box.lookAt(box.position.clone().add(f)); g.scene.add(box); box.updateMatrixWorld(true); g.hittables.push(box); }
      g.blast({ spec: S, team: p.team, owner: p }, at, null);
      if (box) { g.scene.remove(box); g.hittables.splice(g.hittables.indexOf(box), 1); }
      return (1e7 - e.hp) / g.armorMult(e) / S.dmg; };
    const r = k => ({ c: +hit(k, 0).toFixed(3), e: +hit(k, g.WEAPONS[k].proj.blast * .75).toFixed(3), w: +hit(k, g.WEAPONS[k].proj.blast * .5, true).toFixed(3) });
    return { gr: r('grenade'), mi: r('missile'), blast: g.WEAPONS.grenade.proj.blast }; });
  const same = (a, b) => Math.abs(a - b) < .02;
  ok(same(bl.gr.c, 1) && same(bl.mi.c, 1), '爆心では旧来（グレネード）も追加（ミサイル）も威力どおり ' + JSON.stringify(bl));
  ok(same(bl.gr.e, .4375) && same(bl.mi.e, .4375), '半径の75%の所では、どちらも43.75%（端で25%） ' + JSON.stringify(bl));
  ok(bl.gr.w === 0 && bl.mi.w === 0, '間に壁があると、どちらも効かない ' + JSON.stringify(bl));
  // ④ 満タンの蓄積エナジー砲は、当てた相手に直撃（頭は倍率あり）
  const lec = await ev(() => { const g = __g, p = g.player, e = window.__e, T = g.T; p.slots.main = g.slotOf('lec'); g.selectWeapon(p, 'main'); p.switchT = 0;
    Object.assign(e, { hp: 1e7, maxHp: 1e7, stun: '', stunT: 0 }); e.pos.copy(p.pos).addScaledVector(g.fwdOf(p).setY(0).normalize(), 20); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true);
    const sl = p.slots.main; sl.cd = 0; const aim = g.targetPoint(e);
    for (let t = 0; t < 1.6; t += .05) g.weaponsTick(p, .05, true, aim, 0); g.weaponsTick(p, .05, false, aim, 0);
    return { lost: 1e7 - e.hp, mult: Math.min(...Object.keys(e.partArmor).map(k => g.armorMult(e, k))), full: 1370 * 2.5 }; });
  ok(lec.lost > lec.full * lec.mult * .95, `満タンの蓄積エナジー砲は当てた相手に満タンの威力が直撃で入る（${Math.round(lec.lost)} / ${lec.full}×装甲）`);
});
