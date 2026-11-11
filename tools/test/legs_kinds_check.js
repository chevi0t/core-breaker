// 四脚と逆脚の動き（#228）。node tools/test/legs_kinds_check.js [dbg] [出力] [変更前の dbg（あれば、二脚とホバーの動きが前と同じかを比べる）]
// ジャンプの高さ、溜めジャンプ、着地硬直、よろけの閾値、ばらつき・反動、踏ん張り（止まる・押されない）、空中の消費、構えの速さ、
// アクションの倍率、形（骨・被弾）、Bot が選ぶこと・踏ん張ること、二脚とホバーが前と同じ動きであることを見る。
const path = require('node:path');
const { check } = require('./lib');
const baseDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
// 二脚（標準）とホバー（スキマー）で、歩く・ダッシュ・ジャンプ・滞空・着地を一通りさせた記録
const trace = legs => {
  const g = __g, T = g.T, u = g.player;
  u.mech = { ...g.MECH_DEFAULT, legs }; g.equip(u, 'assault');
  Object.assign(u, { alive: true, pos: new T.Vector3(-20, 100, 0), vel: new T.Vector3(), onGround: false, stun: '', stunT: 0, jumpBuf: 0, catCd: 0, ctrlLockT: 0, dashT: 0, longDash: false, flying: false, zip: null, electricT: 0, transfer: null, repairing: false, actionHeld: false, crouching: false, boost: u.maxBoost, overheat: false });
  const out = [];
  for (let i = 0; i < 420; i++) {
    u.actionHeld = i > 330 && i < 380;
    g.physics(u, new T.Vector3(i < 150 || i > 300 ? 1 : 0, 0, 0), i >= 200 && i < 240, i === 190 || i === 260, 1 / 60, i > 270 && i < 300);
    if (i % 10 === 0) out.push([...u.pos.toArray(), ...u.vel.toArray(), u.boost, u.onGround, u.dashState, u.stun, u.crouching].map(v => typeof v === 'number' ? +v.toFixed(4) : v));
  }
  return out;
};
check('四脚と逆脚の動き', async ({ ev, step, ok, sortie, page, dir }) => {
  let before = null;
  if (baseDir) {
    await page.goto('file://' + path.join(baseDir, 'dbg.html')); await sortie('dock');
    before = { standard: await ev(trace, 'standard'), skimmer: await ev(trace, 'skimmer') };
    await page.goto('file://' + path.join(dir, 'dbg.html'));
  }
  await sortie('dock');
  if (before) for (const k of ['standard', 'skimmer']) ok(JSON.stringify(await ev(trace, k)) === JSON.stringify(before[k]), `${k}：歩き・ダッシュ・ジャンプ・滞空・着地・しゃがみが変更前と同じ`);
  const r = await ev(() => {
    const g = __g, T = g.T, u = g.player, res = {};
    const fit = (legs, cls = 'assault') => {
      u.mech = { ...g.MECH_DEFAULT, legs }; g.equip(u, cls);
      Object.assign(u, { alive: true, pos: new T.Vector3(-20, 100, 0), vel: new T.Vector3(), onGround: false, stun: '', stunT: 0, jumpBuf: 0, catCd: 0, ctrlLockT: 0, dashT: 0, longDash: false, flying: false, zip: null, electricT: 0, shockT: 0, transfer: null, repairing: false, planted: false, actionHeld: false, crouching: false, crouchT: 0, chargeJumpT: 0, boost: u.maxBoost, overheat: false, hp: u.maxHp, recoil: 0, invulT: 0 });
      for (let i = 0; i < 400 && !u.onGround; i++) g.physics(u, new T.Vector3(), false, false, 1 / 60);
      u.stun = ''; u.stunT = 0; u.boost = u.maxBoost; u.overheat = false;
    };
    const Z = new T.Vector3();
    // ジャンプの高さ。hold はしゃがむ秒
    const jump = (legs, hold = 0) => {
      fit(legs); const y0 = u.pos.y, b0 = u.boost; let top = 0;
      u.actionHeld = hold > 0;
      for (let i = 0; i < Math.round(hold * 60); i++) g.physics(u, Z, false, false, 1 / 60);
      u.actionHeld = false; const bj = u.boost;
      g.physics(u, Z, false, true, 1 / 60); const cost = bj - u.boost;
      for (let i = 0; i < 200 && !u.onGround; i++) { g.physics(u, Z, false, false, 1 / 60); top = Math.max(top, u.pos.y - y0); }
      return { top, cost };
    };
    res.jump = { standard: jump('standard'), dozer: jump('dozer'), dozer4: jump('dozer4'), hopper: jump('hopper'), hopper2: jump('hopper2'), charged: jump('hopper', .4), early: jump('hopper', .1), stdCrouch: jump('standard', .4) };
    // 着地硬直：落ちる速さ v で着地
    const landing = (legs, v) => { fit(legs); u.stun = ''; g.land(u, v, true); const o = { stun: u.stun, t: u.stunT }; u.stun = ''; return o; };
    res.land = { std30: landing('standard', 30), hop30: landing('hopper', 30), std36: landing('standard', 36), hop36: landing('hopper', 36), doz30: landing('dozer', 30) };
    // よろけ：amount で jolt。押された速さも見る
    const hit = (legs, amount, o = {}) => {
      fit(legs); u.crouching = !!o.crouch; u.vel.set(0, 0, 0);
      g.jolt(u, new T.Vector3(u.pos.x, u.pos.y, u.pos.z - 10), amount, !!o.melee, !!o.force);
      const out = { stun: u.stun, push: +Math.hypot(u.vel.x, u.vel.z).toFixed(2) }; u.stun = ''; u.crouching = false; return out;
    };
    res.jolt = {
      std3600: hit('standard', 3600), doz3600: hit('dozer', 3600), doz4600: hit('dozer', 4600), hop3200: hit('hopper', 3200), hop3100: hit('hopper', 3100),
      brace6000: hit('dozer', 6000, { crouch: true }), brace7000: hit('dozer', 7000, { crouch: true }), braceDown: hit('dozer', 13700, { crouch: true }),
      braceMelee: hit('dozer', 4000, { crouch: true, melee: true }), force: hit('dozer', 3000, { melee: true, force: true }), stdCrouch: hit('standard', 3600, { crouch: true }),
    };
    // ばらつきと反動
    const aim = (legs, crouch) => { fit(legs); u.crouching = !!crouch; const v = g.aimSpread(u) / u.aimMul; u.crouching = false; return +v.toFixed(4); };
    res.aim = { standard: aim('standard'), stdCrouch: aim('standard', true), dozer: aim('dozer'), brace: aim('dozer', true), dozer4: aim('dozer4'), hopper: aim('hopper') };
    const kick = legs => { fit(legs); u.recoil = 0; g.recoilKick(u, u.slots.main.w); return u.recoil; };
    res.recoil = { standard: kick('standard'), dozer: kick('dozer'), hopper: kick('hopper') };
    // 踏ん張り：しゃがんで前へ入力しても動かない（二脚のしゃがみは歩ける）
    const crawl = legs => { fit(legs); const x0 = u.pos.x; u.actionHeld = true; for (let i = 0; i < 60; i++) g.physics(u, new T.Vector3(1, 0, 0), false, false, 1 / 60); const o = { moved: +(u.pos.x - x0).toFixed(3), crouching: u.crouching, braced: g.legBraced(u) }; u.actionHeld = false; return o; };
    res.crawl = { standard: crawl('standard'), dozer: crawl('dozer'), hopper: crawl('hopper') };
    // 空中の滞空の消費（0.5秒）
    const hover = legs => { fit(legs); g.physics(u, Z, false, true, 1 / 60); for (let i = 0; i < 40; i++) g.physics(u, Z, false, false, 1 / 60); const b = u.boost; let n = 0; for (let i = 0; i < 30; i++) { g.physics(u, Z, false, false, 1 / 60, true); if (u.dashState === 'hover') n++; } return { used: +(b - u.boost).toFixed(3), n }; };
    res.hover = { standard: hover('standard'), dozer: hover('dozer') };
    // 構えの速さ：構える武器へ持ち替える時間
    const plant = legs => { fit(legs, 'heavy'); const k = g.SLOTS.find(s => u.slots[s].w.plant); if (!k) return null; g.selectWeapon(u, k); const t = u.switchT / u.swapMul; g.selectWeapon(u, 'main'); u.planted = false; return +t.toFixed(4); };
    res.plant = { standard: plant('standard'), dozer: plant('dozer'), time: g.SWITCH_TIME };
    // アクションの倍率
    const scale = (legs, id, air) => { fit(legs); return g.actionScale(u, id, air); };
    res.action = { stdT: scale('standard', 'tackle'), hovT: scale('skimmer', 'tackle'), dozT: scale('dozer', 'tackle'), dozK: scale('dozer', 'kick'), hopT: scale('hopper', 'tackle'), hopK: scale('hopper', 'kick'), hopAir: scale('hopper', 'kick', true), stdAir: scale('standard', 'kick', true) };
    fit('hopper'); res.airKick = [g.actionDistance(u, 'kick', true), g.ACTIONS.kick.airDistance];
    // 形：骨、4部位のメッシュ、被弾（四脚の外へ張った足に当たる。二脚ならそこは空）
    const shape = legs => {
      const cfg = { ...g.MECH_DEFAULT, legs }, m = g.buildMech(0x4488ff, cfg), fake = { ...m, group: m.g, mech: cfg, pos: new T.Vector3(), vel: new T.Vector3(), alive: true, onGround: true, yaw: 0, pitch: 0, recoil: 0, cannonDeploy: 0, slots: u.slots, weapon: 'main', swing: null, meleePose: { sink: 0, lean: 0, twist: 0, stance: 0 } };
      m.g.position.set(300, 50, 300); g.scene.add(m.g); g.mechPose(fake, 0); m.g.updateMatrixWorld(true);
      const shoot = (x, y, z) => { const rc = new T.Raycaster(new T.Vector3(300 + x, 50 + y, 300 - 30), new T.Vector3(0, 0, 1), 0, 60), h = rc.intersectObjects(m.g.children, true).filter(q => q.object.userData.armorSlot)[0]; return h ? h.object.userData.armorSlot : null; };
      const o = { kind: m.rig.legKind, legBones: Object.keys(m.rig.bones).filter(b => /^(thigh|shin|foot)/.test(b)).length, meshes: m.rig.meshes.length, wideFoot: shoot(1.04, .25, 0) || shoot(1.04, .25, 0), head: shoot(0, 3.6, 0), body: shoot(0, 2.8, 0), thigh: shoot(legs.startsWith('dozer') ? .85 : .6, 1.3, 0) };
      g.scene.remove(m.g); g.disposeMech(m.g); return o;
    };
    res.shape = { standard: shape('standard'), dozer: shape('dozer'), hopper: shape('hopper') };
    // Bot の機体：新しい脚も選ばれる
    const picks = {}; for (let i = 0; i < 600; i++) { const k = g.PARTS.legs[g.botMech(g.CLASS_KEYS[i % g.CLASS_KEYS.length]).legs].kind || 'biped'; picks[k] = (picks[k] || 0) + 1; }
    res.picks = picks;
    res.notes = [g.partStats('legs', g.PARTS.legs.dozer).join(' / '), g.partStats('legs', g.PARTS.legs.hopper).join(' / ')];
    fit('standard');
    return res;
  });
  const near = (a, b, e = .05) => Math.abs(a / b - 1) <= e, J = r.jump, base = J.standard.top;
  ok(base > 6.3 && base < 7.1, `二脚のジャンプは約6.8m（${base.toFixed(2)}m）`);
  ok(near(J.dozer.top, base * .64) && near(J.dozer4.top, base * .5625), `四脚のジャンプは低い（${J.dozer.top.toFixed(2)}m、Ⅳ型 ${J.dozer4.top.toFixed(2)}m）`);
  ok(near(J.hopper.top, base * 1.3225) && near(J.hopper2.top, base * 1.4884), `逆脚のジャンプは高い（${J.hopper.top.toFixed(2)}m、Ⅱ型 ${J.hopper2.top.toFixed(2)}m）`);
  ok(near(J.charged.top, base * 1.7689) && near(J.charged.cost, J.hopper.cost * 2, .01), `溜めジャンプは約12m でブースト2倍（${J.charged.top.toFixed(2)}m、消費 ${J.charged.cost.toFixed(1)}）`);
  ok(near(J.early.top, J.hopper.top, .01) && near(J.early.cost, J.hopper.cost, .01), '0.3秒未満のしゃがみでは溜めにならない');
  ok(near(J.stdCrouch.top, base, .01) && near(J.stdCrouch.cost, J.standard.cost, .01), '二脚はしゃがんでも溜めにならない');
  const L = r.land;
  ok(L.std30.stun === 'land' && L.doz30.stun === 'land' && L.hop30.stun === '', '落下 30m/s：二脚と四脚は着地硬直、逆脚は出ない');
  ok(L.hop36.stun === 'land' && near(L.hop36.t, (.5 + 2 * .05) * .5, .01) && near(L.std36.t, .5 + 8 * .05, .01), `落下 36m/s：逆脚も硬直するが短い（${L.hop36.t.toFixed(2)}秒、二脚 ${L.std36.t.toFixed(2)}秒）`);
  const Q = r.jolt;
  ok(Q.std3600.stun === 'stagger' && Q.std3600.push > 5, '二脚は 3600 でよろけて押される');
  ok(Q.doz3600.stun === '' && Q.doz4600.stun === 'stagger', '四脚のよろけは 4550 から');
  ok(Q.hop3200.stun === 'stagger' && Q.hop3100.stun === '', '逆脚のよろけは 3150 から');
  ok(Q.brace6000.stun === '' && Q.brace7000.stun === 'stagger' && Q.brace7000.push === 0, '踏ん張り中は 6825 からよろけ、押されない');
  ok(Q.braceDown.stun === 'down', '踏ん張り中も 13650 以上でダウンする');
  ok(Q.braceMelee.stun === 'stagger' && Q.braceMelee.push > 5, '踏ん張りは格闘には効かない（3900 からよろけて押される）');
  ok(Q.force.stun === 'stagger', 'タックルと蹴りは四脚もよろける');
  ok(Q.stdCrouch.stun === 'stagger' && Q.stdCrouch.push > 5, '二脚のしゃがみは今までどおり押される');
  const A = r.aim;
  ok(A.standard === 1 && A.stdCrouch === 1 && A.hopper === 1, '二脚と逆脚のばらつきは今までどおり');
  ok(A.dozer === .8 && A.brace === .48 && A.dozer4 === .74, `四脚のばらつき ×0.8、踏ん張り中 ×0.48、Ⅳ型 ×0.74`);
  ok(near(r.recoil.dozer, r.recoil.standard * .7, .01) && near(r.recoil.hopper, r.recoil.standard, .01), '四脚の反動は ×0.7');
  const C = r.crawl;
  ok(C.dozer.moved === 0 && C.dozer.braced && C.standard.moved > 1 && !C.standard.braced && C.hopper.moved > 1, `踏ん張り中は動けない（二脚のしゃがみは ${C.standard.moved}m 進む）`);
  ok(r.hover.standard.n > 20 && r.hover.dozer.n > 20 && near(r.hover.dozer.used / r.hover.dozer.n, r.hover.standard.used / r.hover.standard.n * .6, .02), '四脚の滞空の消費は ×0.6');
  ok(r.plant.standard !== null && near(r.plant.standard, r.plant.time, .01) && near(r.plant.dozer, r.plant.time * .6, .01), '四脚は構える武器の構えが ×0.6');
  const S = r.action;
  ok(S.stdT.distance === 1 && S.stdT.damage === 1 && S.hovT.distance === 1.3 && S.hovT.damage === .8, '二脚とホバーのアクションの倍率は今までどおり');
  ok(S.dozT.distance === .6 && S.dozT.damage === 1.5 && S.dozK.damage === 1.2, '四脚：タックル 距離×0.6・威力×1.5、蹴り 威力×1.2');
  ok(S.hopT.damage === .8 && S.hopK.damage === 1.5 && S.hopK.distance === 1 && S.hopAir.distance === 2 && S.stdAir.distance === 1 && near(r.airKick[0], r.airKick[1] * 2, .001), '逆脚：タックル 威力×0.8、蹴り 威力×1.5、空中の蹴りの距離×2');
  const H = r.shape;
  ok(H.standard.kind === 'biped' && H.standard.legBones === 6 && H.dozer.kind === 'quad' && H.dozer.legBones === 12 && H.hopper.kind === 'reverse' && H.hopper.legBones === 6, '骨：二脚6、四脚12、逆脚6');
  ok([H.standard, H.dozer, H.hopper].every(h => h.meshes === 4 && h.head === 'head' && h.body === 'body' && h.thigh === 'legs'), '装甲は4部位のメッシュで、頭・胴・脚に当たる');
  ok(H.dozer.wideFoot === 'legs' && H.standard.wideFoot === null && H.hopper.wideFoot === null, '四脚の脚の当たりは横に広い');
  ok(r.picks.quad > 0 && r.picks.reverse > 0 && r.picks.biped > 0 && r.picks.hover > 0, `Bot は新しい脚も選ぶ（${JSON.stringify(r.picks)}）`);
  ok(/踏ん張り/.test(r.notes[0]) && /溜め/.test(r.notes[1]), '機体カスタマイズに脚の種類の説明が出る');
  // Bot の踏ん張り：四脚でしゃがみを選んだ Bot は、見えている敵と撃ち合う間に踏ん張り、敵がいなくなると解く
  await ev(() => {
    const g = __g, T = g.T, me = g.units.find(u => !u.isPlayer && u.team === g.player.team), foe = g.units.find(u => u.team !== g.player.team);
    for (const u of g.units) if (u !== me && u !== foe) { u.alive = false; u.group.visible = false; u.respawnT = 1e9; }
    me.mech = { ...g.MECH_DEFAULT, legs: 'dozer' }; me.actionId = 'crouch'; g.equip(me, 'heavy'); me.actionId = 'crouch';
    const x = me.pos.x, z = me.pos.z; foe.pos.set(x, g.groundAt(x, z + (me.team === 'B' ? 1 : -1) * 0, 50), z); foe.vel.set(0, 0, 0);
    window.__pair = { me, foe };
  });
  const seen = await ev(() => {
    const g = __g, { me, foe } = __pair; let best = null;
    // 見通しのよい向きを探して敵を 35m 先に置く
    for (let a = 0; a < 16 && !best; a++) { const dx = Math.sin(a * Math.PI / 8) * 35, dz = Math.cos(a * Math.PI / 8) * 35; if (g.clearPath(me.pos.x, me.pos.z, me.pos.x + dx, me.pos.z + dz, me.pos.y, me) && Math.abs(g.groundAt(me.pos.x + dx, me.pos.z + dz, me.pos.y + 2) - me.pos.y) < 1) best = [dx, dz]; }
    if (!best) return null;
    foe.pos.set(me.pos.x + best[0], g.groundAt(me.pos.x + best[0], me.pos.z + best[1], me.pos.y + 2), me.pos.z + best[1]);
    Object.assign(foe, { hp: 1e9, maxHp: 1e9 }); me.hp = me.maxHp = 1e9; foe.frozenForTest = true;
    let braced = 0, n = 0;
    for (let i = 0; i < 240; i++) { g.loop(window.__t = (window.__t || 0) + 50); foe.vel.set(0, 0, 0); if (me.alive && me.target === foe) { n++; if (g.legBraced(me)) braced++; } }
    foe.alive = false; foe.respawnT = 1e9; let after = 0;
    for (let i = 0; i < 60; i++) { g.loop(window.__t += 50); if (i > 30 && g.legBraced(me)) after++; }
    return { braced, n, after, kind: g.legTraits(me).crouch.type };
  });
  ok(seen && seen.n > 20 && seen.braced > 10 && seen.after === 0, `四脚の Bot は撃ち合いで踏ん張り、敵がいなくなると解く（${JSON.stringify(seen)}）`);
}, { errorsOk: /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/ });
