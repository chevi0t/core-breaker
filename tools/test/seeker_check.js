// レーザー誘導ロケット（2026-11-06、オーナー「ボダブレWiki見てシーカー系統を実装してください。最初遅くてどんどん加速していく感じとか含めていい感じに」）。
// 重火力の副武器。右クリックの精密誘導モード（主観視点・紫のレティクル）で撃った弾だけが照準の中心へ曲がる。モードを切ると直進。
// 撃った機体から離れるほど曲がらず、150mでほぼ0。弾は遅く出て加速する。モード中は施設（カタパルト・ジャンプ台・ジップライン）を使えない。
// node tools/test/seeker_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('レーザー誘導ロケット', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('wide', { render: true });
  const types = await ev(() => { const g = __g, W = g.WEAPONS, P = k => W[k].proj;
    return { list: g.ARMORY.heavy.sub.filter(k => k.startsWith('seeker')), model: g.MODEL_OF.seeker[0],
      rows: ['seeker', 'seekerK', 'seekerH', 'seekerR'].map(k => [W[k].name, P(k).dmg, W[k].mag, W[k].mags, P(k).blast, P(k).speed, P(k).maxSpeed, W[k].reload, W[k].kg, W[k].rpm, W[k].burst || 0]) }; });
  ok(JSON.stringify(types.list) === '["seeker","seekerK","seekerH","seekerR"]' && types.model === 'seeker', '重火力の副武器に4つの型が並び、専用の形');
  ok(JSON.stringify(types.rows) === JSON.stringify([
    ['レーザー誘導ロケット', 8000, 1, 6, 14, 40, 150, 2.2, 470, 60, 0],
    ['レーザー誘導ロケット・三点射型', 5200, 3, 6, 11, 30, 140, 3.5, 510, 360, 3],
    ['レーザー誘導ロケット・強装型', 11500, 1, 4, 18, 20, 120, 4, 520, 60, 0],
    ['レーザー誘導ロケット・連射型', 4800, 5, 4, 13, 60, 160, 4, 490, 210, 0]]), '型の数値（アーケード版の表の威力・弾数・爆風・初速・リロード・重量・連射）' + JSON.stringify(types.rows));
  // 準備：プレイヤーを重火力にしてロケットを持たせ、ほかは遠くへ
  await ev(() => { const g = __g, p = g.player; p.slots.sub = g.slotOf('seeker'); g.selectWeapon(p, 'sub'); p.switchT = 0; p.invulT = 0;
    for (const q of g.units) if (q !== p) { q.alive = false; q.group.visible = false; q.pos.set(9999, 0, 9999); }
    p.pos.y += 40; p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0; window.__f = g.fwdOf(p).setY(0).normalize(); window.__r = window.__f.clone().cross(new window.__f.constructor(0, 1, 0)); });
  // 撃って1発だけ残し、時間を進める。side：撃った後に照準を横へ動かす量（m、前方40m先から）
  const fly = (mode, side, secs, offAt = 99) => ev(([mode, side, secs, offAt]) => {
    const g = __g, p = g.player, sl = p.slots.sub, f = window.__f, r = window.__r;
    for (const s of g.shells.splice(0)) g.scene.remove(s.mesh);
    sl.cd = 0; sl.ammo = sl.w.mag; sl.reloadT = 0; p.switchT = 0; p.recoil = p.recoilYaw = 0; p.cameraRecoil = p.cameraRecoilYaw = 0;
    g.setSeekMode(p, mode);
    const ahead = p.pos.clone().addScaledVector(f, 200);
    g.weaponsTick(p, 1 / 60, true, ahead, 0); g.weaponsTick(p, 1 / 60, false, ahead, 0);
    const sh = g.shells.find(s => s.owner === p && s.spec.seek); if (!sh) return null;
    const v0 = sh.vel.length(), d0 = sh.vel.clone().normalize(), seeking = !!sh.seeking, from = sh.pos.clone();
    const aim = sh.pos.clone().addScaledVector(f, 120).addScaledVector(r, side);
    const speeds = [];
    for (let t = 0; t < secs; t += 1 / 60) {
      if (t >= offAt && p.seekMode) g.setSeekMode(p, false);
      if (p.seekMode) p.seekAim.copy(aim);
      g.shellUpdate(1 / 60); if (!g.shells.includes(sh)) break;
      if (Math.abs(t - .5) < 1 / 120 || Math.abs(t - 1) < 1 / 120 || Math.abs(t - 2) < 1 / 120) speeds.push(+sh.vel.length().toFixed(1));
    }
    const d1 = sh.vel.clone().normalize();
    return { v0, seeking, still: !!sh.seeking, turned: +(d0.angleTo(d1) * 180 / Math.PI).toFixed(1), right: d1.dot(r), speeds, went: +sh.pos.distanceTo(from).toFixed(1) };
  }, [mode, side, secs, offAt]);
  // 右クリック（aimPress(2)）で精密誘導モード
  const toggle = await ev(() => { const g = __g, p = g.player; g.aimPress(2); const a = p.seekMode; g.aimPress(2); const b = p.seekMode; dispatchEvent(new MouseEvent('mouseup', { button: 2 })); return { a, b, lock: g.lockAllowed(p) }; });
  ok(toggle.a && !toggle.b && !toggle.lock, '右クリックで精密誘導モードに入り、もう一度で出る（副武器なのでロックオンは無い）');
  const plain = await fly(false, 30, .8);
  ok(plain && !plain.seeking && plain.turned < .5, `モードの外で撃った弾は照準を動かしても曲がらない（${plain && plain.turned}度）`);
  ok(plain && Math.abs(plain.v0 - 40) < 1 && plain.speeds[0] > 70 && plain.speeds[0] < 85, `初速40m/sから加速する（0.5秒で${plain && plain.speeds[0]}m/s）`);
  const guided = await fly(true, 120, .8);
  ok(guided && guided.seeking && guided.turned > 35 && guided.right > .5, `モードで撃った弾は照準の中心へ曲がる（0.8秒で${guided && guided.turned}度）`);
  const fast = await fly(false, 0, 2.2);
  ok(fast && fast.speeds.length >= 3 && fast.speeds[1] > fast.speeds[0] && fast.speeds[2] === 150, `だんだん速くなり最高150m/s（${fast && fast.speeds.join('→')}）`);
  // 90度近く曲げられるが、加速するのでそれ以上は回りきれない
  const hard = await fly(true, 2000, 2.5);
  ok(hard && hard.turned > 70 && hard.turned < 135, `真横へ照準を振ると大きく曲がる（${hard && hard.turned}度）`);
  // モードを切ると、その向きのまま直進
  const cut = await ev(() => { const g = __g, p = g.player, sl = p.slots.sub, f = window.__f, r = window.__r;
    for (const s of g.shells.splice(0)) g.scene.remove(s.mesh);
    sl.cd = 0; sl.ammo = sl.w.mag; sl.reloadT = 0; g.setSeekMode(p, true);
    const ahead = p.pos.clone().addScaledVector(f, 200); g.weaponsTick(p, 1 / 60, true, ahead, 0); g.weaponsTick(p, 1 / 60, false, ahead, 0);
    const sh = g.shells.find(s => s.owner === p && s.spec.seek), aim = sh.pos.clone().addScaledVector(f, 40).addScaledVector(r, 40);
    for (let i = 0; i < 20; i++) { p.seekAim.copy(aim); g.shellUpdate(1 / 60); }
    g.setSeekMode(p, false); g.shellUpdate(1 / 60); const d = sh.vel.clone().normalize();
    for (let i = 0; i < 20; i++) g.shellUpdate(1 / 60);
    const later = g.setSeekMode(p, true); for (let i = 0; i < 20; i++) { p.seekAim.copy(sh.pos.clone().addScaledVector(r, -50)); g.shellUpdate(1 / 60); }
    g.setSeekMode(p, false);
    return { seeking: !!sh.seeking, angle: +(d.angleTo(sh.vel.clone().normalize()) * 180 / Math.PI).toFixed(2) }; });
  ok(!cut.seeking && cut.angle < .1, `モードを切ると直前の向きのまま直進し、入り直しても誘導は戻らない（${cut.angle}度）`);
  // 撃った機体から離れるほど曲がらない
  const far = await ev(() => { const g = __g, p = g.player, sl = p.slots.sub, f = window.__f, r = window.__r;
    for (const s of g.shells.splice(0)) g.scene.remove(s.mesh);
    sl.cd = 0; sl.ammo = sl.w.mag; sl.reloadT = 0; g.setSeekMode(p, true);
    const ahead = p.pos.clone().addScaledVector(f, 200); g.weaponsTick(p, 1 / 60, true, ahead, 0); g.weaponsTick(p, 1 / 60, false, ahead, 0);
    const sh = g.shells.find(s => s.owner === p && s.spec.seek), turn = d => { sh.pos.copy(p.pos).addScaledVector(f, d); sh.vel.copy(f).multiplyScalar(150); const d0 = sh.vel.clone();
      for (let i = 0; i < 6; i++) { p.seekAim.copy(sh.pos).addScaledVector(r, 40).addScaledVector(f, 5); g.shellUpdate(1 / 60); } return d0.angleTo(sh.vel); };
    const near = turn(30), mid = turn(100), out = turn(152); g.setSeekMode(p, false); return { near, mid, out }; });
  ok(far.near > far.mid * 1.8 && far.mid > 0 && far.out < 1e-6, `撃った機体から離れるほど曲がらず、150mの先では曲がらない（30m ${far.near.toFixed(3)}・100m ${far.mid.toFixed(3)}・152m ${far.out.toFixed(4)} rad）`);
  // 持ち替え・施設
  const sw = await ev(() => { const g = __g, p = g.player; p.switchT = 0; g.setSeekMode(p, true); const zip = g.zipCan(p); g.selectWeapon(p, 'main'); const off = !p.seekMode; p.switchT = 0;
    g.setSeekMode(p, true); const main = p.seekMode; g.selectWeapon(p, 'sub'); p.switchT = 0; return { zip, off, main }; });
  ok(!sw.zip && sw.off && !sw.main, '精密誘導モードの間はジップラインを掴めず、持ち替えるとモードを出る（主武器では入れない）');
  // 主観視点と紫のレティクル
  await ev(() => { const g = __g, p = g.player; p.pos.y -= 40; p.pos.y = g.groundAt(p.pos.x, p.pos.z, p.pos.y + 50); p.vel.set(0, 0, 0); g.setSeekMode(p, true); });
  await step(10);
  const view = await ev(() => { const g = __g, p = g.player; return { mode: p.seekMode, cam: +g.camera.position.distanceTo(p.pos.clone().setY(p.pos.y + 3.4)).toFixed(2), ret: !document.getElementById('seekRet').hidden, fov: +(g.gameOptions.fov / g.camera.fov).toFixed(2) }; });
  ok(view.mode && view.cam < 1 && view.ret && view.fov > 1.05 && view.fov < 1.15, `モード中は主観視点（目の位置から${view.cam}m）、紫のレティクル、少しだけズーム（×${view.fov}）`);
  await page.screenshot({ path: out + '/seeker_mode.png' });
  await ev(() => __g.setSeekMode(__g.player, false));
  await step(10);
  ok(await ev(() => document.getElementById('seekRet').hidden && __g.camera.position.distanceTo(__g.player.pos) > 5), 'モードを出ると後ろからの視点とふだんの照準に戻る');
  // Bot も同じ決まりで使う（モードに入ってから撃ち、誘導中は持ち替えない）
  const bot = await ev(() => { const g = __g, p = g.player, e = g.units.find(q => q !== p && q.team !== p.team && q.cls === 'heavy') || g.units.find(q => q !== p && q.team !== p.team);
    window.__b = e; e.cls = 'heavy'; e.slots.sub = g.slotOf('seeker'); e.alive = true; e.group.visible = true; e.hp = e.maxHp; e.invulT = 0;
    e.pos.copy(p.pos).addScaledVector(window.__f, 70); e.pos.y = g.groundAt(e.pos.x, e.pos.z, e.pos.y + 30); e.vel.set(0, 0, 0); p.invulT = 99; return !!e; });
  let seen = null;
  for (let i = 0; i < 300 && !seen; i++) {
    await ev(() => { const g = __g, e = window.__b; e.rkGo = true; e.botRkT = 0; e.target = g.player; window.__bp = window.__bp || e.pos.clone(); e.pos.copy(window.__bp); e.vel.set(0, 0, 0); }); // 70mの所に留める（2026-11-07。前の爆風の結果しだいで Bot が450mも離れていき、撃たなかった）
    await step(1);
    seen = await ev(() => { const e = window.__b, s = __g.shells.find(s => s.owner === e && s.spec.seek); return s ? { seeking: !!s.seeking, mode: e.seekMode, weapon: e.weapon } : null; });
  }
  ok(bot && seen && seen.seeking && seen.mode && seen.weapon === 'sub', 'Bot も精密誘導モードに入ってから撃ち、誘導している ' + JSON.stringify(seen));
  await ev(() => { __g.player.invulT = 0; });
});
