// ワイヤーアンカー（強襲の特別装備。2026-11-11、オーナーの発案。操作はオーナーの選んだ案A）。
//  - 特別装備を選ぶ（4キー・中ボタン・十字キーの下など）と、持っている武器はそのままで照準の先へ撃つ。刺さったら SP を use % 使い、巻き取って近づく。
//  - 届かない所（空）へ撃っても何も起きず、SP も使わない。SP が足りなければ撃てない。
//  - ロック中の敵へ撃つとその敵に刺さり、ソードの間合い（SABRE_STOP）で止まる。通り過ぎない。
//  - もう一度選ぶ・ジャンプで外れ、勢いは残る。巻き取っている間は SP が戻らない。
//  - 中ボタンでも撃て、押し直すと外れる。建物の壁の上の方に刺せば、縁を越えて上に乗れる（市街地）。
//  - Bot はソードを持っていて踏み込みの届かない敵へ撃つ。オンラインの先読みは止める（'special'）。
// node tools/test/wire_check.js [dbg]
const { check } = require('./lib');
check('ワイヤーアンカー', async ({ ev, step, ok, sortie }) => {
  await sortie('wide');
  // 前60mに建物の無い平らな所を探す（ワイヤーの試験はそこで撃つ）
  const spot = await ev(() => {
    const g = __g, T = g.T || THREE;
    const cand = [];
    for (let x = -200; x <= 200; x += 20) for (let z = -200; z <= 200; z += 20) cand.push([x, z]);
    cand.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [x, z] of cand) {
      const y = g.terrainH(x, z), flat = [10, 20, 30, 45, 60].every(d => Math.abs(g.terrainH(x, z - d) - y) < 1.5);
      if (!flat) continue;
      const clear = [-4, 0, 4].every(dx => [1, 3, 6, 10].every(h => !g.castFrom(new T.Vector3(x + dx, y + h, z + 12), new T.Vector3(0, 0, -1), g.player, 85)));
      if (clear) return [x, z];
    }
    return null;
  });
  // 自機を強襲・ワイヤーにして、平らな広い所の上に置く
  const setup = () => ev((S) => {
    const g = __g, u = g.player;
    if (u.slots.sp.w.key !== 'wire') u.slots.sp = g.slotOf('wire');
    for (const e of g.units) if (e !== u) { e.pos.set(5000, -500, 5000); e.alive = false; e.respawnT = 1e9; }
    Object.assign(u, { alive: true, hp: u.maxHp, weapon: 'main', switchT: 0, stun: '', downT: 0, wire: null, wireReq: false, dashT: 0, longDash: false, lungeT: 0, swing: null, transfer: null, zip: null, flying: false, invulT: 0 });
    u.pos.set(S[0], g.terrainH(S[0], S[1]), S[1]); u.vel.set(0, 0, 0); u.onGround = true; u.yaw = 0; u.pitch = 0;
    Object.assign(u.slots.sp, { heat: 100, overheat: false, cd: 0 });
    Object.assign(g.lock, { target: null, visible: false });
    g.timeLeft = 1e6;
    return { sp: u.slots.sp.w.name, cls: u.cls };
  }, spot);
  // 照準は前のコマのカメラで決まるので、向きを変えたら1コマ進めてから撃つ
  const aimAt = async (pitch, yaw = 0) => { await ev(([p, y, spot]) => { const u = __g.player; u.pitch = p; u.yaw = y; u.vel.set(0, 0, 0); }, [pitch, yaw, spot]); await step(1); await ev(([p, y, spot]) => { const u = __g.player; u.pitch = p; u.yaw = y; u.pos.set(spot[0], __g.terrainH(spot[0], spot[1]), spot[1]); u.vel.set(0, 0, 0); }, [pitch, yaw, spot]); };
  if (!spot) throw new Error('前の開けた所が見つからない');
  let r = await setup();
  ok(r.sp === 'ワイヤーアンカー', '強襲の特別装備にワイヤーアンカーがある：' + r.sp);
  r = await ev(() => ({ inArmory: __g.ARMORY.assault.sp.includes('wire'), toggle: __g.TOGGLE_SP.includes('wire'), name: __g.SERIES.wa.types[0][1] }));
  ok(r.inArmory && r.toggle, '強襲の特別装備の一覧にあり、持ち替えずに使う装備（TOGGLE_SP）になっている（型番 ' + r.name + '）');

  // 1. 前の地面へ撃つ：武器はそのまま、SP を使って近づき、着いたら外れる
  await aimAt(-0.2);
  r = await ev(() => {
    const g = __g, u = g.player;
    const p0 = u.pos.clone(), sp0 = u.slots.sp.heat;
    g.selectWeapon(u, 'sp');
    return { p0: p0.toArray(), sp0, req: u.wireReq };
  });
  await step(1);
  const fired = await ev(() => { const u = __g.player; return { wire: !!u.wire, p: u.wire && u.wire.p.toArray(), sp: u.slots.sp.heat, weapon: u.weapon, pred: __g.movementPredictionBlockReason(u) }; });
  ok(r.req && fired.wire, '特別装備を選ぶと照準の先の地面にワイヤーが刺さる');
  ok(fired.weapon === 'main', '持っている武器はそのまま（主武器）');
  ok(Math.abs(r.sp0 - fired.sp - 25) < 0.6, `刺さった時に SP を 25% 使う（${r.sp0.toFixed(1)} → ${fired.sp.toFixed(1)}）`);
  ok(fired.pred === 'special', 'オンラインの先読みは止める（理由 special）');
  let maxV = 0, released = false, spWhile = fired.sp, t;
  for (t = 0; t < 60; t++) {
    await step(1);
    const s = await ev(() => { const u = __g.player; return { v: u.vel.length(), wire: !!u.wire, sp: u.slots.sp.heat, z: u.pos.z }; });
    maxV = Math.max(maxV, s.v);
    if (s.wire) spWhile = s.sp;
    if (!s.wire) { released = true; break; }
  }
  r = await ev((a) => { const u = __g.player; return { d: Math.hypot(u.pos.x - a[0], u.pos.z - a[2]) }; }, fired.p);
  ok(released && r.d < 8, `巻き取って刺さった所まで行き、着くと外れる（${(t * 0.05).toFixed(2)}秒、残り ${r.d.toFixed(1)}m、最高 毎秒${maxV.toFixed(1)}m）`);
  ok(maxV > 25 && maxV < 45, `巻き取りはだんだん速くなり、毎秒42mを超えない（最高 ${maxV.toFixed(1)}）`);
  ok(Math.abs(spWhile - fired.sp) < 0.01, '巻き取っている間は SP が戻らない');

  // 2. 空へ撃つ：届かないので何も起きず、SP も使わない
  await setup(); await aimAt(0.7);
  r = await ev(() => { const g = __g, u = g.player; g.selectWeapon(u, 'sp'); return u.slots.sp.heat; });
  await step(1);
  r = await ev((sp0) => { const u = __g.player; return { wire: !!u.wire, miss: !!u.wireMiss, same: u.slots.sp.heat >= sp0 - 1e-6 }; }, r);
  ok(!r.wire && r.miss && r.same, '空（60mより先）へ撃つと届かず、刺さらない。SP も使わない（線だけ一瞬伸びる）');

  // 3. SP が足りなければ撃てない
  await setup(); await aimAt(-0.2);
  r = await ev(() => { const g = __g, u = g.player; u.slots.sp.heat = 20; g.selectWeapon(u, 'sp'); return u.wireReq; });
  await step(1);
  r = await ev(() => !!__g.player.wire);
  ok(!r, 'SP が 25% 未満なら撃てない');

  // 4. ロック中の敵へ：敵に刺さり、ソードの間合いで止まる
  await setup();
  r = await ev((S) => {
    const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team);
    Object.assign(e, { alive: true, hp: e.maxHp, respawnT: 0, downT: 0, stun: '', invulT: 0, transfer: null, zip: null, cloak: false });
    e.pos.set(S[0], g.terrainH(S[0], S[1] - 40), S[1] - 40); e.vel.set(0, 0, 0); e.onGround = true; e.act = null; e.actCd = 1e9;
    u.invulT = 100;
    Object.assign(g.lock, { target: e, visible: true });
    return { stop: g.SABRE_STOP };
  }, spot);
  await aimAt(0.06, 0.1); // 照準は敵から少し外れていても、ロックしていれば敵に刺さる（1コマ進めて敵の形の位置も合わせる）
  await ev(() => { const g = __g; g.scene.updateMatrixWorld(true); g.selectWeapon(g.player, 'sp'); }); // 描画を止めているので、当たり判定の形の位置を合わせる
  const stop = r.stop;
  await step(1);
  r = await ev(() => { const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team); return { tgt: !!u.wire && u.wire.tgt === e, lock: g.lock.target === e, wire: !!u.wire, ea: e.alive, ep: e.pos.toArray(), up: u.pos.toArray(), see: g.canSee(u, e, g.targetPoint(e)) }; });
  ok(r.tgt, 'ロック中の敵へ撃つと、照準が少しずれていてもその敵に刺さる');
  let minD = 1e9, endD = 0;
  for (t = 0; t < 60; t++) {
    await step(1);
    const s = await ev((S) => { const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team); e.pos.set(S[0], e.pos.y, S[1] - 40); e.vel.set(0, 0, 0); e.stun = ''; return { wire: !!u.wire, d: Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z), z: u.pos.z }; }, spot);
    minD = Math.min(minD, s.d);
    if (!s.wire) { endD = s.d; break; }
  }
  for (let i = 0; i < 6; i++) { await step(1); await ev((S) => { const g = __g, e = g.units.find(q => q.team !== g.player.team); e.pos.set(S[0], e.pos.y, S[1] - 40); e.vel.set(0, 0, 0); }, spot); }
  r = await ev(() => { const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team); return { d: Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z), z: u.pos.z, ez: e.pos.z }; });
  ok(endD > 0 && endD < stop + 1 && minD > stop - 0.5, `敵の前（間合い ${stop.toFixed(1)}m）で止まる：外れた時 ${endD.toFixed(1)}m、一番近づいて ${minD.toFixed(1)}m`);
  ok(r.z > r.ez, `通り過ぎない（少し後も敵の手前、${r.d.toFixed(1)}m）`);
  await ev(() => { Object.assign(__g.lock, { target: null, visible: false }); });

  // 5. もう一度選ぶと外れ、勢いは残る
  await setup(); await aimAt(-0.2);
  await ev(() => { const g = __g, u = g.player; g.selectWeapon(u, 'sp'); });
  await step(8);
  r = await ev(() => { const g = __g, u = g.player, v = Math.hypot(u.vel.x, u.vel.z), was = !!u.wire; g.selectWeapon(u, 'sp'); return { was, v, now: !!u.wire }; });
  await step(1);
  const after = await ev(() => { const u = __g.player; return { v: Math.hypot(u.vel.x, u.vel.z), wire: !!u.wire }; });
  ok(r.was && !r.now && !after.wire, '巻き取り中にもう一度選ぶと外れる');
  ok(after.v > r.v * 0.6 && after.v > 15, `外した時の勢いは残る（毎秒${r.v.toFixed(1)}m → ${after.v.toFixed(1)}m）`);

  // 6. ジャンプで外れる
  await setup(); await aimAt(-0.2);
  await ev(() => { const g = __g, u = g.player; g.selectWeapon(u, 'sp'); });
  await step(6);
  r = await ev(() => { const g = __g; g.pressed.Space = true; g.keys.Space = true; return !!g.player.wire; });
  await step(1);
  const jumped = await ev(() => { const g = __g; g.keys.Space = false; return !!g.player.wire; });
  ok(r && !jumped, 'ジャンプでも外れる');

  // 中ボタン（ホイールの押し込み）でも撃てる
  await setup(); await aimAt(-0.2);
  await ev(() => dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })));
  await step(1);
  r = await ev(() => ({ wire: !!__g.player.wire, weapon: __g.player.weapon }));
  ok(r.wire && r.weapon === 'main', '中ボタンでも撃てる（持っている武器はそのまま）');
  await step(5); // 押し直しは WIRE_CD（0.25秒）の後
  r = await ev(() => { dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })); return !!__g.player.wire; });
  ok(!r, '刺さっている間に中ボタンを押すと外れる');

  // 7. Bot：ソードを持っていて踏み込みの届かない敵機へ撃つ
  r = await ev((S) => {
    const g = __g, u = g.player, b = g.units.find(q => q !== u && q.team === u.team) || g.units.find(q => q !== u);
    const e = g.units.find(q => q.team !== b.team && q !== b);
    Object.assign(b, { alive: true, cls: 'assault', wire: null, act: null });
    b.slots.sp = g.slotOf('wire'); b.slots.aux = g.slotOf('sword'); b.slots.sp.heat = 100; b.slots.sp.overheat = false;
    b.pos.set(S[0], g.terrainH(S[0], S[1]), S[1]); b.yaw = 0;
    Object.assign(e, { alive: true, downT: 0, cloak: false, tilt: 0, stun: '' });
    e.pos.set(S[0], g.terrainH(S[0], S[1] - 45), S[1] - 45); e.group.rotation.set(0, 0, 0); e.group.visible = true;
    u.pos.set(S[0] + 40, g.terrainH(S[0] + 40, S[1]), S[1]); u.group.position.copy(u.pos); // 自機は射線の外へ
    b.target = e; e.group.position.copy(e.pos); b.group.position.copy(b.pos); g.scene.updateMatrixWorld(true);
    const see = g.canSee(b, e, g.targetPoint(e));
    const R = Math.random; Math.random = () => 0;
    let act; try { act = g.botAct(b, true, g.cores[e.team === 'B' ? 'B' : 'R']); } finally { Math.random = R; }
    b.pos.set(5000, -500, 5000); b.alive = false; b.respawnT = 1e9; e.pos.set(5000, -500, 5000); e.alive = false; e.respawnT = 1e9;
    return { slot: act && act.slot, d: 45, see, sub: b.slots.sub.w.key, S };
  }, spot);
  ok(r.slot === 'sp', `Bot はソードを持っていて ${r.d}m 先の敵機へワイヤーを撃つ`);

  // 8. 移動：建物の壁の上の方へ撃つと、巻き取って縁を越え、上に乗れる（市街地）
  await sortie('city');
  const wall = await ev(() => {
    const g = __g, T = g.T || THREE;
    for (const e of g.units) if (e !== g.player) { e.pos.set(5000, -500, 5000); e.alive = false; e.respawnT = 1e9; }
    g.scene.updateMatrixWorld(true);
    // 平らな所から水平に見て、25〜45m先に高さ8〜25mの壁があり、その上が平らな所を探す
    const inside = (x, z) => Math.abs(x) < g.MAP_X - 8 && Math.abs(z) < g.MAP_Z - 8;
    for (let x = -300; x <= 300; x += 15) for (let z = -300; z <= 300; z += 15) for (let a = 0; a < 4; a++) {
      if (!inside(x, z)) continue;
      const y = g.terrainH(x, z), yaw = a * Math.PI / 2, d = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      if (!inside(x + d.x * 50, z + d.z * 50)) continue;
      const low = g.castFrom(new T.Vector3(x, y + 3, z), d, g.player, 50);
      if (!low || low.ref || low.dist < 25 || low.dist > 45) continue;
      let top = 0;
      for (let h = 4; h <= 30; h += 0.5) { const c = g.castFrom(new T.Vector3(x, y + h, z), d, g.player, 60); if (c && !c.ref && Math.abs(c.dist - low.dist) < 1.5) top = h; else break; }
      if (top < 8 || top > 25) continue;
      const from = new T.Vector3(x, y + 3.1, z), P = new T.Vector3(x, y + top - 1.5, z).addScaledVector(d, low.dist), L = P.distanceTo(from);
      const line = g.castFrom(from, P.clone().sub(from).normalize(), g.player, L + 3);
      if (!line || line.ref || Math.abs(line.dist - L) > 1) continue; // 肩から狙う所まで途中に何も無い
      const roof = new T.Vector3(x, 0, z).addScaledVector(d, low.dist + 3);
      const ry = g.groundAt ? g.groundAt(roof.x, roof.z, y + top + 5) : y + top;
      if (Math.abs(ry - (y + top)) > 1.5) continue;
      return { x, z, yaw, y, dist: low.dist, top, roofY: ry };
    }
    return null;
  });
  ok(!!wall, '市街地で、平らな所から25〜45m先に高さ8〜25mの建物の壁を見つけた' + (wall ? `（${wall.dist.toFixed(0)}m先、高さ${wall.top.toFixed(1)}m）` : ''));
  if (wall) {
    await ev((W) => {
      const g = __g, u = g.player;
      if (u.slots.sp.w.key !== 'wire') u.slots.sp = g.slotOf('wire');
      Object.assign(u, { alive: true, hp: u.maxHp, weapon: 'main', switchT: 0, stun: '', wire: null, invulT: 100, dashT: 0, longDash: false });
      Object.assign(u.slots.sp, { heat: 100, overheat: false, cd: 0 });
      Object.assign(g.lock, { target: null, visible: false });
      u.pos.set(W.x, W.y, W.z); u.vel.set(0, 0, 0); u.onGround = true; g.timeLeft = 1e6;
    }, wall);
    // 壁の上から1.5m下を狙って撃つ（照準とカメラの合わせは上の平らな所の試験で確かめたので、ここは照準の点を直に渡す）
    await step(1);
    await ev((W) => {
      const g = __g, T = g.T || THREE, u = g.player, d = new T.Vector3(-Math.sin(W.yaw), 0, -Math.cos(W.yaw));
      u.yaw = W.yaw; u.pos.set(W.x, W.y, W.z); u.vel.set(0, 0, 0); g.scene.updateMatrixWorld(true);
      u.wireReq = true; g.wireTick(u, u.slots.sp, new T.Vector3(W.x, W.y + W.top - 1.5, W.z).addScaledVector(d, W.dist));
    }, wall);
    const hook = await ev(() => { const u = __g.player; return u.wire ? u.wire.p.toArray() : null; });
    ok(!!hook && hook[1] > wall.y + wall.top - 3, '壁の上の方に刺さる' + (hook ? `（高さ ${(hook[1] - wall.y).toFixed(1)}m）` : ''));
    let best = -1e9;
    for (let i = 0; i < 80; i++) { await step(1); const q = await ev(() => { const u = __g.player; return [u.pos.x, u.pos.y, u.pos.z, u.vel.x, u.vel.y, !!u.wire, u.onGround].map(v => typeof v === 'number' ? +v.toFixed(2) : v); }); best = Math.max(best, q[1]); }
    const end = await ev(() => { const u = __g.player; return { y: u.pos.y, ground: u.onGround }; });
    ok(end.y > wall.y + wall.top - 1 && end.ground, `巻き取って縁を越え、建物の上に乗る（足の高さ ${(end.y - wall.y).toFixed(1)}m、壁 ${wall.top.toFixed(1)}m）`);
  }
}, { errorsOk: /PeerJS|peerjs|ERR_TUNNEL/ });
