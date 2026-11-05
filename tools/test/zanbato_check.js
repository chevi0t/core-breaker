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
  const boost = await ev(() => +(__g.player.dashV * __g.SHORT_TIME).toFixed(2));
  ok(full.charge === 1 && Math.abs(full.peak - 2 * (await ev(() => __g.player.dashV))) < 1 && full.moved > 2 * boost - 1 && full.moved < 2 * boost + 6 && full.dmg > 4000 && full.stun === 'stagger' && !full.sheathed,
    `満タンの居合：前ブースト（${boost}m）の2倍の距離を2倍の速さで踏み込み（${full.moved}m）、威力5000でよろけ、撃つと抜刀に戻る ` + JSON.stringify(full));
  await put(22);
  const tap = await iai(4);
  ok(tap.moved > boost - 1 && tap.moved < full.moved - 5 && tap.dmg === 0, `短い居合は前ブーストくらいの距離（${tap.moved}m、22m先の相手には届かない）`);
  await put(9);
  const near = await iai(4);
  ok(near.dmg > 2900 * mult && near.dmg < 3600 * mult && near.stun === 'stagger', `短い居合でも近ければ当たり、威力約3000でよろけ（${near.dmg}） ` + JSON.stringify(near));
  // ロックした敵を通り過ぎない（オーナー 2026-11-06「ロックオンした敵通り過ぎちゃったり」）。連続技・居合・ダッシュ技
  const pass = (mode, d) => ev(([mode, d]) => { const g = __g, p = g.player, e = window.__e, sl = p.slots.aux, dt = 1 / 60, f = g.fwdOf(p).setY(0).normalize(); g.lock.target = e;
    const hp = e.hp; let minD = 1e9, ahead = 1e9;
    const meas = () => { const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z; minD = Math.min(minD, Math.hypot(dx, dz)); ahead = Math.min(ahead, dx * f.x + dz * f.z); };
    if (mode === 'iai') { sl.sheathed = true; for (let i = 0; i < 70; i++) g.swordTick(p, sl, dt, true, g.targetPoint(e)); }
    if (mode === 'dash') { p.dashT = .2; p.dashDir = f.clone(); p.vel.set(f.x * 40, 0, f.z * 40); }
    for (let i = 0; i < 150; i++) { const trig = mode === 'combo' ? [0, 12, 24, 36].includes(i) : mode === 'dash' ? i === 0 : false;
      g.swordTick(p, sl, dt, trig, g.targetPoint(e)); g.physics(p, new g.T.Vector3(), false, false, dt); meas();
      if (e.stunT > 0) e.stunT -= dt; if (e.stunT <= 0 && e.stun === 'stagger') e.stun = ''; }
    g.lock.target = null; return { minD: +minD.toFixed(2), ahead: +ahead.toFixed(2), dmg: Math.round(hp - e.hp) }; }, [mode, d]);
  for (const [mode, d] of [['combo', 7], ['dash', 12]]) {
    await put(d); const r = await pass(mode, d);
    ok(r.ahead > 2 && r.minD > 2.4 && r.dmg > 0, `${mode}：ロックした敵（${d}m先）の手前で止まって当てる（一番近づいて ${r.minD}m、通り過ぎない） ` + JSON.stringify(r));
  }
  // ロックした敵へ吸いつく（オーナー 2026-11-06「ロックオンしてもあんまり敵の方に吸いつかんね」）：12m先・斜め50度でも1段目が届く
  const pull = side => ev(side => { const g = __g, p = g.player, e = window.__e, sl = p.slots.aux, dt = 1 / 60, f = g.fwdOf(p).setY(0).normalize(), rt = new g.T.Vector3(-f.z, 0, f.x);
    e.pos.copy(p.pos).addScaledVector(f, 12 * Math.cos(side)).addScaledVector(rt, 12 * Math.sin(side)); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.group.position.copy(e.pos);
    g.lock.target = e; const hp = e.hp; let minD = 1e9;
    for (let i = 0; i < 60; i++) { g.swordTick(p, sl, dt, i === 0, g.targetPoint(e)); g.physics(p, new g.T.Vector3(), false, false, dt); minD = Math.min(minD, Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)); }
    g.lock.target = null; return { dmg: Math.round(hp - e.hp), minD: +minD.toFixed(2) }; }, side);
  for (const side of [0, 50 * Math.PI / 180]) {
    await put(12); const r = await pull(side);
    ok(r.dmg > 1500 && r.minD > 2.4, `ロックした敵へ吸いつく：12m先・${Math.round(side * 180 / Math.PI)}度の敵へ1段目で詰めて当てる ` + JSON.stringify(r));
  }
  // 居合は通り道の前にいる刃の届く敵を全員斬る（オーナー 2026-11-06）。正面・左右にずれた3機、届かない横の1機
  const multi = await ev(() => { const g = __g, p = g.player, sl = p.slots.aux, dt = 1 / 60, f = g.fwdOf(p).setY(0).normalize(), rt = new g.T.Vector3(-f.z, 0, f.x);
    const foes = g.units.filter(q => q.team !== p.team).slice(0, 4), spots = [[6, 0], [12, 2.5], [18, -3], [12, 9]];
    foes.forEach((e, i) => { Object.assign(e, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, stun: '', stunT: 0, downT: 0, frozen: true }); e.group.visible = true;
      e.pos.copy(p.pos).addScaledVector(f, spots[i][0]).addScaledVector(rt, spots[i][1]); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 20); e.group.position.copy(e.pos); });
    g.lock.target = null; sl.sheathed = true; sl.chargeT = 0;
    for (let i = 0; i < 70; i++) g.swordTick(p, sl, dt, true, null);
    for (let i = 0; i < 70; i++) { g.swordTick(p, sl, dt, false, null); g.physics(p, new g.T.Vector3(), false, false, dt); }
    const r = foes.map(e => [Math.round(1e6 - e.hp), e.stun]);
    foes.forEach((e, i) => { if (e !== window.__e) { e.alive = false; e.group.visible = false; e.pos.set(9999, 0, 9999); } });
    return r; });
  ok(multi.length === 4 && multi.slice(0, 3).every(([d, s]) => d > 3000 && s === 'stagger') && multi[3][0] === 0, '居合は通り道の前で刃の届く3機を全員斬ってよろけさせ、9m横の1機には届かない ' + JSON.stringify(multi));
  // 型ごとの居合（オーナー 2026-11-06 カードで「連閃・重閃」）：強装型は満タンで抜けた直後にもう一度押すと二の太刀、重装型は溜め1.5秒で当てた敵をダウン
  const variant = (key, hold, presses) => ev(([key, hold, presses]) => { const g = __g, p = g.player, e = window.__e, dt = 1 / 60; p.slots.aux = g.slotOf(key); g.selectWeapon(p, 'aux'); p.switchT = 0;
    const sl = p.slots.aux, from = p.pos.clone(), hp = e.hp, names = []; sl.sheathed = true; sl.chargeT = 0; sl.cd = 0;
    for (let i = 0; i < hold; i++) g.swordTick(p, sl, dt, true, null);
    const charge = +(sl.chargeT / sl.w.iai.charge).toFixed(2);
    for (let i = 0; i < 120; i++) { g.swordTick(p, sl, dt, presses.includes(i), null); g.physics(p, new g.T.Vector3(), false, false, dt); const n = p.swing?.a.dashName; if (n && !names.includes(n)) names.push(n); }
    const r = { charge, names, moved: +Math.hypot(p.pos.x - from.x, p.pos.z - from.z).toFixed(1), dmg: Math.round(hp - e.hp), stun: e.stun };
    p.slots.aux = g.slotOf('sabre'); g.selectWeapon(p, 'aux'); return r; }, [key, hold, presses]);
  await put(30);
  const ren = await variant('sabreH', 70, [8]);
  ok(ren.names.length === 2 && ren.moved > 40 && ren.dmg > 0, `強装型の連閃：満タンで抜けた直後にもう一度押すと二の太刀（${ren.moved}m、30m先の敵に届く） ` + JSON.stringify(ren));
  await put(30);
  const single = await variant('sabreH', 70, []);
  ok(single.names.length === 1 && single.moved < 25, '強装型も押さなければ1回だけ ' + JSON.stringify(single));
  await put(15);
  const heavyShort = await variant('sabreM', 70, []);
  ok(heavyShort.charge < 1 && heavyShort.stun === 'down', `重装型の重閃：溜めは1.5秒（1.17秒で${Math.round(heavyShort.charge * 100)}%）、当てた敵はダウン ` + JSON.stringify(heavyShort));
  // R で納刀・抜刀（プレイヤーの入力）
  const toggle = await ev(() => { const g = __g, p = g.player, sl = p.slots.aux; Object.assign(p, { swing: null }); sl.sheathed = false;
    g.pressed.KeyR = true; g.playerUpdate(p, 1 / 60); g.pressed.KeyR = false; const a = sl.sheathed; g.pressed.KeyR = true; g.playerUpdate(p, 1 / 60); g.pressed.KeyR = false; return [a, sl.sheathed]; });
  ok(toggle[0] === true && toggle[1] === false, 'R で納刀し、もう一度で抜刀');
});
