// スタナーと電撃の痺れの見た目（2026-11-05、オーナー「遊撃にスタングレネードあるけどスタンエフェクトがないので、痺れエフェクトを作成し、適用してください。
// また、支援の補助装備にスタナーを追加してください。チャージ武器、前方にスタン範囲を形成する武器。低ダメージだが敵の機動を妨害。」）
// node tools/test/stunner_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('スタナーと電撃の痺れ', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('wide', { render: true });
  ok(await ev(() => __g.ARMORY.support.aux.includes('stunner') && __g.WEAPONS.stunner.chargeTime > 0 && __g.MODEL_OF.stunner[0] === 'stunner'), '支援の補助装備にスタナーがあり、溜め武器で、専用の形');
  // 準備：プレイヤーを支援にしてスタナーを持たせ、敵機を1機だけ前に置く
  await ev(() => { const g = __g, p = g.player; p.slots.aux = g.slotOf('stunner'); g.selectWeapon(p, 'aux'); p.switchT = 0; p.invulT = 0;
    window.__e = g.units.find(q => q.team !== p.team);
    for (const q of g.units) if (q !== p && q !== window.__e) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); } });
  const put = d => ev(d => { const g = __g, p = g.player, e = window.__e, f = g.fwdOf(p).setY(0).normalize();
    Object.assign(e, { alive: true, hp: e.maxHp, invulT: 0, shockT: 0, electricT: 0, stun: '', downT: 0, dashT: 0, act: null }); e.pos.copy(p.pos).addScaledVector(f, d); e.vel.set(0, 0, 0); e.group.position.copy(e.pos);
    for (const s of g.stunFields.splice(0)) g.scene.remove(s.mesh); }, d);
  const fire = hold => ev(hold => { const g = __g, p = g.player, sl = p.slots.aux, aim = g.targetPoint(window.__e); sl.cd = 0; sl.ammo = sl.w.mag;
    for (let t = 0; t < hold - 1e-9; t += .05) g.weaponsTick(p, .05, true, aim, 0); g.weaponsTick(p, .05, false, aim, 0);
    const f = g.stunFields[g.stunFields.length - 1]; return f && { len: f.len, life: f.life, dmg: f.dmg }; }, hold);
  // 満タンで撃つ
  await put(12);
  const full = await fire(1.1);
  ok(full && Math.abs(full.len - 18) < .01 && Math.abs(full.life - 1.4) < .06 && full.dmg === 1200, '満タンで離すと前方18mの範囲、1.4秒、威力1200');
  const hp0 = await ev(() => window.__e.hp);
  await ev(() => __g.stunFieldUpdate(1 / 60));
  const r1 = await ev(() => { const g = __g, e = window.__e; return { lost: e.maxHp - e.hp, mult: g.armorMult(e), shock: e.shockT }; });
  ok(Math.abs(r1.lost - 1200 * r1.mult) < 2 && r1.shock > .7, '範囲の敵機は1回だけ小さなダメージを受け、機動の妨害がかかる');
  await ev(() => { for (let i = 0; i < 20; i++) __g.stunFieldUpdate(1 / 60); });
  ok(await ev(e => window.__e.maxHp - window.__e.hp) === r1.lost, '範囲の中に居続けても、ダメージは1回だけ');
  ok(await ev(() => { const g = __g, e = window.__e, b = e.boost; return !g.shortDash(e, g.fwdOf(e)) && e.boost === b; }), '妨害の間はショートダッシュできない');
  const walk = await ev(() => { const g = __g, e = window.__e, T = g.T; e.onGround = true; e.vel.set(0, 0, 0);
    for (let i = 0; i < 30; i++) { e.shockT = Math.max(e.shockT, .5); g.physics(e, new T.Vector3(1, 0, 0), true, true, 1 / 60); }
    return { sp: Math.hypot(e.vel.x, e.vel.z), walk: e.walkV, up: e.vel.y }; });
  ok(walk.sp <= walk.walk * .36 && walk.up <= 0, `妨害の間はブーストを押しても歩きの35%まで（${walk.sp.toFixed(1)} m/s）、ジャンプもできない`);
  ok(await ev(() => { const fx = window.__e.shockFx; return fx && fx.root.visible && fx.lines.userData.parts[0].count === 4 * 5; }) || (await ev(() => { __g.shockLook(window.__e, .05); const fx = window.__e.shockFx; return fx && fx.root.visible && fx.lines.userData.parts[0].count === 20; })), '妨害中の敵機には放電（4本）をまとわせる');
  // 軽く押しただけ
  await put(6);
  const tap = await fire(.05);
  ok(tap && tap.len < 9 && tap.dmg < 400, `軽く押すと短い範囲（${tap && tap.len.toFixed(1)}m、威力${tap && tap.dmg}）`);
  // 範囲の外は効かない
  await put(30);
  await fire(1.1); await ev(() => __g.stunFieldUpdate(1 / 60));
  ok(await ev(() => window.__e.hp === window.__e.maxHp && !(window.__e.shockT > 0)), '範囲より遠い敵機には効かない');
  // 範囲が時間で消える
  await ev(() => { for (let i = 0; i < 100; i++) __g.stunFieldUpdate(1 / 60); });
  ok(await ev(() => __g.stunFields.length === 0), '範囲は時間が来ると消える');
  // 見た目の写真
  await put(11); await fire(1.1); await ev(() => __g.stunFieldUpdate(1 / 60)); await step(2);
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
  // Bot もスタナーを使う
  const botUsed = await ev(() => { const g = __g, p = g.player, e = window.__e, render = g.renderer.render;
    e.slots.aux = g.slotOf('stunner'); e.cls = 'support'; Object.assign(e, { alive: true, hp: e.maxHp, electricT: 0, stun: '', shockT: 0, actCd: 99, act: null });
    p.alive = true; p.invulT = 0; e.pos.copy(p.pos).addScaledVector(g.fwdOf(p), 10); e.target = p;
    const at = e.pos.clone(), log = [];
    g.renderer.render = () => {};
    try {
      for (let i = 0; i < 200 && !g.stunFields.some(f => f.owner === e); i++) {
        for (const q of g.units) if (q !== p && q !== e) { q.alive = false; q.respawnT = 99; q.pos.set(9999, 0, 9999); } // ほかの機体と砲台に邪魔させない
        for (const t of g.turrets) t.alive = false;
        Object.assign(e, { stun: '', downT: 0, electricT: 0 });
        e.pos.copy(at); e.vel.set(0, 0, 0); e.target = p; e.actCd = 99; e.act = null; p.hp = p.maxHp; p.alive = true; e.alive = true; e.hp = e.maxHp;
        g.loop(window.__t = (window.__t || 0) + 50);
        if (i % 20 === 0) log.push([e.weapon, +e.switchT.toFixed(2), +e.slots.aux.chargeT.toFixed(2), e.target === p, e.stun]);
      }
    } finally { g.renderer.render = render; }
    return g.stunFields.some(f => f.owner === e) || JSON.stringify(log); });
  ok(botUsed === true, 'Bot も近い敵機にスタナーを溜めて撃つ' + (botUsed === true ? '' : ' ' + botUsed));
});
