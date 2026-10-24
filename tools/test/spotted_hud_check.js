// 偵察済みの敵だけが壁越しに表示され、陣営・期限・ロック判定を混同しないことを確認する。
// python3 tools/test/make_dbg.py dbg && node tools/test/spotted_hud_check.js dbg [画像の出力先]
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const out = path.resolve(process.argv[3] || 'dbg/spotted-hud'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg', 'dbg.html')).href);
    await page.evaluate(() => {
      const g = __g, T = g.T, checks = [];
      g.selectMap('city'); g.setup();
      const p = g.player, team = p.team, foe = team === 'B' ? 'R' : 'B';
      const e = g.units.find(q => q.team === foe), ally = g.units.find(q => q.team === team && q !== p);
      const yes = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
      const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; } g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true); };
      const draw = () => { sync(); g.hud(g.timeLeft, 1 / 60); };
      const marks = () => document.getElementById('spottedMarkers').hidden ? [] : [...document.querySelectorAll('.spottedMark')].filter(m => !m.hidden);
      const pixel = q => { const s = g.targetPoint(q).project(g.camera); return { x: (s.x + 1) * innerWidth / 2, y: (1 - s.y) * innerHeight / 2 }; };
      const follows = (m, q) => { const r = m.getBoundingClientRect(), s = pixel(q); return Math.hypot(r.x + r.width / 2 - s.x, r.y + r.height / 2 - s.y) < .2; };
      const click = () => { g.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); window.dispatchEvent(new MouseEvent('mouseup', { button: 2 })); };
      function reset() {
        for (const k in g.keys) delete g.keys[k]; for (const k in g.pressed) delete g.pressed[k];
        for (const q of g.units) { q.alive = q === p || q === e; q.frozen = true; q.downT = 0; }
        for (const t of g.turrets) t.alive = false;
        g.spotted.B.clear(); g.spotted.R.clear(); g.gadgetUpdate(0);
        Object.assign(g.lock, { target: null, visible: false, prevAng: null, down: false });
        p.team = team; e.team = foe; ally.team = team;
        g.equip(p, 'assault');
        Object.assign(p, { alive: true, weapon: 'main', switchT: 0, repairing: false, transfer: null, jamT: 0, downT: 0, stun: '', yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0, scoped: false, onGround: false, hp: p.maxHp });
        Object.assign(e, { alive: true, cloak: false, cloakT: 0, downT: 0, hp: e.maxHp, invulT: 0 });
        p.pos.set(0, 120, 0); p.vel.set(0, 0, 0); e.pos.set(0, 120, -30); e.vel.set(0, 0, 0); ally.pos.set(6, 120, -30);
        g.gameOptions.fov = 70; g.camera.fov = 70; g.updateCamera(p, 0);
        g.running = true; document.getElementById('overlay').hidden = true; draw();
      }
      window.spotTest = { g, T, p, e, ally, team, foe, reset, draw, marks, follows, yes, checks, sync, click };
      reset(); yes(marks().length === 0, '見えていても未偵察の敵には◆を出さない');
      g.spot(foe, p, 3, null, '検査'); draw(); yes(marks().length === 0, '自機が敵軍に偵察されても敵の位置は分からない');
      g.spot(team, e, 3, null, '検査'); draw(); yes(marks().length === 1 && follows(marks()[0], e), '自軍が偵察した敵の機体中心に◆を表示');
      const before = marks()[0].getBoundingClientRect().x; e.pos.x += 4; e.pos.y += 3; draw();
      yes(marks().length === 1 && follows(marks()[0], e) && Math.abs(marks()[0].getBoundingClientRect().x - before) > 1, '敵の移動と高低差に追従する');
      const el = marks()[0]; for (let i = 0; i < 20; i++) draw(); yes(marks()[0] === el, '毎フレームのDOM再作成なし');
      reset(); g.spot(team, e, .2, null, '検査'); g.gadgetUpdate(.1); draw(); yes(marks().length === 1, '偵察の有効時間中は表示');
      g.spot(team, e, .3, null, '検査'); g.gadgetUpdate(.2); draw(); yes(marks().length === 1, '再偵察で表示時間を延長');
      g.gadgetUpdate(.11); draw(); yes(marks().length === 0 && !g.spotted[team].has(e), '期限切れのフレームで◆を消す');
      reset(); g.spot(team, e, 3, null, '検査'); e.alive = false; draw(); yes(marks().length === 0, '撃破された敵の残存索敵情報を表示しない');
      reset(); ally.alive = true; g.spot(team, ally, 3, null, '検査'); g.spot(team, p, 3, null, '検査');
      g.spot(team, { kind: 'turret', alive: true, team: foe, pos: e.pos.clone() }, 3, null, '検査');
      g.spotted[team].set(e, 0); draw(); yes(marks().length === 0, '味方・自分・砲台・期限0を除外');
      reset(); g.spot(team, e, 3, null, '検査'); p.team = foe; draw(); yes(marks().length === 0, '陣営変更後に相手側の偵察情報を漏らさない');
      ally.alive = true; g.spot(foe, ally, 3, null, '検査'); draw(); yes(marks().length === 1 && follows(marks()[0], ally), '橙陣営からも自軍が偵察した青敵を表示');
      reset(); g.spot(team, e, 3, null, '検査'); e.cloak = true; draw(); yes(marks().length === 1, '迷彩中でも偵察情報が有効なら位置を表示');
      g.spotted[team].clear(); draw(); yes(marks().length === 0, '未偵察の迷彩機は表示しない');
      reset(); e.pos.set(0, 120, -250); g.spot(team, e, 3, null, '検査'); draw(); yes(marks().length === 1 && follows(marks()[0], e), '頭部のロック距離を超えた偵察敵も表示');
      for (const kind of ['behind', 'left', 'right', 'above', 'below']) {
        reset(); g.spot(team, e, 3, null, '検査');
        if (kind === 'behind') e.pos.z = 50;
        else if (kind === 'left') e.pos.x = -200;
        else if (kind === 'right') e.pos.x = 200;
        else if (kind === 'above') e.pos.y = 300;
        else e.pos.y = -100;
        draw(); yes(marks().length === 0, kind + 'の画面外へ◆を出さない');
      }
      reset(); g.spot(team, e, 3, null, '検査');
      const wall = new T.Mesh(new T.BoxGeometry(12, 12, 2), new T.MeshBasicMaterial({ color: 0x656d70 }));
      wall.position.set(0, 124, -15); g.scene.add(wall); g.hittables.push(wall); draw();
      yes(!g.canSee(p, e, g.targetPoint(e)) && marks().length === 1 && follows(marks()[0], e), '遮蔽されていても敵中心の◆は見える');
      for (let i = 0; i < 6; i++) draw(); click();
      yes(!g.lock.target && document.getElementById('preLock').hidden, '◆が見えても壁越しの捕捉とプレロックは不可');
      g.scene.remove(wall); g.hittables.splice(g.hittables.indexOf(wall), 1); wall.geometry.dispose(); wall.material.dispose();
      for (let i = 0; i < 6; i++) draw(); click(); draw(); yes(g.lock.target === e && !document.getElementById('lockMark').hidden && marks().length === 1, '壁を出るとロックと◆を同時に表示');
      click();
      for (const kind of ['jam', 'dead', 'pause', 'overlay']) {
        reset(); g.spot(team, e, 3, null, '検査');
        if (kind === 'jam') p.jamT = 1; if (kind === 'dead') p.alive = false;
        if (kind === 'pause') g.running = false; if (kind === 'overlay') document.getElementById('overlay').hidden = false;
        draw(); yes(marks().length === 0, kind + '中は◆を隠す');
      }
      reset(); g.spot(team, e, 3, null, '検査'); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); draw();
      yes(marks().length === 0, '全体マップ中は◆を隠す'); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); draw(); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' })); yes(marks().length === 1, '全体マップを閉じると◆が戻る');
      for (const slot of ['main', 'sub', 'aux', 'sp']) { reset(); p.weapon = slot; g.spot(team, e, 3, null, '検査'); draw(); yes(marks().length === 1, slot + '装備中も偵察情報を表示'); }
      reset(); g.spot(team, e, 3, null, '検査'); g.openOptions(); draw(); yes(marks().length === 0, '設定画面では◆を隠す');
      g.closeOptions(); draw(); yes(marks().length === 1, '設定から戻ると有効な偵察情報を再表示');
      // 多人数時も既知の座標を投影するだけで、新たな遮蔽レイを飛ばさない。
      reset(); const originalCount = g.units.length, crowd = [];
      for (let i = 0; i < 50; i++) { const q = { ...e, pos: new T.Vector3((i % 10 - 4.5) * 2, 120 + Math.floor(i / 10) * 2, -70) }; crowd.push(q); g.units.push(q); g.spot(team, q, 3, null, '検査'); }
      const original = T.Raycaster.prototype.intersectObjects; let rays = 0;
      T.Raycaster.prototype.intersectObjects = function (...args) { rays++; return original.apply(this, args); };
      try { for (let i = 0; i < 30; i++) g.spottedHud(p); } finally { T.Raycaster.prototype.intersectObjects = original; }
      yes(marks().length === 50 && rays === 0, '50機の偵察表示でも追加raycastは0');
      const pool = [...document.querySelectorAll('.spottedMark')]; for (let i = 0; i < 30; i++) g.spottedHud(p);
      yes(pool.length === document.querySelectorAll('.spottedMark').length && pool.every((m, i) => m === document.querySelectorAll('.spottedMark')[i]), '多数表示でもDOMプールが増え続けない');
      g.units.splice(originalCount); reset();
    });
    for (const theme of ['standard', 'arcade', 'flight', 'mechanical']) {
      await page.evaluate(theme => {
        document.querySelector(`[data-console-choice="${theme}"]`).click();
        const { reset, g, team, e, draw, marks, yes } = spotTest; reset(); g.spot(team, e, 3, null, '検査'); draw();
        const el = marks()[0], s = getComputedStyle(el), bg = s.backgroundColor;
        yes(el && el.getBoundingClientRect().width >= 10 && /^rgb/.test(bg) && bg !== 'rgb(0, 0, 0)', theme + 'でも視認できる◆を表示');
      }, theme);
    }
    // 地上の街区に壁を置き、同じカメラで未偵察／偵察後を撮る。
    await page.evaluate(() => {
      document.querySelector('[data-console-choice="standard"]').click();
      const { reset, g, p, e, T, draw } = spotTest; reset();
      p.pos.set(-20, g.terrainH(-20, 170), 170); p.yaw = 0; p.pitch = -.045;
      e.pos.set(-20, g.terrainH(-20, 135), 135);
      const wall = new T.Mesh(new T.BoxGeometry(18, 12, 2), new T.MeshStandardMaterial({ color: 0x687577, roughness: .9 }));
      wall.position.set(-20, g.terrainH(-20, 150) + 6, 150); g.scene.add(wall); g.hittables.push(wall);
      g.updateCamera(p, 0); for (let i = 0; i < 6; i++) draw(); g.renderer.render(g.scene, g.camera);
    });
    await page.mouse.click(1000, 500); await page.evaluate(() => spotTest.draw());
    await page.screenshot({ path: path.join(out, 'unspotted-wall.png') });
    await page.evaluate(() => { const { g, p, e, team, draw, marks, yes } = spotTest; g.spot(team, e, 3, null, '偵察機'); draw(); yes(!g.canSee(p, e, g.targetPoint(e)) && marks().length === 1 && document.getElementById('preLock').hidden, '撮影場面でも壁越しの◆だけで敵位置を示す'); g.renderer.render(g.scene, g.camera); });
    await page.screenshot({ path: path.join(out, 'spotted-wall.png') });
    assert.deepEqual(errors, []);
    const checks = await page.evaluate(() => spotTest.checks);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks: checks.length, errors, screenshots: out }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
