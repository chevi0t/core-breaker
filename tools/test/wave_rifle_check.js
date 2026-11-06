// 波動ライフルの作り直し（2026-11-07、オーナー「あまりにも現状弱い」、カードで「両方強化・溜めでよろけ」）。
// 短押しの威力 ×1.28・射程300m、満タンの倍率 標準3.2・広域型2.4（爆ぜる）・強装型3.8、満タンの弾は一番固い装甲でもよろける（chargeKnock 1.6）
// node tools/test/wave_rifle_check.js [dbg]
const { check } = require('./lib');
check('波動ライフル', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  const W = await ev(() => { const W = __g.WEAPONS; return ['wave', 'waveW', 'waveH'].map(k => ({ k, dmg: W[k].dmg, mul: W[k].chargeMul, range: W[k].range, knock: W[k].chargeKnock || 0, rpm: W[k].rpm })); });
  ok(W[0].dmg === 1150 && W[1].dmg === 1020 && W[2].dmg === 1240, '短押しの威力 1150／1020／1240 ' + W.map(w => w.dmg));
  ok(W.every(w => w.range === 300), '射程300m');
  ok(W[0].mul === 3.2 && W[1].mul === 2.4 && W[2].mul === 3.8, '満タンの倍率 3.2／2.4／3.8');
  ok(W[0].dmg * W[0].rpm / 60 >= 5500, '短押しの連打は毎秒5500以上（マークスマン並み） ' + W[0].dmg * W[0].rpm / 60);
  const shoot = async (key, hold) => ev(([key, hold]) => {
    const g = __g, p = g.player, e = g.units.find(q => q.team !== p.team), f = g.fwdOf(p).setY(0).normalize();
    for (const q of g.units) if (q !== p && q !== e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); }
    g.equip(p, 'assault'); p.slots.main = g.slotOf(key); Object.assign(p, { weapon: 'main', switchT: 0, recoil: 0, recoilYaw: 0 });
    const tough = Math.min(...g.PARTS.body ? Object.values(g.PARTS.body).map(x => x.armor).filter(Number.isFinite) : [1]);
    Object.assign(e, { alive: true, hp: 1e7, maxHp: 1e7, invulT: 0, stun: '', stunT: 0, downT: 0, weakT: 0, armorAvg: tough, partArmor: { head: tough, body: tough, arms: tough, legs: tough } });
    e.pos.copy(p.pos).addScaledVector(f, 25); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); g.scene.updateMatrixWorld(true);
    const aim = e.pos.clone(); aim.y += 2.2; const sl = p.slots.main;
    for (let t = 0; t < hold; t += 1 / 60) g.gunTick(p, sl, 1 / 60, true, aim, 0);
    g.gunTick(p, sl, 1 / 60, false, aim, 0);
    return { lost: 1e7 - e.hp, stun: e.stun, tough };
  }, [key, hold]);
  const tap = await shoot('wave', .02), full = await shoot('wave', 1.3), fullH = await shoot('waveH', 1.6), fullW = await shoot('waveW', 1.1);
  ok(tap.lost > 0 && tap.stun !== 'stagger', '短押しは当たってもよろけない ' + Math.round(tap.lost));
  ok(full.lost > tap.lost * 2.5 && full.stun === 'stagger', '標準の満タンは一番固い装甲（' + full.tough + '）でもよろける ' + Math.round(full.lost));
  ok(fullH.stun === 'stagger' || fullH.stun === 'down', '強装型の満タンもよろける ' + Math.round(fullH.lost) + ' ' + fullH.stun);
  ok(fullW.lost > 0, '広域型の満タンは当たる（よろけは爆ぜる弾の役） ' + Math.round(fullW.lost));
});
