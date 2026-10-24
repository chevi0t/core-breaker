// プレロックの可視性と実右クリックの一致、捕捉演出の一回性をブラウザで確認する。
// python3 tools/test/make_dbg.py dbg && node tools/test/prelock_hud_check.js dbg [画像の出力先]
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const out = path.resolve(process.argv[3] || 'dbg/prelock-hud'); fs.mkdirSync(out, { recursive: true });
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
      const u = g.player, enemies = g.units.filter(q => q.team !== u.team), e = enemies[0], e2 = enemies[1];
      const enemyTeam = e.team, canvas = g.renderer.domElement;
      const yes = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
      const sync = () => {
        for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; }
        g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
      };
      const right = down => (down ? canvas : window).dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: 2, bubbles: true }));
      const click = () => { right(true); right(false); };
      const key = code => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); window.dispatchEvent(new KeyboardEvent('keyup', { code })); };
      const draw = () => { sync(); g.hud(g.timeLeft, 1 / 60); };
      const settle = () => { for (let i = 0; i < 6; i++) draw(); };
      const marks = () => document.getElementById('preLock').hidden ? [] : [...document.querySelectorAll('.preLockMark')].filter(m => !m.hidden);
      const pixel = q => { const s = g.targetPoint(q).project(g.camera); return { x: (s.x + 1) * innerWidth / 2, y: (1 - s.y) * innerHeight / 2 }; };
      const follows = (m, q) => { const r = m.getBoundingClientRect(), p = pixel(q); return Math.hypot(r.x + r.width / 2 - p.x, r.y + r.height / 2 - p.y) < .1; };
      function place(q, radius, angle = 0, distance = 38) {
        const r = parseFloat(document.getElementById('lockRing').style.width) / 2;
        const ray = new T.Vector3(r * radius * Math.cos(angle) / (innerWidth / 2), r * radius * Math.sin(angle) / (innerHeight / 2), .5).unproject(g.camera).sub(g.camera.position).normalize();
        q.pos.copy(g.camera.position).addScaledVector(ray, distance); q.pos.y -= 2.4; sync();
      }
      function reset(cls = 'assault', weapon = 'main', weaponKey = null) {
        right(false);
        g.running = false; draw(); // 前の場面の遮蔽キャッシュを持ち込まない。
        for (const k in g.keys) delete g.keys[k]; for (const k in g.pressed) delete g.pressed[k];
        for (const q of g.units) { q.alive = false; q.frozen = true; }
        for (const q of g.turrets) q.alive = false;
        for (const team of ['B', 'R']) g.spotted[team].clear();
        Object.assign(g.lock, { target: null, visible: false, prevAng: null, down: false });
        g.equip(u, cls); if (weaponKey) u.slots[weapon] = g.slotOf(weaponKey);
        Object.assign(u, { alive: true, weapon, switchT: 0, repairing: false, transfer: null, stun: '', stunT: 0,
          recoverT: 0, dashT: 0, dashState: '', longDash: false, flying: false, onGround: false, jamT: 0, electricT: 0,
          yaw: 0, pitch: 0, downT: 0, hp: u.maxHp, invulT: 0, ctrlLockT: 0, altHeld: false, scoped: false, recoil: 0, recoilYaw: 0 });
        u.pos.set(0, 120, 0); u.vel.set(0, 0, 0);
        for (const q of [e, e2]) { Object.assign(q, { team: enemyTeam, alive: true, cloak: false, cloakT: 0, downT: 0, dashState: '', hp: q.maxHp, invulT: 0 }); q.vel.set(0, 0, 0); }
        g.running = true; document.getElementById('overlay').hidden = true;
        g.gameOptions.fov = 70; g.camera.fov = 70; g.updateCamera(u, 0);
        place(e, .65, Math.PI); place(e2, 1.65); draw();
      }
      const step = () => { g.playerUpdate(u, 1e-6); g.updateCamera(u, 0); draw(); for (const k in g.pressed) delete g.pressed[k]; };
      window.prelockTest = { g, u, e, e2, T, yes, checks, sync, click, key, draw, settle, marks, pixel, follows, place, reset, step };
      reset();
      const visible = marks(), chosen = visible.find(m => m.classList.contains('selected'));
      yes(visible.length === 2 && visible.filter(m => m.classList.contains('selected')).length === 1, 'ロック可能な2体のうち1体だけ強調');
      yes(follows(chosen, e), '照準に近い敵の胴体へプレロックを投影');
      yes(+getComputedStyle(chosen).opacity > +getComputedStyle(visible.find(m => m !== chosen)).opacity, '候補の明暗差');
      const pool = [...document.querySelectorAll('.preLockMark')]; for (let i = 0; i < 20; i++) draw();
      yes(pool.length === document.querySelectorAll('.preLockMark').length && pool.every((m, i) => m === document.querySelectorAll('.preLockMark')[i]), '通常更新でマーカーDOMを再生成しない');
    });
    await page.mouse.click(640, 400, { button: 'right' });
    await page.evaluate(() => {
      const { g, e, draw, marks, yes } = prelockTest; draw();
      yes(g.lock.target === e && !marks().length && !document.getElementById('lockMark').hidden, '実右クリックが明るい候補を捕捉しアンバーへ切り替わる');
      const br = document.querySelector('#lockMark .br'), a = br.getAnimations()[0];
      yes(!!a && a.effect.getTiming().iterations === 1, 'ロック成立時だけ一回のアニメーション');
      a.pause(); a.currentTime = 0; const w0 = br.getBoundingClientRect().width;
      a.currentTime = 150; const w1 = br.getBoundingClientRect().width, flash = getComputedStyle(br).filter;
      a.currentTime = 299; const w2 = br.getBoundingClientRect().width;
      yes(w0 > w1 * 1.4 && Math.abs(w1 - w2) < .1 && flash.includes('brightness'), '0.15秒で外から閉じて発光し、その後は拡大しない');
      for (let i = 0; i < 5; i++) draw();
      yes(br.getAnimations()[0] === a, 'フレーム更新でアニメーションを開始し直さない');
      a.finish(); draw(); yes(br.getAnimations().length === 0, '収束後は点滅せず安定表示');
      g.lock.visible = false; draw(); yes(document.getElementById('lockMark').classList.contains('lost'), '遮蔽の維持猶予中は薄く表示');
      g.lock.visible = true; draw(); yes(br.getAnimations().length === 0, '遮蔽から再び見えても発光しない');
    });
    await page.mouse.click(640, 400, { button: 'right' });
    await page.evaluate(() => {
      const { g, u, e, e2, yes, reset, place, draw, settle, marks, click, key, step, follows, sync } = prelockTest;
      draw(); yes(!g.lock.target && document.getElementById('lockMark').hidden && marks().length > 0, '実再クリックで解除してプレロックに戻る');
      for (const kind of ['dead', 'ally', 'cloak', 'range', 'behind', 'outside']) {
        reset(); e2.alive = false;
        if (kind === 'dead') e.alive = false;
        if (kind === 'ally') e.team = u.team;
        if (kind === 'cloak') e.cloak = true;
        if (kind === 'range') place(e, .65, 0, 200);
        if (kind === 'behind') e.pos.z = 40;
        if (kind === 'outside') place(e, 2.01);
        draw(); yes(!marks().length, kind + 'はプレロックしない'); click(); yes(!g.lock.target, kind + 'のクリック結果も一致');
      }
      reset(); e2.alive = false;
      const wall = new g.T.Mesh(new g.T.BoxGeometry(4, 12, 1), new g.T.MeshBasicMaterial());
      wall.position.copy(u.pos).lerp(e.pos, .5); wall.position.y += 3; g.scene.add(wall); g.hittables.push(wall); settle();
      yes(!marks().length, '遮蔽更新後は壁の裏の敵をプレロックしない'); click(); yes(!g.lock.target, '壁越しに捕捉しない');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); settle();
      yes(marks().length === 1, '遮蔽がなくなると約0.1秒で表示を戻す');
      reset(); yes(follows(marks().find(m => m.classList.contains('selected')), e), '新たな遮蔽前の候補を確認');
      wall.position.copy(u.pos).lerp(e.pos, .5); wall.position.y += 3; g.scene.add(wall); g.hittables.push(wall); sync();
      click(); yes(g.lock.target === e2, '遮蔽キャッシュの更新前でもクリック時は見える次候補を選ぶ');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
      reset(); e.alive = e2.alive = false;
      const turret = g.turrets.find(q => q.team !== u.team), turretPos = turret.pos.clone();
      turret.alive = true; place(turret, .65); turret.base.position.copy(turret.pos).y += 1.2; turret.head.position.copy(turret.pos).y += 2.4; draw();
      yes(marks().length === 1, '敵の防衛砲台もプレロックする'); click(); yes(g.lock.target === turret, '防衛砲台の表示と捕捉が一致');
      turret.pos.copy(turretPos); turret.base.position.copy(turretPos).y += 1.2; turret.head.position.copy(turretPos).y += 2.4;
      reset(); e2.alive = false; u.lockRange = 50; place(e, .65, 0, 70); draw();
      yes(!marks().length, '通常の頭部ロック距離外を除外'); g.spot(u.team, e, 3); draw();
      yes(marks().length === 1, '索敵によるロック距離延長も表示へ反映'); click(); yes(g.lock.target === e, '索敵延長中の実捕捉と一致');
      for (const kind of ['switch', 'repair', 'transfer', 'jam', 'dead', 'pause', 'overlay']) {
        reset();
        if (kind === 'switch') u.switchT = 1;
        if (kind === 'repair') u.repairing = true;
        if (kind === 'transfer') u.transfer = { t: 2 };
        if (kind === 'jam') u.jamT = 1;
        if (kind === 'dead') u.alive = false;
        if (kind === 'pause') g.running = false;
        if (kind === 'overlay') document.getElementById('overlay').hidden = false;
        draw(); yes(!marks().length && document.getElementById('lockMark').hidden, kind + '中は通常ロックの表示を隠す');
      }
      reset(); key('KeyM'); draw(); yes(!marks().length, '全体マップ操作中はプレロックを隠す'); key('KeyM'); draw(); yes(marks().length === 2, '全体マップを閉じると復帰');
      window.dispatchEvent(new MouseEvent('mousedown', { button: 3, buttons: 8 })); draw(); yes(!marks().length, '武器選択中はプレロックを隠す');
      window.dispatchEvent(new MouseEvent('mouseup', { button: 3, buttons: 0 })); reset(); yes(marks().length === 2, '武器選択から復帰');
      reset('heavy', 'sub'); yes(!marks().length, 'ロケットランチャーは自由照準のまま');
      reset('raid', 'sub', 'sniper'); yes(!marks().length, '狙撃スコープと分離');
      reset('assault', 'sub', 'missile'); g.missileLockTick(u, u.slots.sub, .5, true, false); draw();
      yes(!marks().length && !document.getElementById('missileHud').hidden, 'ミサイル専用カーソルと分離');
      reset('assault', 'aux'); yes(marks().length === 2, '近接武器もプレロック可能');
      reset(); click(); draw(); const seq = g.lock.visualSeq;
      g.pressed.KeyQ = true; step(); yes(g.lock.target === e2 && g.lock.visualSeq > seq && document.querySelector('#lockMark .br').getAnimations().length === 1, 'Qの対象切り替えで一回だけ再演出');
      const seq2 = g.lock.visualSeq; click(); click(); draw();
      yes(g.lock.visualSeq > seq2 && document.querySelector('#lockMark .br').getAnimations().length === 1, '同じフレームで解除・再捕捉しても演出を一回再生');
      g.openOptions(); draw(); yes(!marks().length && document.getElementById('lockMark').hidden, '設定表示中はロックマーカーを隠す');
      g.closeOptions(); draw(); yes(!document.getElementById('lockMark').hidden && document.querySelector('#lockMark .br').getAnimations().length === 0, '設定から戻っても捕捉演出を再発火しない');
      // タグなど他のHUDと分けて、通常ロック表示による遮蔽レイだけを計数する。
      reset(); const crowd = g.units.filter(q => q.team !== u.team);
      crowd.forEach((q, i) => { q.alive = true; q.cloak = false; q.downT = 0; place(q, 1.6, i / crowd.length * Math.PI * 2); });
      g.running = false; g.lockHud(u, 1 / 60); g.running = true;
      const original = g.T.Raycaster.prototype.intersectObjects, rays = [], directions = new Set(); let n = 0;
      g.T.Raycaster.prototype.intersectObjects = function (...args) {
        n++; directions.add(this.ray.direction.toArray().map(v => v.toFixed(4)).join(','));
        return original.apply(this, args);
      };
      try { for (let i = 0; i < 30; i++) { n = 0; g.lockHud(u, 1 / 60); rays.push(n); } }
      finally { g.T.Raycaster.prototype.intersectObjects = original; }
      yes(crowd.length >= 10 && Math.max(...rays) <= 2 && directions.size >= crowd.length, '多候補でも最大2本/frameを守り、遮蔽検査が全候補を巡回する');
      reset();
    });
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 800, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        dispatchEvent(new Event('resize'));
        const { reset, place, e, e2, draw, marks, yes, follows, click, g } = prelockTest;
        for (const fov of [50, 70, 100]) {
          reset(); e2.alive = false; g.gameOptions.fov = fov; g.camera.fov = fov; g.updateCamera(g.player, 0); place(e, 1.99, Math.PI / 4); draw();
          yes(marks().length === 1 && follows(marks()[0], e), `${innerWidth}x${innerHeight} FOV${fov}の捕捉境界付近も正しく表示`); click(); yes(g.lock.target === e, '画面比・FOV変更後も表示対象を捕捉');
        }
      });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => dispatchEvent(new Event('resize')));
    for (const theme of ['standard', 'arcade', 'flight', 'mechanical']) {
      await page.evaluate(theme => {
        document.querySelector(`[data-console-choice="${theme}"]`).click();
        const { reset, draw, marks, yes, click } = prelockTest; reset();
        const s = getComputedStyle(marks()[0]); yes(s.getPropertyValue('--c').trim() === '#72e9f5', theme + 'のプレロックはシアン');
        click(); draw(); const mk = document.getElementById('lockMark'), br = mk.querySelector('.br');
        for (const a of br.getAnimations()) a.finish();
        yes(getComputedStyle(mk).getPropertyValue('--c').trim() === '#ffbd59' && parseFloat(getComputedStyle(mk).getPropertyValue('--stroke')) >= 4, theme + 'のロックは太いアンバー');
      }, theme);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const { reset, click, draw, yes } = prelockTest; reset(); click(); draw();
      yes(!document.getElementById('lockMark').hidden && document.querySelector('#lockMark .br').getAnimations().length === 0, '動きを減らす設定では収束演出なしでロックを表示');
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // 実際の地形を背景に、2体の候補とロック完了状態を保存する。
    await page.evaluate(() => {
      document.querySelector('[data-console-choice="standard"]').click();
      const { reset, u, e, e2, g, draw, yes, marks } = prelockTest; reset();
      u.pos.set(-20, 0, 170); u.pos.y = g.terrainH(u.pos.x, u.pos.z); u.yaw = 0; u.pitch = -.045;
      e.pos.set(-23, 0, 135); e2.pos.set(-14, 0, 132);
      for (const q of [e, e2]) q.pos.y = g.terrainH(q.pos.x, q.pos.z);
      g.updateCamera(u, 0); draw(); g.renderer.render(g.scene, g.camera);
      yes(marks().length === 2, '地上の候補2体を描画');
    });
    await page.screenshot({ path: path.join(out, 'prelock.png') });
    await page.evaluate(() => {
      const { click, draw, g } = prelockTest; click(); draw();
      const a = document.querySelector('#lockMark .br').getAnimations()[0]; a.pause(); a.currentTime = 0;
      g.renderer.render(g.scene, g.camera);
    });
    await page.screenshot({ path: path.join(out, 'lock-closing.png') });
    await page.evaluate(() => { document.querySelector('#lockMark .br').getAnimations()[0].currentTime = 150; });
    await page.screenshot({ path: path.join(out, 'lock-flash.png') });
    await page.evaluate(() => { for (const a of document.querySelector('#lockMark .br').getAnimations()) a.finish(); });
    await page.screenshot({ path: path.join(out, 'locked.png') });
    assert.deepEqual(errors, []);
    const checks = await page.evaluate(() => prelockTest.checks);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ count: checks.length, checks, errors, out }));
    console.log('プレロック・捕捉演出・状態切替・4コンソール：成功。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
