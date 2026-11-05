// 斬馬刀（日本刀の作り直し、2026-11-06 オーナー「日本刀がモーションショボい」「変形武器化」→抜刀・納刀、「斬馬刀ぐらいでっかく」、
// 「コンボ的に格闘叩き込めたら」「連続してザシュザシュザシュ！」）。
// 押すたびにつながる4段の連続技（当てると怯み、締めはダウン）、R の納刀と居合（溜めで突進距離と威力）、刃の大きさと弾の素通り。
// node tools/test/zanbato_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('斬馬刀の連続技と居合', async ({ ev, ok, sortie }) => {
  await sortie('wide');
  const def = await ev(() => { const W = __g.WEAPONS; return ['sabre', 'sabreH', 'sabreM'].map(k => [k, W[k]?.combo?.map(a => a.dmg), W[k]?.normal === W[k]?.combo?.[0], !!W[k]?.iai]); });
  ok(JSON.stringify(def) === JSON.stringify([['sabre', [2000, 3500, 2800, 4500], true, true], ['sabreH', [2000, 4000, 3000, 8000], true, true], ['sabreM', [2000, 4000, 4500, 9000], true, true]]),
    '連続技の各段の威力（通常の各段・足りない段は平均・締めはダッシュの最後の段）' + JSON.stringify(def));
  // 準備：プレイヤーに日本刀、敵機を1機だけ前に置く（毎回プレイヤーを最初の場所へ戻す。突進で壁際へ行かないように）
  await ev(() => { const g = __g, p = g.player; p.slots.aux = g.slotOf('sabre'); g.selectWeapon(p, 'aux'); p.switchT = 0; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team); window.__p0 = p.pos.clone();
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const put = d => ev(d => { const g = __g, p = g.player, e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    Object.assign(p, { swing: null, meleeRecovery: null, slideT: 0, recoverT: 0, lungeT: 0, dashT: 0, longDash: false, stun: '', stunT: 0 }); p.pos.copy(window.__p0); p.vel.set(0, 0, 0); p.slots.aux.cd = 0; p.slots.aux.sheathed = false; p.slots.aux.chargeT = 0; p.slots.aux.comboHeld = false;
    Object.assign(e, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, shockT: 0, electricT: 0, stunT: 0, stun: '', downT: 0, dashT: 0, act: null, frozen: true });
    e.pos.copy(p.pos).addScaledVector(f, d); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.vel.set(0, 0, 0); e.group.position.copy(e.pos); g.lock.target = null; }, d);
  // presses：押すフレーム（60fps）。stages：見えた段、hits：段ごとの減り、stun：段の後の相手の状態
  const run = (presses, frames) => ev(([presses, frames]) => { const g = __g, p = g.player, e = window.__e, sl = p.slots.aux, dt = 1 / 60; const seen = [], log = [];
    let hp = e.hp;
    for (let i = 0; i < frames; i++) {
      g.swordTick(p, sl, dt, presses.includes(i), g.targetPoint(e));
      if (e.stunT > 0) e.stunT -= dt; if (e.stunT <= 0 && e.stun === 'stagger') e.stun = '';
      const st = p.swing?.a.combo; if (st != null && !seen.includes(st)) seen.push(st);
      if (e.hp < hp) { log.push({ stage: st, dmg: Math.round(hp - e.hp), stun: e.stun }); hp = e.hp; }
    }
    return { seen, log }; }, [presses, frames]);
  // 1回押すだけなら1段目だけ
  await put(4);
  const one = await run([0], 90);
  ok(JSON.stringify(one.seen) === '[0]' && one.log.length === 1, '1回押すだけなら1段目で止まる ' + JSON.stringify(one));
  // 押すたびに4段（ザシュザシュザシュ）
  await put(4);
  const four = await run([0, 12, 24, 36], 160);
  const mult = await ev(() => __g.armorMult(window.__e));
  ok(JSON.stringify(four.seen) === '[0,1,2,3]', '押すたびに次の段へつながり、4段出る ' + JSON.stringify(four.seen));
  ok(four.log.length === 4 && four.log.every((h, i) => Math.abs(h.dmg - [2000, 3500, 2800, 4500][i] * mult) < 2), '4段とも当たる（当てた相手は怯むので離れない） ' + JSON.stringify(four.log));
  ok(four.log.slice(0, 3).every(h => h.stun === 'stagger') && four.log[3].stun === 'down', '1〜3段目で怯み、締めの面打ちでダウン ' + JSON.stringify(four.log.map(h => h.stun)));
  // 押しっぱなしでは続かない（プレイヤーは押し直す）
  await put(4);
  const held = await run([...Array(150).keys()], 150);
  ok(held.seen.length === 1, '押しっぱなしでは1段目だけ（押し直すと続く）');
  // 先行入力：振り始めに押しておけば、振り切った所で次へ
  await put(4);
  const early = await run([0, 6], 60);
  ok(JSON.stringify(early.seen) === '[0,1]', '振っている途中で押しておくと、振り切った所で次の段へ');
  // 刃の大きさ：伸び縮みしない、弾を受けない
  const blade = await ev(() => { const g = __g, p = g.player; g.weaponLook(p, 1 / 60); const bb = p.blade.geometry.boundingBox || (p.blade.geometry.computeBoundingBox(), p.blade.geometry.boundingBox);
    return { len: +(.2 - bb.min.z).toFixed(2), scale: p.blade.scale.z, pass: !!p.blade.userData.passThrough }; });
  ok(Math.abs(blade.len - 4.04) < .05 && blade.scale === 1 && blade.pass, `刃は柄から${blade.len}m（間合い4.6mに合う実寸、伸び縮みなし）、弾は刃を素通りする`);
  // 納刀と居合
  const iai = hold => ev(hold => { const g = __g, p = g.player, e = window.__e, sl = p.slots.aux, dt = 1 / 60, from = p.pos.clone(); sl.sheathed = true; sl.chargeT = 0;
    const hp = e.hp; let peak = 0;
    for (let i = 0; i < hold; i++) g.swordTick(p, sl, dt, true, g.targetPoint(e));
    const charge = sl.chargeT;
    for (let i = 0; i < 70; i++) { g.swordTick(p, sl, dt, false, g.targetPoint(e)); g.physics(p, new g.T.Vector3(), false, false, dt); peak = Math.max(peak, Math.hypot(p.vel.x, p.vel.z)); }
    return { charge: +charge.toFixed(2), moved: +Math.hypot(p.pos.x - from.x, p.pos.z - from.z).toFixed(1), dmg: Math.round(hp - e.hp), stun: e.stun, sheathed: sl.sheathed, peak: +peak.toFixed(1) }; }, hold);
  await put(22);
  const full = await iai(70);
  ok(full.charge === 1 && full.moved > 16 && full.dmg > 6000 * mult && full.stun === 'down' && !full.sheathed, `満タンの居合：突進して斬り抜け（${full.moved}m）、威力6500でダウン、撃つと抜刀に戻る ` + JSON.stringify(full));
  await put(22);
  const tap = await iai(4);
  ok(tap.moved > 5 && tap.moved < full.moved - 5 && tap.dmg === 0, `短い居合は突進が短い（${tap.moved}m、22m先の相手には届かない）`);
  await put(9);
  const near = await iai(4);
  ok(near.dmg > 2900 * mult && near.dmg < 3600 * mult && near.stun === 'stagger', `短い居合でも近ければ当たり、威力約3000でよろけ（${near.dmg}） ` + JSON.stringify(near));
  // R で納刀・抜刀（プレイヤーの入力）
  const toggle = await ev(() => { const g = __g, p = g.player, sl = p.slots.aux; Object.assign(p, { swing: null }); sl.sheathed = false;
    g.pressed.KeyR = true; g.playerUpdate(p, 1 / 60); g.pressed.KeyR = false; const a = sl.sheathed; g.pressed.KeyR = true; g.playerUpdate(p, 1 / 60); g.pressed.KeyR = false; return [a, sl.sheathed]; });
  ok(toggle[0] === true && toggle[1] === false, 'R で納刀し、もう一度で抜刀');
});
