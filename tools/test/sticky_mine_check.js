// 衝撃吸着地雷（2026-11-06、オーナー「壁に張り付きはするけど、上方向に検知判定あるからクレイモア的に使えない」）。
// 壁に貼りついた地雷は面の正面（60度以内）だけを感知し、上や裏は感知しない。地面に置いた地雷は今までどおり球で感知する。
// node tools/test/sticky_mine_check.js [dbg]
const { check } = require('./lib');
check('衝撃吸着地雷の感知の向き', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  // 準備：敵を1機だけ残す。地雷は自分の物として、壁（面の向き +x）か地面（上向き）に貼る
  await ev(() => { const g = __g, p = g.player; window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.pos.set(9999, 0, 9999); } });
  const sense = (normal, off) => ev(([normal, off]) => { const g = __g, T = g.T, p = g.player, e = window.__e, S = g.WEAPONS.delayMine.proj;
    for (const q of g.gadgets.slice()) g.removeGadget(q);
    const at = p.pos.clone().add(new T.Vector3(0, 2, 30)); at.y = g.groundAt(at.x, at.z, at.y + 20) + (normal[1] > .7 ? 0 : 2);
    g.placeGadget({ spec: S, owner: p, team: p.team, weaponName: '衝撃吸着地雷', vel: new T.Vector3(-normal[0], -normal[1], -normal[2]) }, at, null, new T.Vector3(...normal));
    const m = g.gadgets[g.gadgets.length - 1]; m.armT = 0;
    Object.assign(e, { alive: true, invulT: 0, hp: 1e6, maxHp: 1e6, frozen: true }); e.pos.copy(at).add(new T.Vector3(...off)); e.pos.y -= g.UNIT_H * .5; e.vel.set(0, 0, 0);
    g.gadgetUpdate(1 / 60);
    const r = { face: m.face ? m.face.toArray().map(v => +v.toFixed(2)) : null, fired: m.triggerT != null };
    g.removeGadget(m); return r; }, [normal, off]);
  const wall = [1, 0, 0];
  const front = await sense(wall, [4, 0, 0]);
  ok(front.face && front.fired, '壁の地雷：正面4mの敵を感知する ' + JSON.stringify(front));
  const slant = await sense(wall, [3, 0, 3]);
  ok(slant.fired, '壁の地雷：斜め前（45度）の敵も感知する ' + JSON.stringify(slant));
  const above = await sense(wall, [.5, 4, 0]);
  ok(!above.fired, '壁の地雷：真上の敵は感知しない ' + JSON.stringify(above));
  const side = await sense(wall, [.3, 0, 4]);
  ok(!side.fired, '壁の地雷：壁沿いの横の敵は感知しない ' + JSON.stringify(side));
  const back = await sense(wall, [-4, 0, 0]);
  ok(!back.fired, '壁の地雷：壁の裏の敵は感知しない ' + JSON.stringify(back));
  const ground = await sense([0, 1, 0], [0, 4, 0]);
  ok(!ground.face && ground.fired, '地面の地雷：今までどおり球で感知する（上4mでも） ' + JSON.stringify(ground));
});
