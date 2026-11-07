// オートショットガンの特性4種（2026-11-07、オーナー「特性4種ぐらい作って、特性別に性能調整して実装してください」）。
// 速射型（引きっぱなしで連射）、三点射型（1回で3発）、精密型（散弾を絞った重い1発・6発）、大容量型（軽い1発を18発）。炸裂・溜めの仕組みは使わない
// node tools/test/autosg_traits_check.js [dbg]
const { check } = require('./lib');
check('オートショットガンの特性', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  await ev(() => { const g = __g, p = g.player; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const list = await ev(() => __g.ARMORY.support.main.filter(k => k.startsWith('autosg')).map(k => __g.WEAPONS[k].name));
  ok(list.length === 6 && ['速射型', '三点射型', '精密型', '大容量型'].every(t => list.some(n => n.endsWith(t))), '支援の主武器にオートショットガンの4つの型が並ぶ ' + list.join('／'));
  // 撃つ：key の武器で、d m先の敵へ hold 秒引き続けて離す。敵の減った耐久と撃った弾数を返す
  const shoot = (key, d, hold) => ev(([key, d, hold]) => { const g = __g, p = g.player, e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    p.slots.main = g.slotOf(key); g.selectWeapon(p, 'main'); p.switchT = 0;
    Object.assign(e, { alive: true, hp: 1e7, maxHp: 1e7, invulT: 0, stun: '', stunT: 0, downT: 0, shockT: 0 });
    e.pos.copy(p.pos).addScaledVector(f, d); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true);
    const sl = p.slots.main, a0 = sl.ammo, aim = g.targetPoint(e).clone();
    for (let t = 0; t < hold; t += .02) g.weaponsTick(p, .02, true, aim, 0);
    for (let i = 0; i < 20; i++) g.weaponsTick(p, .02, false, aim, 0);
    return { lost: 1e7 - e.hp, shots: a0 - sl.ammo }; }, [key, d, hold]);
  const V = await shoot('autosgV', 5, 1);
  const base = await shoot('autosg', 5, 1);
  ok(V.shots >= 4 && V.shots > base.shots, `速射型：引きっぱなしで1秒に${V.shots}発（標準は${base.shots}発）`);
  const K = await shoot('autosgK', 5, .05);
  ok(K.shots === 3, `三点射型：1回押すと3発（${K.shots}発）`);
  const Kfar = await shoot('autosgK', 25, .05), Bfar = await shoot('autosg', 25, .05);
  ok(Kfar.lost > Bfar.lost, `三点射型は25m先で1回の押しが標準より削る（${Math.round(Kfar.lost)} > ${Math.round(Bfar.lost)}）`);
  // 精密型：散弾が絞られ1発が重い。25m先で1回撃つと標準より削る
  const spec = await ev(() => Object.fromEntries(['autosg', 'autosgP', 'autosgX'].map(k => { const w = __g.WEAPONS[k];
    return [k, { per: w.dmg * w.pellets, spread: w.spread, mag: w.mag, dmg: w.dmg, burst: w.burst || 0, blast: w.blast || w.directBlast || 0, charge: w.chargeTime || 0 }]; })));
  const B = spec.autosg, P = spec.autosgP, X = spec.autosgX;
  ok(P.spread < B.spread * .7 && P.dmg > B.dmg && P.mag < B.mag, `精密型：広がり${P.spread}（標準${B.spread}）・1粒${P.dmg}（標準${B.dmg}）・装弾${P.mag}（標準${B.mag}）`);
  let Pl = 0, Bl = 0, Pn = 0; // 散弾はばらつくので6回の合計で比べる
  for (let i = 0; i < 6; i++) { const a = await shoot('autosgP', 30, .05), b = await shoot('autosg', 30, .05); Pl += a.lost; Bl += b.lost; Pn += a.shots; }
  ok(Pn === 6 && Pl > Bl * 1.05, `精密型は30m先で1発が標準より削る（6発の合計 ${Math.round(Pl)} > ${Math.round(Bl)}×1.05）`);
  // 大容量型：1発は軽いが18発を続けて撃てる
  ok(X.mag >= 18 && X.per < B.per && X.spread > B.spread, `大容量型：装弾${X.mag}・1発${X.per}（標準${B.per}）・広がり${X.spread}`);
  const Xall = await shoot('autosgX', 5, 10);
  ok(Xall.shots === X.mag, `大容量型：引き続けると${Xall.shots}発続けて撃てる`);
  ok([P, X].every(w => !w.blast && !w.charge), '精密型・大容量型は爆風も溜めも無い（拡散・威力・装弾数だけの差）');
});
