// 中央固定の照準と実射線、視点の反動、同フレームの入力をブラウザで確認する。
// node tools/test/camera_recoil_check.js dbg/camera-recoil [結果フォルダ]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const errors = [], p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg/camera-recoil', 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], samples = [];
      const yes = (ok, text) => { if (!ok) throw Error(text); checks.push(text); };
      g.selectMap('dock'); document.getElementById('start').click(); g.running = true;
      const u = g.player;
      g.renderer.render = () => g.scene.updateMatrixWorld(true);
      const wall = new T.Mesh(new T.BoxGeometry(250, 250, .1), new T.MeshBasicMaterial());
      g.scene.add(wall); g.hittables.push(wall);
      function reset(key, dist = 40, recoil = .12, side = .02, fov = 70) {
        for (const q of g.units) { q.alive = false; q.frozen = true; q.group.visible = false; }
        for (const t of g.turrets) t.alive = false;
        const cls = Object.keys(g.ARMORY).find(c => Object.values(g.ARMORY[c]).flat().includes(key));
        const slot = Object.keys(g.ARMORY[cls]).find(k => g.ARMORY[cls][k].includes(key));
        u.isPlayer = true; g.equip(u, cls); u.slots[slot] = g.slotOf(key); u.weapon = slot;
        u.slots[slot].w = { ...u.slots[slot].w, spread: 0, hip: 0, sway: 0 };
        Object.assign(u, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, switchT: 0, stun: '', stunT: 0, repairing: false, transfer: null, onGround: true, yaw: 0, pitch: 0, longDash: false, dashT: 0, lungeT: 0, dashState: '', recoil, recoilYaw: side, recoilWait: 100, scoped: !!u.slots[slot].w.scope, scopeStep: 0 });
        u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.group.visible = true;
        u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0);
        g.lock.target = null; g.lock.visible = false; g.gameOptions.fov = fov;
        g.camera.fov = u.scoped ? fov / g.scopePower(u) : fov; wall.position.set(0, 200, -dist);
        g.weaponLook(u, 0); g.scene.updateMatrixWorld(true); g.updateCamera(u, 1); g.hud(g.timeLeft, 0);
        return u.slots[slot];
      }
      const pixel = point => { const at = point.clone().project(g.camera); return { x: (at.x + 1) * innerWidth / 2, y: (1 - at.y) * innerHeight / 2 }; };
      function cursor() {
        if (u.scoped) return { x: parseFloat(getComputedStyle(document.getElementById('scope'), '::before').left), y: parseFloat(getComputedStyle(document.getElementById('scope'), '::after').top) };
        const id = document.body.dataset.console === 'mechanical' ? 'mechAim' : 'cross', r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      function fire(sl, dist) {
        const n = g.fx.length, k = g.shells.length; g.shot(u, sl, g.viewAim(u), 0);
        const ray = g.fx.slice(n).filter(f => f.kind === 'tracer' || f.kind === 'laser').at(-1);
        if (ray) return pixel(ray.end || ray.from.clone().addScaledVector(ray.dir, ray.len));
        const sh = g.shells[k], time = (-dist + .05 - sh.pos.z) / sh.vel.z;
        return pixel(sh.pos.clone().addScaledVector(sh.vel, time));
      }
      for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
        document.querySelector(`[data-console-choice="${mode}"]`).click();
        for (const key of ['ar', 'gatling', 'mg', 'haggard', 'sniper', 'lightSniper', 'rocket', 'plasma']) {
          for (const dist of [10, 40, 100]) for (const fov of [60, 100]) {
            const sl = reset(key, dist, .12, .02, fov), mark = cursor(), actual = fire(sl, dist);
            const gap = Math.hypot(mark.x - actual.x, mark.y - actual.y);
            yes(Math.hypot(mark.x - innerWidth / 2, mark.y - innerHeight / 2) < .25, mode + '：照準を中央へ固定');
            yes(gap < .25, `${mode}/${key}/${dist}m/FOV${fov}：照準と実弾の差 ${gap}px`);
            samples.push({ mode, key, dist, fov, gap });
          }
        }
      }
      document.querySelector('[data-console-choice="standard"]').click();
      const sl = reset('gatling', 40, 0, 0), neutral = g.camera.quaternion.clone(), start = g.camera.position.clone();
      let angle = 0, translation = 0, shots = 0;
      for (let n = 0; n < 160; n++) {
        g.recoilRecover(u, .01); g.weaponLook(u, .01); g.scene.updateMatrixWorld(true); g.updateCamera(u, .01);
        const begin = g.fx.length; sl.cd = 0; sl.spin = 1; g.weaponsTick(u, 0, true, g.viewAim(u), 0);
        const ray = g.fx.slice(begin).find(f => f.kind === 'tracer');
        if (ray) { shots++; const at = pixel(ray.end); yes(Math.hypot(at.x - innerWidth / 2, at.y - innerHeight / 2) < .25, '連射中も反動を二重加算しない'); }
        g.updateCamera(u, .01); angle = Math.max(angle, neutral.angleTo(g.camera.quaternion));
        translation = Math.max(translation, start.distanceTo(g.camera.position)); g.fxUpdate(.01);
      }
      yes(shots > 15 && angle > .04 && translation > .1, '連射で以前のように視点全体が動く');
      g.recoilRecover(u, 100); g.updateCamera(u, 1); g.hud(g.timeLeft, 0);
      yes(neutral.angleTo(g.camera.quaternion) < 1e-7 && start.distanceTo(g.camera.position) < 1e-7, '撃ち止めると視点が元へ戻る');
      reset('ar', 40, 0, 0);
      const floor = { minX: -10, maxX: 10, minZ: -10, maxZ: 10, top: 200 }; g.obstacles.push(floor);
      const begin = g.fx.length, canvas = g.renderer.domElement; canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      const move = new MouseEvent('mousemove'); Object.defineProperties(move, { movementX: { value: -80 }, movementY: { value: 0 } });
      window.dispatchEvent(move); g.playerUpdate(u, 0); window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      const ray = g.fx.slice(begin).find(f => f.kind === 'tracer'), at = pixel(ray.end);
      yes(Math.abs(u.yaw - .2) < 1e-7 && Math.hypot(at.x - innerWidth / 2, at.y - innerHeight / 2) < .25, '振り向いたフレームの射撃が更新後の視点と一致');
      g.obstacles.splice(g.obstacles.indexOf(floor), 1);
      return { passed: checks.length, checks, samples, shots, angle, translation };
    });
    assert.deepEqual(errors, []);
    const out = path.resolve(process.argv[3] || 'dbg/camera-recoil/results'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ ...result, errors }, null, 2));
    console.log(`視点の反動・固定照準：${result.passed}項目、4HUD・8武器・距離/画角・連射・入力同期を確認。ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
