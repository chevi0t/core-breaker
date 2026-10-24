// 表示円の半径2倍での捕捉、捕捉時の中央合わせ、都市の壁際と反動・解除を確認する。
// python3 tools/test/make_dbg.py dbg && node tools/test/lock_acquire_check.js dbg
const path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], results = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg', 'dbg.html')).href);
    await page.evaluate(() => {
      const g = __g, T = g.T;
      const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; } g.scene.updateMatrixWorld(true); };
      function reset(map = 'dock', fov = 70) {
        if (g.mapId !== map || !g.player) { g.selectMap(map); g.setup(); }
        Object.assign(g.lock, { target: null, visible: false, prevAng: null, down: false });
        g.running = true; document.getElementById('overlay').hidden = true;
        const u = g.player, e = g.units.find(q => q.team !== u.team);
        for (const q of g.units) { q.alive = q === u; q.frozen = true; }
        for (const q of g.turrets) q.alive = false;
        g.equip(u, 'assault'); Object.assign(u, { alive: true, weapon: 'main', switchT: 0, repairing: false, transfer: null, stun: '', onGround: false, yaw: 0, pitch: 0 });
        u.pos.set(0, 300, 0); u.vel.set(0, 0, 0);
        Object.assign(e, { alive: true, cloak: false, downT: 0 }); e.pos.set(0, 300, -30);
        g.gameOptions.fov = fov; g.camera.fov = fov; g.updateCamera(u, 0); sync();
        return { u, e };
      }
      // 実際に表示する円の幅から画面上の捕捉位置を作る。敵の中心を指定の方向と半径へ投影する。
      function place(e, multiple, angle = 0) {
        const radius = parseFloat(document.getElementById('lockRing').style.width) / 2;
        const x = radius * multiple * Math.cos(angle) / (innerWidth / 2), y = radius * multiple * Math.sin(angle) / (innerHeight / 2);
        const ray = new T.Vector3(x, y, .5).unproject(g.camera).sub(g.camera.position).normalize();
        e.pos.copy(g.camera.position).addScaledVector(ray, 38); e.pos.y -= 2.4; sync();
      }
      const pixelError = e => { const p = g.targetPoint(e).project(g.camera); return Math.hypot(p.x * innerWidth / 2, p.y * innerHeight / 2); };
      const click = () => { g.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); };
      window.acquireTest = { g, T, sync, reset, place, pixelError, click };
    });
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1600, height: 1000 }, { width: 800, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => dispatchEvent(new Event('resize')));
      results.push(await page.evaluate(() => {
        const { g, reset, place, click, pixelError } = acquireTest; let cases = 0, maxError = 0;
        for (const fov of [50, 70, 100]) for (let i = 0; i < 8; i++) for (const multiple of [1.5, 1.99, 2.01]) {
          const { u, e } = reset('dock', fov); place(e, multiple, i * Math.PI / 4);
          const width = document.getElementById('lockRing').style.width, yaw = u.yaw, pitch = u.pitch;
          click();
          if (multiple <= 2) {
            if (g.lock.target !== e) throw Error(`半径${multiple}倍の捕捉失敗: ${innerWidth}x${innerHeight}, FOV${fov}, 方向${i}`);
            const error = pixelError(e); maxError = Math.max(maxError, error);
            if (error > .5) throw Error(`捕捉時に中央へ合わない: ${error}px, FOV${fov}, 方向${i}`);
            click(); if (g.lock.target) throw Error('再クリックで解除できない');
          } else if (g.lock.target || u.yaw !== yaw || u.pitch !== pitch) throw Error('半径2倍より外を捕捉、または空振りで視点が動いた');
          if (document.getElementById('lockRing').style.width !== width) throw Error('捕捉範囲と一緒に表示円を拡大した');
          cases++;
        }
        return { viewport: [innerWidth, innerHeight], cases, maxError };
      }));
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => dispatchEvent(new Event('resize')));
    const extra = await page.evaluate(() => {
      const { g, T, reset, sync, place, click, pixelError } = acquireTest;
      const yes = (ok, name) => { if (!ok) throw Error(name); }; let cases = 0;
      for (const map of ['city', 'wide', 'mesa', 'hoshimichi', 'kanto', 'dock-melee']) {
        const { u, e } = reset(map);
        if (map === 'dock-melee') { u.weapon = 'aux'; u.switchT = 0; }
        place(e, 1.8, Math.PI / 4); click(); yes(g.lock.target === e && pixelError(e) < .5, map + 'の中央合わせ'); cases++;
      }
      for (const map of ['hoshimichi', 'kanto']) {
        const { u, e } = reset(map);
        const wall = new T.Mesh(new T.BoxGeometry(.5, 12, 12), new T.MeshBasicMaterial());
        wall.position.set(2, 304, 0); g.scene.add(wall); g.cityMap.addCameraGeometry([wall]);
        g.updateCamera(u, 0); yes(g.cityMap.cameraState.occluded && g.cityMap.cameraState.side < 1.8, '壁際でカメラが肩から寄る');
        place(e, 1.8, Math.PI); click(); yes(g.lock.target === e && pixelError(e) < .5, map + 'の壁際でも中央へ合わせる');
        g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose(); cases++;
      }
      {
        const { u, e } = reset(); u.recoil = .13; u.recoilYaw = -.06; u.recoilWait = 10; g.updateCamera(u, 0);
        place(e, 1.8, Math.PI / 3); click();
        yes(g.lock.target === e && pixelError(e) < .5 && u.recoil === .13 && u.recoilYaw === -.06 && u.recoilWait === 10, '反動の蓄積値を消さず、視点を中央へ合わせる'); cases++;
      }
      {
        const { u, e } = reset(); place(e, 1.5); click();
        const second = g.units.filter(q => q.team !== u.team)[1]; second.alive = true; second.cloak = false; second.downT = 0;
        place(second, 1.5, Math.PI); g.pressed.KeyQ = true; g.playerUpdate(u, 1e-6); delete g.pressed.KeyQ;
        yes(g.lock.target === second && pixelError(second) < .5, 'Qで選んだ新しい対象も中央へ合わせる'); cases++;
        // 頭へ狙い直した後の通常追従では、毎フレーム胴体中心へ戻さない。
        u.pitch += .025; g.updateCamera(u, 0); const before = pixelError(second);
        for (let i = 0; i < 15; i++) { u.pos.set(0, 300, 0); u.vel.set(0, 0, 0); g.playerUpdate(u, 1 / 60); g.updateCamera(u, 1 / 60); }
        yes(g.lock.target === second && pixelError(second) > before * .8, '捕捉後は頭への手動照準を維持できる'); cases++;
      }
      {
        const { e } = reset(), other = g.units.filter(q => q.team !== g.player.team)[1]; other.alive = true; other.cloak = false; other.downT = 0;
        place(e, .5); place(other, 1.5, Math.PI); click(); yes(g.lock.target === e, '複数の敵は照準に近い方を捕捉する'); cases++;
      }
      return { cases };
    });
    // フレーム更新を挟まない実クリックでも、外側の敵を捕捉して中央へ合わせる。
    await page.evaluate(() => { const { e } = acquireTest.reset(); acquireTest.place(e, 1.8); });
    await page.mouse.click(640, 400, { button: 'right' });
    assert(await page.evaluate(() => __g.lock.target === acquireTest.g.units.find(q => q.team !== __g.player.team) && acquireTest.pixelError(__g.lock.target) < .5));
    await page.mouse.click(640, 400, { button: 'right' });
    assert(await page.evaluate(() => __g.lock.target === null));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewports: results, extra, realClicks: true, errors }));
    console.log('半径2倍の捕捉境界・中央合わせ・反動・都市の壁際・再クリック解除：成功。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
