// 爆風の距離減衰・被弾条件と、描画だけの視界揺れを本体の処理で確認する。
// node tools/test/blast_camera_shake_check.js dbg/blast-camera-shake [結果フォルダ]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/blast-camera-shake');
const out = path.resolve(process.argv[3] || path.join(dir, 'results'));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    fs.mkdirSync(out, { recursive: true });
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], samples = [];
      const yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      const close = (a, b) => Math.abs(a - b) < 1e-6;
      g.selectMap('dock'); document.getElementById('start').click(); g.running = true;
      const u = g.player, enemy = g.units.find(v => v.team !== u.team), ally = g.units.find(v => v !== u && v.team === u.team);
      const realRender = g.renderer.render.bind(g.renderer), rendered = [];
      g.renderer.render = (scene, camera) => { scene.updateMatrixWorld(true); rendered.push(camera.quaternion.clone()); };
      function reset() {
        g.spawn(u); g.equip(u, 'assault'); g.running = true; g.fxUpdate(10); g.shells.length = 0;
        for (const v of g.units) { v.alive = false; v.frozen = true; v.group.visible = false; v.cloakShown = false; v.respawnT = 100; }
        Object.assign(u, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, armorAvg: 1, weakT: 0, yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0, stun: '', repairing: false, barrierOn: false, downT: 0, scoped: false, dashState: '' });
        u.partArmor = { head: 1, body: 1, arms: 1, legs: 1 };
        u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); u.group.visible = true;
        Object.assign(enemy, { alive: true, hp: 1e6, invulT: 0, armorAvg: 1, weakT: 0 }); enemy.pos.set(80, 200, 0);
        g.weaponLook(u, 0); g.scene.updateMatrixWorld(true);
        Object.assign(g.lock, { target: null, visible: false, prevAng: null });
        g.camera.fov = 70; g.updateCamera(u, 1); rendered.length = 0;
      }
      const explode = (distance = 0, spec = {}, owner = enemy) => g.blast({ owner, team: owner.team, spec: { dmg: 5000, blast: 10, ...spec } }, g.targetPoint(u).add(new T.Vector3(distance, 0, 0)), null);
      function frame() { rendered.length = 0; const base = g.camera.quaternion.clone(); g.renderView(); return { angle: rendered[0].angleTo(base), base, view: rendered[0] }; }
      for (const distance of [0, 5, 9]) {
        reset(); const hp = u.hp; explode(distance);
        const loss = hp - u.hp, angle = frame().angle;
        yes(close(loss, 5000 * (1 - .5 * distance / 10)), distance + 'm：従来の爆風減衰を維持');
        yes(angle > 0, distance + 'm：よろけ未満の被弾も描画時に揺れる');
        samples.push({ distance, damage: loss, angle });
      }
      yes(samples[0].angle > samples[1].angle && samples[1].angle > samples[2].angle, '爆心に近いほど強く揺れる');
      reset(); u.armorAvg = .5; const hp = u.hp; explode();
      yes(close(hp - u.hp, 2500) && frame().angle < samples[0].angle, '装甲を適用した実ダメージに応じて揺れる');
      reset(); explode(10, { linear: true }); yes(g.blastShake.power === 0, '端で威力0になる爆風は無損傷なら揺れない');
      reset(); explode(11); yes(g.blastShake.power === 0 && u.hp === 1e6, '範囲外では揺れない');
      reset(); u.invulT = 2; explode(); yes(g.blastShake.power === 0 && u.hp === 1e6, '出撃直後の無敵中は揺れない');
      reset(); explode(0, {}, ally); yes(g.blastShake.power === 0 && u.hp === 1e6, '味方の無損傷の爆風では揺れない');
      reset(); explode(0, {}, u); yes(g.blastShake.power > 0 && u.hp < 1e6, '自爆の被弾でも揺れる');
      reset(); explode(0, { dmg: 0, knock: true }); yes(g.blastShake.power === 0, 'ダメージを与えない衝撃弾は既存のダウンだけ');
      reset(); explode(0, { dmg: 0, weak: { mult: 1.2, time: 5 } }); yes(g.blastShake.power === 0, '弱化だけの爆風で揺れを出さない');
      reset(); g.equip(u, 'heavy'); u.slots.sp = g.slotOf('barrier'); u.barrierOn = true;
      explode(0); yes(g.blastShake.power === 0 && u.hp === 1e6 && u.slots.sp.heat < 100, 'バリアが防いだ爆風はSPだけを消費して揺れない');
      reset(); const wall = new T.Mesh(new T.BoxGeometry(1, 12, 12), new T.MeshBasicMaterial()); wall.position.set(5, 202.4, 0);
      g.scene.add(wall); g.hittables.push(wall); wall.updateMatrixWorld(true);
      explode(9, { blast: 20, occluded: true }); yes(g.blastShake.power === 0 && u.hp === 1e6, '遮蔽で防いだ爆風では揺れない');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
      reset(); g.blast({ owner: u, team: u.team, spec: { dmg: 1000, blast: 10 } }, g.targetPoint(enemy), null);
      yes(enemy.hp < 1e6 && g.blastShake.power === 0, '遠くのBotだけが被弾してもプレイヤーの視界は揺れない');
      reset(); g.damage(u, enemy, 1000, false, false, null, enemy.pos, false);
      yes(g.blastShake.power === 0, '通常の実弾の被弾には今回の爆風揺れを加えない');
      reset(); const from = new T.Vector3(0, 202.6, -8), aim = new T.Vector3(0, 202.6, 0);
      g.fire(enemy, aim, 0, g.WEAPONS.blastSniper, from);
      yes(u.hp < 1e6 && close(g.blastShake.power, Math.min(1, (1e6 - u.hp) / 6000)), '炸裂狙撃銃の直撃でも一度だけ揺れを加える');
      for (const key of ['rocket', 'plasma', 'charge']) {
        reset(); const spec = g.WEAPONS[key].proj;
        g.shoot(enemy, from, new T.Vector3(0, 0, spec.speed), spec);
        for (let i = 0; i < 20 && u.hp === 1e6; i++) g.shellUpdate(1 / 60);
        yes(u.hp < 1e6 && g.blastShake.power > 0, key + '：実際の飛翔・着弾・爆風で揺れる');
      }
      reset(); explode(); const viewState = { yaw: u.yaw, pitch: u.pitch, recoil: u.recoil, recoilYaw: u.recoilYaw, hp: u.hp, pos: u.pos.toArray() };
      const base = g.camera.quaternion.clone(), matrix = g.camera.matrixWorld.clone(), inverse = g.camera.matrixWorldInverse.clone(), direction = g.camera.getWorldDirection(new T.Vector3());
      const angles = [];
      for (let i = 0; i < 10; i++) { angles.push(frame().angle); g.updateBlastShake(.05); }
      yes(angles[0] > 0 && angles.some((a, i) => i > 0 && a > 0 && a !== angles[0]), '時間とともに揺れの方向・幅が変わる');
      yes(angles.at(-1) === 0 && g.blastShake.power === 0, '0.45秒以内で揺れが収まり、元の視点へ戻る');
      yes(g.camera.quaternion.equals(base) && g.camera.matrixWorld.equals(matrix) && g.camera.matrixWorldInverse.equals(inverse) && g.camera.getWorldDirection(new T.Vector3()).equals(direction), '描画後はカメラの姿勢・行列・照準方向が完全に元へ戻る');
      yes(JSON.stringify(viewState) === JSON.stringify({ yaw: u.yaw, pitch: u.pitch, recoil: u.recoil, recoilYaw: u.recoilYaw, hp: u.hp, pos: u.pos.toArray() }), '描画によって機体の向き・反動・耐久・位置を変えない');
      explode(); for (let i = 0; i < 100; i++) explode();
      yes(g.blastShake.power <= 1 && frame().angle < .03, '連続爆発でも揺れ幅の上限を越えない');
      const sustained = [];
      for (let i = 0; i < 12; i++) { explode(); g.updateBlastShake(1 / 60); sustained.push(frame().view); }
      yes(sustained.some(q => q.angleTo(sustained[0]) > .001), '毎フレーム被弾しても周期を巻き戻さず揺れ続ける');
      const anchor = g.camera.position.clone().addScaledVector(direction, 100), shifts = [];
      const captureRender = g.renderer.render;
      g.blastShake.age = g.blastShake.phase = 0;
      for (const fov of [70, 10]) {
        g.camera.fov = fov; g.camera.updateProjectionMatrix();
        g.renderer.render = (scene, camera) => { const at = anchor.clone().project(camera); shifts.push(Math.hypot(at.x, at.y)); }; g.renderView();
      }
      g.renderer.render = captureRender;
      yes(Math.abs(shifts[0] - shifts[1]) < .001, '高倍率スコープでも画面上の揺れが過剰に拡大しない');
      const random = Math.random; let calls = 0;
      try { Math.random = () => { calls++; return .5; }; g.renderView(); } finally { Math.random = random; }
      yes(calls === 0, '描画の揺れはゲームの乱数列を消費しない');
      g.running = false; yes(frame().angle === 0, '一時停止中とメニューでは揺れを表示しない'); g.running = true;
      reset(); explode(); const age = g.blastShake.age; g.loop(performance.now());
      yes(g.blastShake.age > age && g.blastShake.power > 0 && rendered.some(q => q.angleTo(g.camera.quaternion) > 0), '実際のゲームループが時間更新と揺れの描画を呼ぶ');
      g.spawn(u); yes(g.blastShake.power === 0, '再出撃で揺れを初期化する');
      reset(); explode(); g.kill(u, enemy, false, 100000); g.updateBlastShake(.01);
      yes(g.blastShake.power === 0 && frame().angle === 0, '撃破後のキルカメラへ揺れを持ち越さない');
      reset(); explode(); g.setup(); yes(g.blastShake.power === 0, '試合の作り直しで揺れを初期化する');
      const fresh = g.player; fresh.invulT = 0; g.blast({ owner: g.units.find(v => v.team !== fresh.team), team: fresh.team === 'B' ? 'R' : 'B', spec: { dmg: 100, blast: 10 } }, g.targetPoint(fresh), null);
      yes(g.blastShake.power > 0, '次の試合でも爆風揺れが動く');
      g.selectMap('city'); yes(g.blastShake.power === 0, 'マップ変更で揺れを初期化する');
      g.renderer.render = realRender;
      return { passed: checks.length, checks, samples, angles };
    });
    // 本描画と迷彩の再描画に同じ揺れが適用され、描画後に元へ戻ることも実レンダラーで確認する。
    const rendering = await p.evaluate(() => {
      const g = __g, T = g.T; g.selectMap('dock'); g.setup(); g.running = true;
      for (const v of g.units) { v.frozen = true; v.group.visible = false; }
      const u = g.player, owner = g.units.find(v => v.team !== u.team);
      Object.assign(u, { invulT: 0, yaw: 0, pitch: -.1 }); u.pos.set(0, g.terrainH(0, 80), 80); u.group.position.copy(u.pos); u.group.visible = true;
      g.weaponLook(u, 0); g.updateCamera(u, 1); g.scene.updateMatrixWorld(true);
      g.blast({ owner, team: owner.team, spec: { dmg: 4000, blast: 10 } }, g.targetPoint(u), null);
      const frames = [];
      for (const [name, seconds] of [['before', 0], ['shaken', .04], ['settled', .5]]) {
        if (seconds) g.updateBlastShake(seconds === .5 ? .46 : seconds);
        g.running = name !== 'before'; g.renderView();
        frames.push({ name, png: g.renderer.domElement.toDataURL('image/png') });
      }
      g.running = true; g.blast({ owner, team: owner.team, spec: { dmg: 1000, blast: 10 } }, g.targetPoint(u), null);
      u.vis = .1; g.cloakLook(u, 0);
      const base = g.camera.quaternion.clone(), render = g.renderer.render.bind(g.renderer), poses = [];
      g.renderer.render = (scene, camera) => { poses.push(camera.quaternion.clone()); return render(scene, camera); };
      g.renderView(); g.renderer.render = render;
      return { frames, cloakPass: poses.length === 2 && poses[0].equals(poses[1]) && !poses[0].equals(base) && g.camera.quaternion.equals(base) };
    });
    for (const f of rendering.frames) fs.writeFileSync(path.join(out, f.name + '.png'), Buffer.from(f.png.split(',')[1], 'base64'));
    assert.ok(rendering.cloakPass, '本描画と迷彩描画の揺れ、および描画後の復元');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ ...result, cloakPass: rendering.cloakPass, errors }, null, 2) + '\n');
    console.log(`爆風の視界揺れ：${result.passed + 1}項目成功。ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
