// 実際の入力・射撃・占拠で13課題を通し、退出後の対戦設定と保存データを検査する。
// python3 tools/test/make_dbg.py <dbg> && node tools/test/tutorial_check.js <dbg> [結果dir]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
const dir = path.resolve(process.argv[2]), out = path.resolve(process.argv[3] || '/tmp/tutorial-check');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] }), errors = [];
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p.on('pageerror', e => errors.push(e.stack));
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => {
      requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined;
      HTMLCanvasElement.prototype.requestPointerLock = () => Promise.resolve();
      localStorage.setItem('coreBreakerMap', 'dock');
      localStorage.setItem('coreBreakerLoadout', JSON.stringify({ heavy: { sub: 'rocketH' }, support: { main: 'shotgunQ' } }));
      localStorage.setItem('coreBreakerMech', JSON.stringify({ head: 'heavy', body: 'heavy', arms: 'heavy', legs: 'heavy', color: 'ash' }));
    });
    await p.goto(pathToFileURL(path.join(dir, 'dbg.html')).href);
    await p.evaluate(() => { window.nativeRender = __g.renderer.render.bind(__g.renderer); __g.renderer.render = () => __g.scene.updateMatrixWorld(true); });
    const tick = async (n = 1) => p.evaluate(n => { for (let i = 0; i < n; i++) __g.loop(performance.now()); }, n);
    const state = () => p.evaluate(() => ({ index: __g.tutorial?.index, done: __g.tutorial?.done, running: __g.running, hp: __g.tutorial?.target.hp, player: __g.player?.pos.toArray(), weapon: __g.player?.weapon, ammo: __g.player?.slots[__g.player.weapon].ammo, phase: document.getElementById('tutorialTitle').textContent }));
    const storage = () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));
    await p.locator('#teamSize').selectOption('50'); await p.locator('#teamChoice input[value="R"]').check();
    await p.locator('#ovCls [data-cls="heavy"]').click(); // メニューの兵装は選んでカスタマイズを開くので、戻る
    assert(await p.locator('#pgCustom').isVisible()); await p.locator('#pgCustom .pgh .back').click();
    const saved = await storage(), normalCatalog = await p.evaluate(() => JSON.stringify({ weapons: __g.WEAPONS, parts: __g.PARTS, maps: __g.MAPS }));
    await p.locator('[data-page="pgTutorialIntro"]').click(); assert(await p.locator('#pgTutorialIntro').isVisible());
    await p.locator('#tutorialStart').click(); await tick();
    assert.equal(await p.evaluate(() => __g.units.length), 2);
    assert.equal(await p.evaluate(() => __g.player.slots.main.w.key), 'ar');
    assert.equal(await p.evaluate(() => __g.player.mech.head), 'standard');
    assert.equal(await p.evaluate(() => __g.tutorial.target.pos.distanceTo(__g.player.pos)), 25);
    await tick(100); assert.equal((await state()).index, 0); assert.equal((await state()).done, false);
    await p.keyboard.press('Enter'); assert.equal((await state()).index, 0);
    const time = await p.evaluate(() => __g.timeLeft); await tick(30); assert.equal(await p.evaluate(() => __g.timeLeft), time);
    // Escで確実に止まり、押しっぱなしの移動をやり直しへ持ち越さない。
    await p.keyboard.down('KeyW'); await p.keyboard.press('Escape'); assert(await p.locator('#pgTutorialPause').isVisible());
    await p.keyboard.press('Escape'); assert(await p.locator('#pgTutorialPause').isVisible());
    await p.keyboard.press('F3'); assert(await p.locator('#pgOptions').isVisible()); await p.keyboard.press('Escape'); assert(await p.locator('#pgTutorialPause').isVisible());
    const paused = (await state()).player; await tick(50); assert.deepEqual((await state()).player, paused);
    await p.locator('#tutorialRetry').click(); await p.keyboard.up('KeyW'); const retry = (await state()).player; await tick(10); assert.deepEqual((await state()).player, retry);
    await p.keyboard.press('F3'); assert(await p.locator('#pgOptions').isVisible()); await tick(30); assert.equal((await state()).done, false);
    await p.keyboard.press('Escape'); await tick(); assert.equal((await state()).running, true); assert.equal((await state()).index, 0);
    const rows = [];
    async function done(index) { await tick(); const s = await state(); assert.equal(s.index, index); assert.equal(s.done, true, JSON.stringify(s)); rows.push(s); console.log(index + ': ' + s.phase); }
    async function next(index) { await p.keyboard.press('Enter'); await tick(); assert.equal((await state()).index, index); assert.equal((await state()).done, false); }
    async function hold(code, n) { await p.keyboard.down(code); await tick(n); await p.keyboard.up(code); }
    async function mouse(button = 0, down = true) {
      await p.evaluate(({ button, down }) => __g.renderer.domElement.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button, bubbles: true })), { button, down });
    }
    // 本体のマウス入力へ角度差を渡す。機体の角度や命中を直接書き換えない。
    async function aim(core = false) {
      await mouse();
      for (let i = 0; i < 8; i++) {
        const d = await p.evaluate(core => {
          const g = __g, at = core ? g.cores.R.pos.clone().add(new g.T.Vector3(0, -1, 6)) : g.targetPoint(g.tutorial.target), v = at.sub(g.camera.position), f = new g.T.Vector3();
          g.camera.getWorldDirection(f); const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
          const sens = .0025 * g.camera.fov / 70;
          return { x: Math.max(-100, Math.min(100, -wrap(Math.atan2(-v.x, -v.z) - Math.atan2(-f.x, -f.z)) / sens)), y: Math.max(-100, Math.min(100, -(Math.atan2(v.y, Math.hypot(v.x, v.z)) - Math.atan2(f.y, Math.hypot(f.x, f.z))) / sens)) };
        }, core);
        await p.evaluate(d => { const e = new MouseEvent('mousemove', { bubbles: true }); Object.defineProperties(e, { movementX: { value: d.x }, movementY: { value: d.y } }); dispatchEvent(e); }, d);
        await tick();
      }
      await mouse(0, false);
    }
    await hold('ArrowRight', 4); await done(0); await next(1);
    await hold('KeyW', 12); await done(1); await next(2);
    await hold('Space', 3); await done(2); await next(3);
    await p.keyboard.down('KeyW'); await hold('ShiftLeft', 12); await p.keyboard.up('KeyW'); await done(3); await next(4);
    await aim(); await mouse(); await tick(12); await mouse(0, false); await done(4); await next(5);
    await hold('KeyR', 1); await tick(70); await done(5); await next(6);
    await mouse(2); await mouse(2, false); await tick(); assert(await p.evaluate(() => __g.lock.target === __g.tutorial.target));
    assert.equal((await state()).done, false); await mouse(2); await mouse(2, false); await done(6); await next(7);
    await aim(); await p.keyboard.press('Digit2'); await tick(25); assert.equal((await state()).done, false);
    await mouse(); await tick(2); await mouse(0, false); await tick(80); await done(7); await next(8);
    await aim(); await p.keyboard.press('Digit3'); await tick(25); assert.equal((await state()).done, false);
    await hold('KeyW', 6); await mouse(); await tick(25); await mouse(0, false); await done(8); await next(9);
    await p.keyboard.press('Digit4'); await p.keyboard.down('KeyW'); await hold('ShiftLeft', 30); await p.keyboard.up('KeyW'); await done(9); await next(10);
    await p.keyboard.press('KeyM'); await done(10); await next(11);
    await hold('KeyW', 55); await tick(230); await done(11); await next(12);
    await aim(true); await mouse(); await tick(20); await mouse(0, false); await done(12);
    await p.evaluate(() => window.nativeRender(__g.scene, __g.camera)); await p.screenshot({ path: path.join(out, 'lesson.png') });
    await p.keyboard.press('Enter'); assert(await p.locator('#pgTutorialDone').isVisible());
    await p.keyboard.press('Escape'); assert(await p.locator('#pgTutorialDone').isVisible());
    await p.keyboard.press('F3'); await p.keyboard.press('Escape'); assert(await p.locator('#pgTutorialDone').isVisible());
    assert((await p.locator('#tutorialDoneText').innerText()).includes('達成 13項目・スキップ 0項目'));
    await p.locator('#tutorialRestart').click(); await tick(30); assert.equal((await state()).index, 0); assert.equal((await state()).done, false);
    await p.keyboard.press('Escape'); await p.locator('#tutorialSkip').click(); await tick(); assert.equal((await state()).index, 1);
    // 演習中に大破してもゲームオーバーにせず、同じ課題をやり直せる。
    await p.evaluate(() => __g.blast({ owner: __g.player, team: __g.player.team, weaponName: '試験爆風', spec: { dmg: 100000, blast: 10 } }, __g.player.pos.clone(), null));
    await tick(); assert.equal((await state()).index, 1); assert(await p.evaluate(() => __g.player.alive)); assert.equal((await state()).done, false);
    await p.keyboard.press('Escape'); await p.locator('#tutorialExit').click();
    assert.equal(await p.evaluate(() => __g.tutorial), null); assert.equal(await p.evaluate(() => __g.player), null);
    assert(await p.locator('#pgMenu').isVisible()); assert.equal(await p.locator('#teamSize').inputValue(), '50'); assert(await p.locator('#teamChoice input[value="R"]').isChecked());
    assert.deepEqual(await storage(), saved); assert.equal(await p.evaluate(() => JSON.stringify({ weapons: __g.WEAPONS, parts: __g.PARTS, maps: __g.MAPS })), normalCatalog);
    await p.locator('#start').click(); await tick();
    const normal = await p.evaluate(() => ({ count: __g.units.length, team: __g.player.team, cls: __g.player.cls, sub: __g.player.slots.sub.w.key, head: __g.player.mech.head, map: __g.mapId, tutorial: __g.tutorial }));
    assert.deepEqual(normal, { count: 100, team: 'R', cls: 'heavy', sub: 'rocketH', head: 'heavy', map: 'dock', tutorial: null });
    assert.deepEqual(errors, []);
    const result = { lessons: rows, completed: rows.length, actualInput: true, savedPreferencesUnchanged: true, catalogsUnchanged: true, pauseRetrySkipRestartAndDeathRecovery: true, normalBattleAfterExit: normal, errors };
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ completed: rows.length, settingsRestored: true, normalUnits: normal.count, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exit(1); });
