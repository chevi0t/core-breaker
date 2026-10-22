// 切り返しブーストでも捕捉と視点追従を維持し、射線だけに小さい遅れを残す。
// node tools/test/recoil_lock_check.js dbg/lock-lag [結果フォルダ]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg/lock-lag', 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], samples = [], yes = (ok, s) => { if (!ok) throw Error(s); checks.push(s); };
      const near = (a, b) => Math.abs(a - b) < 1e-7;
      g.selectMap('dock'); document.getElementById('start').click(); g.running = true;
      g.renderer.render = () => g.scene.updateMatrixWorld(true);
      const u = g.player, e = g.units.find(q => q.team !== u.team), canvas = g.renderer.domElement;
      g.obstacles.push({ minX: -120, maxX: 120, minZ: -120, maxZ: 120, top: 120 });
      function sync() {
        for (const v of [u, e]) { v.group.position.copy(v.pos); v.group.rotation.set(0, v.yaw, 0); v.group.visible = v.alive; g.weaponLook(v, 0); }
        g.scene.updateMatrixWorld(true);
      }
      function fixture(distance = 30, fov = 70, back = false) {
        for (const v of g.units) { v.frozen = true; v.alive = false; v.group.visible = false; }
        for (const t of g.turrets) t.alive = false;
        for (const k of Object.keys(g.keys)) g.keys[k] = false;
        for (const v of [u, e]) {
          v.isPlayer = true; Object.assign(v.mech, g.MECH_DEFAULT); if (v === e) v.mech.legs = 'light';
          g.equip(v, 'assault'); v.slots.main = g.slotOf('ar');
          Object.assign(v, { alive: true, isPlayer: v === u, invulT: 0, weapon: 'main', switchT: 0, stun: '', stunT: 0, repairing: false, transfer: null,
            yaw: 0, pitch: 0, onGround: true, dashT: 0, longDash: false, lungeT: 0, recoverT: 0, slideT: 0, planted: false, scoped: false,
            recoil: 0, recoilYaw: 0, cloak: false, downT: 0, dashState: '', ctrlLockT: 0, overheat: false, flying: false, jamT: 0 });
          v.vel.set(0, 0, 0);
        }
        e.hp = e.maxHp = 1e6;
        u.pos.set(0, 120, 0); e.pos.set(0, 120, back ? distance : -distance); u.yaw = back ? Math.PI : 0;
        for (let n = 0; n < 8; n++) {
          const pivot = u.pos.clone().add(new T.Vector3(2.2 * Math.cos(u.yaw), 4.6, -2.2 * Math.sin(u.yaw))), d = g.targetPoint(e).sub(pivot);
          u.yaw = Math.atan2(-d.x, -d.z); u.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        }
        Object.assign(g.lock, { target: e, visible: true, losT: 0, lostT: 0, prevAng: null, lagYaw: 0, lagPitch: 0, edgeT: 0 });
        g.gameOptions.fov = fov; g.camera.fov = fov / 1.3; sync(); g.updateCamera(u, 1); frame();
      }
      function aim() {
        const d = g.camera.getWorldDirection(new T.Vector3()), t = (e.pos.z - g.camera.position.z) / d.z;
        const at = g.camera.position.clone().addScaledVector(d, t);
        const gap = ((e.pos.x - g.camera.position.x) * d.z - (e.pos.z - g.camera.position.z) * d.x) / Math.hypot(d.x, d.z);
        return { x: at.x - e.pos.x, gap, height: at.y - e.pos.y, yaw: u.yaw, pitch: u.pitch, locked: g.lock.target === e, enemyX: e.pos.x, playerX: u.pos.x };
      }
      function frame(dt = 1 / 60) { sync(); g.playerUpdate(u, dt); g.updateCamera(u, dt); return aim(); }
      function fire() {
        const hp = e.hp, sl = { ...u.slots.main, w: { ...u.slots.main.w, spread: 0, recoil: 0, recoilH: 0 } };
        g.shot(u, sl, g.viewAim(u), 0); return e.hp < hp;
      }
      function mouse(yaw, pitch) {
        const sens = .0025 * g.camera.fov / 70, count = Math.max(1, Math.ceil(Math.max(Math.abs(yaw), Math.abs(pitch)) / sens / 200));
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        for (let n = 0; n < count; n++) {
          const ev = new MouseEvent('mousemove');
          Object.defineProperties(ev, { movementX: { value: -yaw / sens / count }, movementY: { value: -pitch / sens / count } });
          window.dispatchEvent(ev);
        }
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      }
      fixture(); const start = aim(); u.recoil = .2; u.recoilYaw = .1; u.recoilWait = 10;
      for (let n = 0; n < 30; n++) { const a = frame(); yes(near(a.yaw, start.yaw) && near(a.pitch, start.pitch), '静止相手のロックで反動を自動補償しない'); }
      fixture(); mouse(.12, .09); g.updateCamera(u, 1); const offset = aim();
      yes(Math.abs(offset.x) > 2, 'マウスで照準を機体の外へ動かす');
      for (let n = 0; n < 30; n++) frame();
      yes(aim().locked && near(offset.yaw, u.yaw) && near(offset.pitch, u.pitch), '手動で外した照準を敵の中心へ戻さない');
      const side = new T.Vector3(1, 0, 0);
      for (const distance of [10, 20, 40]) for (const fps of [30, 60, 144]) for (const fov of [60, 100]) {
        fixture(distance, fov); const trace = [], dt = 1 / fps, period = Math.round(.3 * fps), yaw0 = u.yaw;
        let dashes = 0, missFrames = 0, maxGap = 0, misses = 0;
        for (let n = 0; n < Math.round(2.4 * fps); n++) {
          const direction = Math.floor(n / period) % 2 ? -1 : 1, wish = side.clone().multiplyScalar(direction);
          if (n % period === 0 && g.shortDash(e, wish)) dashes++;
          g.physics(e, wish, false, false, dt); const a = frame(dt); a.t = (n + 1) * dt; trace.push(a);
          maxGap = Math.max(maxGap, Math.abs(a.gap)); if (Math.abs(a.gap) > 1.3) missFrames++;
          if (distance === 20 && fps === 60 && fov === 60 && n % 3 === 0 && Math.abs(a.gap) > 1.3 && !fire()) misses++;
        }
        yes(dashes >= 7 && trace.every(a => a.locked), `${distance}m/${fps}fps/FOV${fov}：実ブーストの連続切り返しでも捕捉を維持`);
        yes(maxGap > 1.3 && maxGap < 2.5 && missFrames > 0, `${distance}m/${fps}fps/FOV${fov}：射線を機体の半径より少し外す（${maxGap}m）`);
        yes(Math.max(...trace.map(a => Math.abs(a.yaw - yaw0))) > .05, '切り返し中も視点が敵を追う');
        e.vel.set(0, 0, 0); e.dashT = 0; e.dashState = '';
        for (let n = 0; n < fps; n++) frame(dt);
        yes(aim().locked && Math.abs(aim().x) < .5, '停止後は移動由来の遅れを詰める');
        if (distance === 20 && fps === 60 && fov === 60) yes(misses > 0 && fire(), '実弾もブースト中は外れ、追従が落ち着くと命中する（散布/反動0で分離）');
        samples.push({ kind: 'boostReversal', distance, fps, fov, dashes, dashV: e.dashV, maxGap, missFrames, misses, trace });
      }
      for (const fps of [30, 60, 144]) {
        fixture(); let maxGap = 0, retained = true;
        for (let n = 0; n < 3 * fps; n++) { e.pos.x = (n + 1) / fps * 8; const a = frame(1 / fps); maxGap = Math.max(maxGap, Math.abs(a.gap)); retained &&= a.locked; }
        yes(retained && maxGap < 1, fps + 'fps：通常の横移動は体幅内を追い、ずれを積み上げない');
      }
      function movingOffset(manual, recoil) {
        fixture(); mouse(manual ? .08 : 0, manual ? .04 : 0);
        if (recoil) { u.recoil = .03; u.recoilYaw = .02; u.recoilWait = 10; }
        for (let n = 0; n < 90; n++) { e.pos.x = Math.min(n / 60, .5) * 6; frame(); }
        return { yaw: u.yaw, pitch: u.pitch, locked: aim().locked };
      }
      const neutral = movingOffset(false, false), manual = movingOffset(true, false), kicked = movingOffset(false, true);
      yes(manual.locked && near(manual.yaw - neutral.yaw, .08) && near(manual.pitch - neutral.pitch, .04), '移動中や追従が落ち着いた後もマウスで加えた照準ずれを維持');
      yes(kicked.locked && near(kicked.yaw, neutral.yaw) && near(kicked.pitch, neutral.pitch), '動く敵への追従でも射撃反動を自動補償しない');
      for (const distance of [10, 20, 40]) {
        const gaps = samples.filter(s => s.distance === distance).map(s => s.maxGap);
        yes(Math.max(...gaps) - Math.min(...gaps) < .4, distance + 'm：30/60/144fpsとFOV60/100で避け幅の差を小さく保つ');
      }
      for (const fps of [30, 60, 144]) {
        fixture(20); const trace = [], dt = 1 / fps; g.shortDash(u, side);
        for (let n = 0; n < fps; n++) trace.push(frame(dt));
        yes(trace.every(a => a.locked) && Math.max(...trace.map(a => Math.abs(a.x))) < 2.5, fps + 'fps：自機のブーストでも捕捉して視点が追う');
      }
      fixture(); e.pos.x = 6; const yaw = u.yaw; frame(1 / 120);
      yes(Math.abs(u.yaw - yaw) > 0 && Math.abs(u.yaw - yaw) <= 4 / 120 + 1e-8, '急な角移動にも4rad/秒の旋回上限を守る');
      fixture(20, 70, true); e.pos.x = .2; frame(); const wrapYaw = u.yaw; e.pos.x = -.2; frame();
      yes(Math.abs(u.yaw - wrapYaw) < .1 && aim().locked, '角度の±π境界でも一周しない');
      fixture(); mouse(.7, 0); g.updateCamera(u, 1);
      for (let n = 0; n < 10; n++) frame();
      yes(aim().locked, '保持範囲を短く外れても捕捉を維持');
      for (let n = 0; n < 15; n++) frame();
      yes(!g.lock.target, '保持範囲を長く外れたら解除する');
      fixture(); e.alive = false; frame(); yes(!g.lock.target, '撃破された敵を解除');
      fixture(); e.pos.z = -100; frame(); yes(!g.lock.target, '射程外の敵を解除');
      fixture(); e.cloak = true; e.cloakT = 1.1; frame(); yes(!g.lock.target, '迷彩で消えた敵を解除');
      fixture(); u.slots.main = g.slotOf('sniper'); frame(); yes(!g.lock.target, '通常ロックしない武器で解除');
      fixture(); u.jamT = 1; frame(); yes(!g.lock.target, '妨害中は解除');
      fixture(); const wall = new T.Mesh(new T.BoxGeometry(15, 10, 1), new T.MeshBasicMaterial());
      wall.position.set(0, 123, -15); g.scene.add(wall); g.hittables.push(wall); g.lock.losT = 0;
      for (let n = 0; n < 45; n++) frame();
      yes(!g.lock.target && g.lock.prevAng === null && !g.lock.lagYaw && !g.lock.lagPitch && !g.lock.edgeT, '遮蔽による解除と追従状態の初期化');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
      return { passed: checks.length, checks, samples };
    });
    assert.deepEqual(errors, []); const out = path.resolve(process.argv[3] || 'dbg/lock-lag/results'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ ...result, errors }, null, 2));
    console.log(`ロック維持と遅れのある視点追従：${result.passed}項目、実ブースト18ケース成功。ブラウザエラー0`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
