// オートショットガンの特性4種（2026-11-07、オーナー「特性4種ぐらい作って、特性別に性能調整して実装してください」）。
// 速射型（引きっぱなしで連射）、三点射型（1回で3発）、炸裂型（当たった所で爆ぜる・距離で減らない）、集束型（溜めるとまとまって遠くまで届く）
// node tools/test/autosg_traits_check.js [dbg]
const { check } = require('./lib');
check('オートショットガンの特性', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  await ev(() => { const g = __g, p = g.player; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const list = await ev(() => __g.ARMORY.support.main.filter(k => k.startsWith('autosg')).map(k => __g.WEAPONS[k].name));
  ok(list.length === 6 && ['速射型', '三点射型', '炸裂型', '集束型'].every(t => list.some(n => n.endsWith(t))), '支援の主武器にオートショットガンの4つの型が並ぶ ' + list.join('／'));
  // 撃つ：key の武器で、d m先の敵へ hold 秒引き続けて離す。敵の減った耐久と撃った弾数を返す
  const shoot = (key, d, hold, aimOff = 0) => ev(([key, d, hold, aimOff]) => { const g = __g, p = g.player, e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    p.slots.main = g.slotOf(key); g.selectWeapon(p, 'main'); p.switchT = 0;
    if (aimOff) p.slots.main.w = { ...p.slots.main.w, spread: 0 }; // 地面を狙う試験は、散弾を広げずに狙った所へ
    Object.assign(e, { alive: true, hp: 1e7, maxHp: 1e7, invulT: 0, stun: '', stunT: 0, downT: 0, shockT: 0 });
    e.pos.copy(p.pos).addScaledVector(f, d); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true);
    const sl = p.slots.main, a0 = sl.ammo, aim = g.targetPoint(e).clone();
    let box = null;
    if (aimOff) { // 敵の横 aimOff m を狙う（体には当たらない）。敵の1.5m後ろに壁を立て、外れた粒は壁に当たる
      const side = new g.T.Vector3(-f.z, 0, f.x); aim.addScaledVector(side, aimOff);
      box = new g.T.Mesh(new g.T.BoxGeometry(12, 10, .6), new g.T.MeshBasicMaterial()); box.position.copy(e.pos).addScaledVector(f, 1.5).add(new g.T.Vector3(0, 4, 0));
      box.lookAt(box.position.clone().add(f)); g.scene.add(box); box.updateMatrixWorld(true); g.hittables.push(box); }
    for (let t = 0; t < hold; t += .02) g.weaponsTick(p, .02, true, aim, 0);
    for (let i = 0; i < 20; i++) g.weaponsTick(p, .02, false, aim, 0);
    if (box) { g.scene.remove(box); g.hittables.splice(g.hittables.indexOf(box), 1); }
    return { lost: 1e7 - e.hp, shots: a0 - sl.ammo }; }, [key, d, hold, aimOff]);
  const V = await shoot('autosgV', 5, 1);
  const base = await shoot('autosg', 5, 1);
  ok(V.shots >= 4 && V.shots > base.shots, `速射型：引きっぱなしで1秒に${V.shots}発（標準は${base.shots}発）`);
  const K = await shoot('autosgK', 5, .05);
  ok(K.shots === 3, `三点射型：1回押すと3発（${K.shots}発）`);
  const Kfar = await shoot('autosgK', 25, .05), Bfar = await shoot('autosg', 25, .05);
  ok(Kfar.lost > Bfar.lost, `三点射型は25m先で1回の押しが標準より削る（${Math.round(Kfar.lost)} > ${Math.round(Bfar.lost)}）`);
  // 炸裂型：敵の横2.2mを狙い、外れて後ろの壁に当たっても爆風で削れる。標準の散弾は外れたら効かない
  const Zg = await shoot('autosgZ', 15, .05, 2.2), Bg = await shoot('autosg', 15, .05, 2.2);
  ok(Zg.lost > 0 && Bg.lost === 0, `炸裂型は敵の横に外して後ろの壁に当たっても爆風で削れる（${Math.round(Zg.lost)}、標準は${Math.round(Bg.lost)}）`);
  const Zn = await shoot('autosgZ', 8, .05), Zf = await shoot('autosgZ', 40, .05);
  const zSpec = await ev(() => ({ dmg: __g.WEAPONS.autosgZ.dmg, n: __g.WEAPONS.autosgZ.pellets, falloff: !!__g.WEAPONS.autosgZ.falloff }));
  ok(!zSpec.falloff && Zf.lost > 0, `炸裂型は距離で威力が落ちない（8m ${Math.round(Zn.lost)}・40m ${Math.round(Zf.lost)}）`);
  // 集束型：満タンで撃つと、軽く撃つより30m先でよく削る
  const Ntap = await shoot('autosgN', 30, .04), Nfull = await shoot('autosgN', 30, 1);
  ok(Ntap.shots === 1 && Nfull.shots === 1, '集束型：溜めて離すと1発');
  ok(Nfull.lost > Ntap.lost * 2, `集束型：満タンは30m先で軽く撃つより大きく削る（${Math.round(Nfull.lost)} > ${Math.round(Ntap.lost)}×2）`);
  const card = await ev(() => { const g = __g, w = g.WEAPONS.autosgN; return typeof g.wStats === 'function' ? g.wStats(w).join('、') : ''; });
  if (card) ok(/届く距離×2/.test(card), '集束型のカードに「届く距離×2」 ' + card);
});
