// 反動をマウスで抑えた後と、抑えないときのロック追従を本体の入力・更新で確かめる。
// node tools/test/recoil_lock_check.js dbg/recoil-lock-after media/recoil-lock-control
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/recoil-lock-after');
const out = path.resolve(process.argv[3] || 'media/recoil-lock-control');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, checks = [], samples = [], dt = 1 / 60;
      const check = (ok, label) => checks.push({ ok: !!ok, label });
      const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
      g.renderer.render = () => g.scene.updateMatrixWorld(true);
      g.selectMap('dock'); document.getElementById('start').click(); g.running = true;
      const u = g.player, target = g.units.find(v => v.team !== u.team);
      const canvas = g.renderer.domElement;
      function fixture(height = 2.4) {
        for (const v of g.units) { v.frozen = true; v.alive = false; v.group.visible = false; }
        Object.assign(u.mech, g.MECH_DEFAULT); g.equip(u, 'support'); u.slots.main = g.slotOf('haggard');
        Object.assign(u, { alive: true, invulT: 0, weapon: 'main', switchT: 0, stun: '', repairing: false, transfer: null, yaw: 0, pitch: 0, onGround: false, dashState: '', planted: false });
        u.pos.set(0, 120, 0); u.vel.set(0, 0, 0); u.group.position.copy(u.pos); u.group.visible = true;
        target.alive = true; target.cloak = false; target.dashState = ''; target.pos.set(0, 120, -30); target.group.position.copy(target.pos); target.group.visible = true;
        // 肩越し視点の横2.2mも含め、照準を狙った高さへ置く。
        for (let i = 0; i < 5; i++) {
          const pivot = u.pos.clone().add(new g.T.Vector3(2.2 * Math.cos(u.yaw), 4.6, -2.2 * Math.sin(u.yaw)));
          const d = target.pos.clone().add(new g.T.Vector3(0, height, 0)).sub(pivot);
          u.yaw = Math.atan2(-d.x, -d.z); u.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        }
        Object.assign(g.lock, { target, visible: true, down: false, losT: 100, lostT: 0, prevAng: { yaw: 0, pitch: Math.atan2(-2.2, 30) } });
        g.camera.fov = 70 / 1.3; g.updateCamera(u, dt); g.weaponLook(u, 0); g.weaponLook(target, 0); g.scene.updateMatrixWorld(true);
      }
      function mouse(yaw, pitch) {
        const sens = .0025 * g.camera.fov / 70 * (u.slots[u.weapon].w.turn || 1);
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        const e = new MouseEvent('mousemove');
        Object.defineProperties(e, { movementX: { value: -yaw / sens }, movementY: { value: -pitch / sens } });
        window.dispatchEvent(e); window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      }
      function aim() {
        const d = g.camera.getWorldDirection(new g.T.Vector3()), t = (target.pos.z - g.camera.position.z) / d.z;
        const at = g.camera.position.clone().addScaledVector(d, t);
        return { x: at.x - target.pos.x, height: at.y - target.pos.y, recoil: u.recoil, yawRecoil: u.recoilYaw, locked: g.lock.target === target, pitch: u.pitch, yaw: u.yaw };
      }
      function frames(count) {
        const trace = [];
        for (let i = 0; i < count; i++) {
          // 落下・歩行は切り離し、同じ場所の敵への本体の追従と反動回復を進める。
          u.pos.set(0, 120, 0); u.vel.set(0, 0, 0); u.onGround = false;
          g.playerUpdate(u, dt); g.updateCamera(u, dt); trace.push(aim());
        }
        return trace;
      }
      // ユーザーの再現手順：反動を下へ抑え、敵の胴へ戻した後に手を止める。
      for (const yaw of [0, .1, -.1]) {
        fixture(); u.recoil = .2; u.recoilYaw = yaw; u.recoilWait = 10; g.updateCamera(u, dt);
        mouse(-yaw, -.2); g.updateCamera(u, dt);
        const start = aim(), trace = frames(20), end = trace.at(-1);
        check(close(start.x, 0, .02) && close(start.height, 2.4, .02), `横反動${yaw}：マウスで胴へ戻せる`);
        check(trace.every(a => a.height >= .4 && a.height <= 3.9 && Math.abs(a.x) <= 1.05), `横反動${yaw}：抑えた照準をロックが敵の外へ押し戻さない`);
        check(end.locked, `横反動${yaw}：抑えた後も敵のロックを維持`);
        samples.push({ kind: 'mouseCompensated', yaw, start, end, trace });
      }
      // 手を動かさない場合も、発射時には跳ね、既存の速度制限で敵へ戻る。
      fixture(); const before = aim(); g.shot(u, u.slots.main, target.pos.clone().add(new g.T.Vector3(0, 2.4, 0)), 0);
      g.updateCamera(u, dt); const kicked = aim();
      check(kicked.height > before.height + .8, '実際のマグナム発射で照準が上へ跳ねる');
      const trace = frames(20), settled = trace.at(-1);
      check(settled.height >= .4 && settled.height <= 3.9, 'マグナム発射後は敵機の範囲へ引き戻す');
      check(trace.every((a, i) => Math.hypot(a.pitch - (i ? trace[i - 1].pitch : kicked.pitch), a.yaw - (i ? trace[i - 1].yaw : kicked.yaw)) <= .8 * dt + 1e-5), '追従は既存の毎秒0.8rad以下で、瞬間移動しない');
      samples.push({ kind: 'magnumShot', before, kicked, settled, trace });
      for (const yaw of [.1, -.1]) {
        fixture(); u.recoil = .2; u.recoilYaw = yaw; u.recoilWait = 10; g.updateCamera(u, dt);
        const start = aim(), trace = frames(30), end = trace.at(-1);
        check(end.height >= .4 && end.height <= 3.9 && Math.abs(end.x) <= 1.05, `横反動${yaw}：操作しなくても縦横とも敵へ引き戻す`);
        check(close(end.recoil, .2) && close(end.yawRecoil, yaw), `横反動${yaw}：反動そのものを消さずに追従する`);
        samples.push({ kind: 'automaticFollow', yaw, start, end, trace });
      }
      fixture(3.6); u.recoil = .2; u.recoilYaw = .1; u.recoilWait = 10; g.updateCamera(u, dt);
      mouse(-.1, -.2); g.updateCamera(u, dt); const head = frames(20).at(-1);
      check(close(head.height, 3.6, .03) && Math.abs(head.x) < .03, '手で反動を抑えて頭へ置いた照準は、胴へ吸い付かない');
      fixture(); u.recoil = .2; u.recoilWait = 10; g.updateCamera(u, dt); mouse(0, -.1); g.updateCamera(u, dt);
      const partial = aim(), afterPartial = frames(20).at(-1);
      check(afterPartial.height < partial.height && afterPartial.height <= 3.9, '半分だけ反動を抑えても、残る上ずれを敵へ戻す');
      fixture(); u.recoil = .2; u.recoilYaw = .1; u.recoilWait = 10; target.dashState = 'short'; g.updateCamera(u, dt);
      const dashStart = aim(), dashEnd = frames(10).at(-1);
      check(close(dashStart.height, dashEnd.height, .03) && close(dashStart.x, dashEnd.x, .03), '相手のショートダッシュ中は反動にも引き戻しを掛けない');
      fixture(); u.recoil = .2; u.recoilYaw = -.1; u.recoilWait = 10; g.updateCamera(u, dt);
      for (let i = 0; i < 30; i++) { target.pos.x += .04; target.group.position.copy(target.pos); g.scene.updateMatrixWorld(true); frames(1); }
      const moving = aim();
      check(moving.locked && Math.abs(moving.x) <= 1.05 && moving.height >= .4 && moving.height <= 3.9, '横へ動く敵にも追従しながら縦横の反動を引き戻す');
      fixture(); u.recoil = .2; u.recoilYaw = .1; u.recoilWait = 10; g.updateCamera(u, dt); mouse(-.1, -.2); g.updateCamera(u, dt);
      u.slots.main.w = { ...u.slots.main.w, spread: 0 };
      const n = g.fx.length, fromAim = g.camera.position.clone().addScaledVector(g.camera.getWorldDirection(new g.T.Vector3()), 300);
      g.shot(u, u.slots.main, fromAim, 0);
      const ray = g.fx.slice(n).find(f => f.kind === 'tracer');
      const actual = ray.end.clone().sub(ray.from).normalize(), expected = fromAim.clone().sub(ray.from).normalize();
      check(actual.distanceTo(expected) < 1e-6, '反動を抑えた後も弾を敵の中心へ補正せず、照準へ撃つ');
      return { checks, samples, head, partial, afterPartial, dashStart, dashEnd, moving };
    });
    result.checks.push({ ok: errors.length === 0, label: 'ブラウザエラーなし' });
    const failed = result.checks.filter(c => !c.ok), passed = result.checks.length - failed.length;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed, failed, ...result, errors }, null, 2) + '\n');
    console.log(`反動とロック追従：${passed}/${result.checks.length}項目成功。失敗${failed.length}、ブラウザエラー${errors.length}`);
    failed.forEach(c => console.error(c.label));
    assert.equal(failed.length, 0);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
