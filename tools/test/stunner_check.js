// スタンガンと電撃の痺れの見た目（2026-11-05、オーナー「遊撃にスタングレネードあるけどスタンエフェクトがないので、痺れエフェクトを作成し、適用してください。
// また、支援の補助装備にスタナーを追加してください。チャージ武器、前方にスタン範囲を形成する武器。低ダメージだが敵の機動を妨害。」）
// 2026-11-06 オーナー：ロックオン可、過熱は遅く（満タン保持8秒）、範囲の箱を消して放電だけ、弾無限・リロードなし、範囲とスタン時間は溜めで変わる、
// アーケード版 スタナー系統（J・J2・K）の比で型を2つ（持続型・広域型）。
// node tools/test/stunner_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('スタンガンと電撃の痺れ', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('wide', { render: true });
  ok(await ev(() => __g.ARMORY.support.aux.includes('stunner') && __g.WEAPONS.stunner.chargeTime > 0 && __g.MODEL_OF.stunner[0] === 'stunner'), '支援の補助装備にスタンガンがあり、溜め武器で、専用の形');
  // 準備：プレイヤーを支援にしてスタンガンを持たせ、敵機を1機だけ前に置く
  await ev(() => { const g = __g, p = g.player; p.slots.aux = g.slotOf('stunner'); g.selectWeapon(p, 'aux'); p.switchT = 0; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const put = d => ev(d => { const g = __g, p = g.player, e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    Object.assign(e, { alive: true, hp: e.maxHp, invulT: 0, shockT: 0, electricT: 0, stun: '', downT: 0, dashT: 0, act: null }); e.pos.copy(p.pos).addScaledVector(f, d); e.vel.set(0, 0, 0); e.group.position.copy(e.pos);
    for (const s of g.stunFields.splice(0)) g.scene.remove(s.mesh); }, d);
  const fire = hold => ev(hold => { const g = __g, p = g.player, sl = p.slots.aux, aim = g.targetPoint(window.__e); sl.cd = 0; sl.ammo = sl.w.mag;
    for (let t = 0; t < hold - 1e-9; t += .05) g.weaponsTick(p, .05, true, aim, 0); g.weaponsTick(p, .05, false, aim, 0);
    const f = g.stunFields[g.stunFields.length - 1]; return f && { len: f.len, width: f.width, shock: f.shock, life: f.life, dmg: f.dmg, kids: f.mesh.children.length, box: f.mesh.children.some(c => c.isMesh && !c.isInstancedMesh), ammo: sl.ammo }; }, hold);
  // 満タンで撃つ
  await put(9);
  const full = await fire(1.1);
  ok(full && Math.abs(full.len - 12) < .01 && Math.abs(full.width - 7) < .01 && Math.abs(full.shock - 1) < .01 && Math.abs(full.life - 1.4) < .06 && full.dmg === 1200, '満タンで離すと前方12m・幅7mの範囲、1.4秒、威力1200、妨害1秒');
  ok(full && !full.box && full.kids === 1, '範囲の見た目は放電だけ（四角い箱と縁は無い）');
  ok(full && full.ammo === 1, '撃っても弾は減らない（無限）');
  const hp0 = await ev(() => window.__e.hp);
  await ev(() => __g.stunFieldUpdate(1 / 60));
  const r1 = await ev(() => { const g = __g, e = window.__e; return { lost: e.maxHp - e.hp, mult: g.armorMult(e), shock: e.shockT }; });
  ok(Math.abs(r1.lost - 1200 * r1.mult) < 2 && r1.shock > .95, '範囲の敵機は1回だけ小さなダメージを受け、機動の妨害がかかる');
  await ev(() => { for (let i = 0; i < 20; i++) __g.stunFieldUpdate(1 / 60); });
  ok(await ev(e => window.__e.maxHp - window.__e.hp) === r1.lost, '範囲の中に居続けても、ダメージは1回だけ');
  ok(await ev(() => { const g = __g, e = window.__e, b = e.boost; return !g.shortDash(e, g.fwdOf(e)) && e.boost === b; }), '妨害の間はショートダッシュできない');
  const walk = await ev(() => { const g = __g, e = window.__e, T = g.T; e.onGround = true; e.vel.set(0, 0, 0);
    for (let i = 0; i < 30; i++) { e.shockT = Math.max(e.shockT, .5); g.physics(e, new T.Vector3(1, 0, 0), true, true, 1 / 60); }
    return { sp: Math.hypot(e.vel.x, e.vel.z), walk: e.walkV, up: e.vel.y }; });
  ok(walk.sp <= walk.walk * .36 && walk.up <= 0, `妨害の間はブーストを押しても歩きの35%まで（${walk.sp.toFixed(1)} m/s）、ジャンプもできない`);
  ok(await ev(() => { const fx = window.__e.shockFx; return fx && fx.root.visible && fx.lines.userData.parts[0].count === 4 * 5; }) || (await ev(() => { __g.shockLook(window.__e, .05); const fx = window.__e.shockFx; return fx && fx.root.visible && fx.lines.userData.parts[0].count === 20; })), '妨害中の敵機には放電（4本）をまとわせる');
  // 軽く押しただけ
  await put(4);
  const tap = await fire(.05);
  ok(tap && tap.len < 9 && tap.width < 5 && tap.shock < .45 && tap.dmg < 400, `軽く押すと狭い範囲と短い妨害（${tap && tap.len.toFixed(1)}m・幅${tap && tap.width.toFixed(1)}m・妨害${tap && tap.shock.toFixed(2)}秒、威力${tap && tap.dmg}）`);
  // 弾は無限、リロードなし
  const many = await ev(() => { const g = __g, p = g.player, sl = p.slots.aux, aim = g.targetPoint(window.__e); let n = 0;
    for (let k = 0; k < 6; k++) { for (let t = 0; t < 1.1; t += .05) g.weaponsTick(p, .05, true, aim, 0); const before = g.stunFields.length; g.weaponsTick(p, .05, false, aim, 0); if (g.stunFields.length > before) n++; for (let t = 0; t < .6; t += .05) g.weaponsTick(p, .05, false, aim, 0); }
    return { n, ammo: sl.ammo, reload: sl.reloadT }; });
  ok(many.n === 6 && many.ammo === 1 && !(many.reload > 0), `続けて6回撃てて、弾は減らずリロードもない（${many.n}回）`);
  // 過熱は遅い：満タンのまま8秒持つと過熱
  const oh = await ev(() => { const g = __g, p = g.player, sl = p.slots.aux, aim = g.targetPoint(window.__e); sl.cd = 0; sl.overheat = false; sl.chargeT = sl.holdT = 0;
    for (let t = 0; t < 1 + 7.5; t += .05) g.weaponsTick(p, .05, true, aim, 0); const a = sl.overheat;
    for (let t = 0; t < 1; t += .05) g.weaponsTick(p, .05, true, aim, 0); const b = sl.overheat;
    sl.overheat = false; sl.ohT = 0; sl.chargeT = sl.holdT = 0; g.weaponsTick(p, .05, false, aim, 0); return { a, b, hold: sl.w.chargeHold }; });
  ok(!oh.a && oh.b && oh.hold === 8, '満タンのまま7.5秒持っても過熱せず、8秒を過ぎると過熱する');
  // ロックオンできる
  ok(await ev(() => { const g = __g, p = g.player; g.selectWeapon(p, 'aux'); p.switchT = 0; return p.weapon === 'aux' && g.lockAllowed(p); }), 'スタンガンを持っているとロックオンできる');
  // 型（アーケード版 スタナーJ2・K の比）
  const types = await ev(() => { const g = __g, W = g.WEAPONS, F = k => W[k].stunField; return { list: g.ARMORY.support.aux.filter(k => k.startsWith('stunner')), D: [F('stunnerD').dmg, F('stunnerD').shock, F('stunnerD').len, W.stunnerD.chargeTime, W.stunnerD.kg, W.stunnerD.infinite, W.stunnerD.name], W: [F('stunnerW').dmg, F('stunnerW').shock, F('stunnerW').len, F('stunnerW').width, W.stunnerW.chargeTime, W.stunnerW.kg, W.stunnerW.name] }; });
  ok(JSON.stringify(types.list) === '["stunner","stunnerD","stunnerW"]', '支援の補助装備にスタンガンの3つの型が並ぶ');
  ok(JSON.stringify(types.D) === JSON.stringify([[200, 1600], [.6, 2], [5, 9.5], 2, 284, true, 'スタンガン・持続型']), '持続型（スタナーJ2）：威力200〜1600・妨害0.6〜2秒・範囲5〜9.5m・溜め2秒・284kg・弾無限 ' + JSON.stringify(types.D));
  ok(JSON.stringify(types.W) === JSON.stringify([[330, 1330], [.3, 1], [7.5, 15], [5, 9], 1.5, 301, 'スタンガン・広域型']), '広域型（スタナーK）：威力330〜1330・妨害0.3〜1秒・範囲7.5〜15m・幅5〜9m・溜め1.5秒・301kg ' + JSON.stringify(types.W));
  // 範囲の外は効かない
  await put(30);
  await fire(1.1); await ev(() => __g.stunFieldUpdate(1 / 60));
  ok(await ev(() => window.__e.hp === window.__e.maxHp && !(window.__e.shockT > 0)), '範囲より遠い敵機には効かない');
  // 範囲が時間で消える
  await ev(() => { for (let i = 0; i < 100; i++) __g.stunFieldUpdate(1 / 60); });
  ok(await ev(() => __g.stunFields.length === 0), '範囲は時間が来ると消える');
  // 見た目の写真
  await put(9); await fire(1.1); await ev(() => __g.stunFieldUpdate(1 / 60)); await step(2);
  await page.screenshot({ path: out + '/stunner_field.png' });
  // 電撃グレネードの硬直：痺れの見た目と、自機なら画面の縁と文字
  await ev(() => { const g = __g, e = window.__e; e.shockT = 0; for (const s of g.stunFields.splice(0)) g.scene.remove(s.mesh);
    g.blast({ spec: g.WEAPONS.stunGrenade.proj, team: g.player.team, owner: g.player }, e.pos.clone(), null); });
  await step(1);
  ok(await ev(() => { const e = window.__e; return e.electricT > 2 && e.stun === 'electric' && e.shockFx.root.visible && e.shockFx.lines.userData.parts[0].count === 8 * 5; }), '電撃グレネードで硬直した敵機には強い放電（8本）と青い光');
  await page.screenshot({ path: out + '/stun_grenade_enemy.png' });
  await ev(() => { const g = __g, p = g.player; p.electricT = 2; p.stun = 'electric'; p.stunT = 2; });
  await step(1);
  ok(await ev(() => { const el = document.getElementById('shockScreen'); return !el.hidden && !el.classList.contains('weak') && /電撃/.test(document.getElementById('center').textContent); }), '自機が痺れると画面の縁が青く光り、真ん中に「電撃」と残り秒');
  await page.screenshot({ path: out + '/stun_self.png' });
  await ev(() => { const p = __g.player; p.electricT = 0; p.stun = ''; p.stunT = 0; });
  await step(1);
  ok(await ev(() => document.getElementById('shockScreen').hidden && !__g.player.shockFx?.root.visible), '痺れが解けると見た目も消える');
  // Bot もスタンガンを使う
  const botUsed = await ev(() => { const g = __g, p = g.player, e = window.__e, render = g.renderer.render;
    e.slots.aux = g.slotOf('stunner'); e.cls = 'support'; Object.assign(e, { alive: true, hp: e.maxHp, electricT: 0, stun: '', shockT: 0, actCd: 99, act: null });
    p.alive = true; p.invulT = 0; e.pos.copy(p.pos).addScaledVector(g.fwdOf(p), 7); e.target = p;
    const at = e.pos.clone(), log = [];
    g.renderer.render = () => {};
    try {
      for (let i = 0; i < 200 && !g.stunFields.some(f => f.owner === e); i++) {
        for (const q of g.units) if (q !== p && q !== e) { q.alive = false; q.respawnT = 99; q.pos.set(9999, 0, 9999); } // ほかの機体と砲台に邪魔させない
        for (const t of g.turrets) t.alive = false;
        Object.assign(e, { stun: '', downT: 0, electricT: 0 });
        e.pos.copy(at); e.vel.set(0, 0, 0); e.target = p; e.actCd = 99; e.act = null; p.hp = p.maxHp; p.alive = true; p.shockT = 0; e.alive = true; e.hp = e.maxHp;
        g.loop(window.__t = (window.__t || 0) + 50);
        if (i % 20 === 0) log.push([e.weapon, +e.switchT.toFixed(2), +e.slots.aux.chargeT.toFixed(2), e.target === p, e.stun]);
      }
    } finally { g.renderer.render = render; }
    return g.stunFields.some(f => f.owner === e) || JSON.stringify(log); });
  ok(botUsed === true, 'Bot も近い敵機にスタンガンを溜めて撃つ' + (botUsed === true ? '' : ' ' + botUsed));
});
