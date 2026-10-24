// 右クリックの捕捉／解除、自由照準、持ち替えと装備固有の右操作を実際の入力で確かめる。
// python3 tools/test/make_dbg.py dbg && node tools/test/manual_lock_check.js dbg
const path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg', 'dbg.html')).href);
    await page.evaluate(() => {
      const g = __g, T = g.T, dt = 1 / 60, checks = [];
      g.selectMap('dock'); g.setup(); g.running = true;
      document.getElementById('overlay').hidden = true;
      const u = g.player, e = g.units.find(q => q.team !== u.team), e2 = g.units.filter(q => q.team !== u.team)[1];
      const canvas = g.renderer.domElement;
      const yes = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
      const sync = () => {
        for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; }
        g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
      };
      const right = (down = true) => (down ? canvas : window).dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: 2, bubbles: true }));
      const click = () => { right(); right(false); };
      const aim = () => {
        for (let i = 0; i < 5; i++) {
          const p = u.pos.clone().add(new T.Vector3(2.2 * Math.cos(u.yaw), 4.6, -2.2 * Math.sin(u.yaw)));
          const d = g.targetPoint(e).sub(p); u.yaw = Math.atan2(-d.x, -d.z); u.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        }
        g.updateCamera(u, 1); sync();
      };
      const step = (n = 1) => {
        for (let i = 0; i < n; i++) {
          u.pos.set(0, 120, 0); u.vel.set(0, 0, 0); u.onGround = false;
          g.playerUpdate(u, dt); g.updateCamera(u, dt); sync();
          for (const k in g.pressed) delete g.pressed[k];
        }
      };
      function reset(cls = 'assault', weapon = 'main', key = null) {
        right(false);
        for (const k in g.keys) delete g.keys[k];
        for (const k in g.pressed) delete g.pressed[k];
        for (const q of g.units) { q.frozen = true; q.alive = false; }
        for (const q of g.turrets) q.alive = false;
        for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0;
        Object.assign(g.lock, { target: null, visible: false, prevAng: null, cand: null, acqT: 0 });
        g.equip(u, cls); if (key) u.slots[weapon] = g.slotOf(key);
        Object.assign(u, { alive: true, weapon, switchT: 0, repairing: false, transfer: null, stun: '', stunT: 0,
          recoverT: 0, dashT: 0, longDash: false, flying: false, onGround: false, jamT: 0, electricT: 0,
          yaw: 0, pitch: 0, downT: 0, hp: u.maxHp, invulT: 0, ctrlLockT: 0, altHeld: false, planted: !!u.slots[weapon].w.plant });
        u.pos.set(0, 120, 0); u.vel.set(0, 0, 0);
        Object.assign(e, { alive: true, downT: 0, cloak: false, cloakT: 0, dashState: '', hp: e.maxHp, invulT: 0 });
        e.pos.set(0, 120, -30); e.vel.set(0, 0, 0);
        g.camera.fov = 70; g.camera.updateProjectionMatrix(); aim();
        return u.slots[weapon];
      }
      window.manualLockTest = { g, u, e, e2, yes, sync, right, click, step, reset, aim, checks };
      reset(); e.alive = false; sync();
    });
    // ポインタ固定を含め、通常ブラウザのクリック入力で捕捉と解除を確認する。
    await page.mouse.click(640, 360, { button: 'right' });
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.evaluate(() => {
      const { reset, step, yes, g } = manualLockTest; reset(); step(60);
      yes(!g.lock.target, '照準に敵を入れて1秒待っても自動ロックしない');
      g.pressed.KeyQ = true; step(); yes(!g.lock.target, 'Qだけでは捕捉を始めない');
    });
    await page.mouse.down({ button: 'right' });
    await page.evaluate(() => {
      const { yes, g, e, step } = manualLockTest;
      yes(g.lock.target === e, '実右クリックの押下で即座に捕捉する'); step(20);
      yes(g.lock.target === e, '右ボタンを長押ししても解除を繰り返さない');
    });
    await page.mouse.up({ button: 'right' });
    await page.evaluate(() => {
      const { yes, g, e, u, step, sync } = manualLockTest;
      const yaw = u.yaw; e.pos.x += 3; sync(); step(20);
      yes(g.lock.target === e && u.yaw < yaw - .01, 'ボタンを離した後もロック中の敵を視点で追う');
      yes(g.camera.fov < 60, 'ロック中は従来の1.3倍ズームになる');
    });
    await page.mouse.click(640, 360, { button: 'right' });
    await page.evaluate(() => {
      const { yes, g, e, u, step, sync } = manualLockTest;
      yes(!g.lock.target, '2回目の実右クリックで解除する');
      const yaw = u.yaw, pitch = u.pitch; e.pos.x += 1; sync(); step(60);
      yes(!g.lock.target && u.yaw === yaw && u.pitch === pitch, '解除後は敵を追わず、中央に残っていても再捕捉しない');
      yes(Math.abs(g.camera.fov - 70) < .01, '解除後は通常の画角へ戻る');
    });
    const result = await page.evaluate(() => {
      const { g, u, e, e2, yes, sync, click, right, step, reset, aim, checks } = manualLockTest;
      reset(); click(); click(); step(); yes(!g.lock.target, '同一フレーム間の短い2クリックも捕捉・解除として扱う');
      reset(); e.alive = false; sync(); click(); e.alive = true; sync(); step(30);
      yes(!g.lock.target, '敵がいない所のクリックを予約捕捉にしない');
      for (const kind of ['dead', 'ally', 'cloak', 'range', 'behind', 'outside']) {
        reset(); const team = e.team;
        if (kind === 'dead') e.alive = false;
        if (kind === 'ally') e.team = u.team;
        if (kind === 'cloak') e.cloak = true;
        if (kind === 'range') e.pos.z = -u.lockRange * 2;
        if (kind === 'behind') e.pos.z = 30;
        if (kind === 'outside') e.pos.x = 15;
        sync(); click(); yes(!g.lock.target, kind + 'の敵を捕捉しない'); e.team = team;
      }
      const wall = new g.T.Mesh(new g.T.BoxGeometry(4, 12, 1), new g.T.MeshBasicMaterial());
      reset(); wall.position.set(0, 123, -15); g.scene.add(wall); g.hittables.push(wall); sync(); click();
      yes(!g.lock.target, '壁越しに新しい対象を捕捉しない');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall);
      reset(); click(); g.scene.add(wall); g.hittables.push(wall); sync(); step(48);
      yes(!g.lock.target, '遮蔽が続くと解除する');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose(); step(30);
      yes(!g.lock.target, '壁から出てきても再クリックまで再捕捉しない');
      reset(); click(); Object.assign(e2, { alive: true, cloak: false, downT: 0 }); e2.pos.set(5, 120, -30); sync();
      g.pressed.KeyQ = true; step(); yes(g.lock.target === e2, 'Qはロック中の対象を切り替える');
      click(); step(30); yes(!g.lock.target, '対象切り替え後も再クリックで解除できる');
      for (const kind of ['jam', 'repair', 'transfer', 'range', 'dead', 'outside', 'cloak']) {
        reset(); click();
        if (kind === 'jam') u.jamT = 1;
        if (kind === 'repair') u.repairing = true;
        if (kind === 'transfer') u.transfer = { t: 10 };
        if (kind === 'range') e.pos.z = -200;
        if (kind === 'dead') e.alive = false;
        if (kind === 'outside') e.pos.x = 100;
        if (kind === 'cloak') { e.cloak = true; e.cloakT = 1; }
        sync(); step(); yes(!g.lock.target, kind + 'でロックを解除する');
      }
      reset(); click(); g.kill(u, e, '検査用'); yes(!g.lock.target, '自機の撃破でロックを解除する');
      g.spawn(u); u.pos.set(0, 120, 0); aim(); step(30); yes(!g.lock.target, '再出撃してもロックを復活させない');
      reset(); u.switchT = 1; click(); step(65); yes(!g.lock.target, '持ち替え中の押下を後から実行しない');
      reset('heavy'); click(); g.selectWeapon(u, 'sub'); yes(!g.lock.target, 'ロケランへの持ち替え直後に解除する');
      step(60); click(); step(); yes(!g.lock.target, 'ロケランの右クリックで視点追従を始めない');
      g.selectWeapon(u, 'main'); step(60); yes(!g.lock.target, '主武器へ戻っても自動で再捕捉しない');
      click(); yes(g.lock.target === e, '主武器へ戻った後の新しいクリックで捕捉できる');
      reset(); click(); g.selectWeapon(u, 'aux'); step(60);
      yes(g.lock.target === e, '主武器から近接へ持ち替えたときは手動ロックを維持する');
      click(); click(); yes(g.lock.target === e, '近接を持っていても右クリックで解除・捕捉できる');
      g.selectWeapon(u, 'sp'); yes(g.lock.target === e && u.chargerOn, '武器を持ち替えない加速装置ONはロックを維持する');
      g.selectWeapon(u, 'main'); click(); yes(!g.lock.target && u.switchT > 0, 'ロックの解除は持ち替え中でも即座に受け付ける');
      reset('raid', 'sub', 'sniper'); right(); step(); yes(u.scoped && !g.lock.target, '狙撃銃の右長押しはスコープだけを使う');
      right(false); step(); yes(!u.scoped, '狙撃銃の右ボタンを離すとスコープを戻す');
      reset('raid', 'sub', 'zoom');
      for (const n of [1, 2, 0]) { click(); step(); yes(u.scopeStep === n && !g.lock.target, '二段ズームの循環' + n + 'はロックと干渉しない'); }
      const sl = reset('assault', 'sub', 'missile'); step(60); yes(sl.missileLocks.length > 0, 'ミサイルは専用の自動捕捉を維持する');
      right(); step(); yes(!sl.missileLocks.length && !g.lock.target, 'ミサイルの右操作は専用捕捉を解除する'); right(false);
      reset('support', 'sp', 'repair'); u.hp -= 1000; const hp = u.hp; right(); step();
      yes(u.hp > hp && u.healTarget === u && !g.lock.target, 'リペアの右長押しで自己修復できる'); right(false);
      reset('support', 'sub', 'remote');
      const bomb = g.shoot(u, u.pos.clone().add(new g.T.Vector3(8, 1, -10)), new g.T.Vector3(), u.slots.sub.w.proj);
      // 接地した遠隔爆弾を本体の弾更新で設置する。
      bomb.pos.y = g.terrainH(bomb.pos.x, bomb.pos.z) + .05; bomb.vel.set(0, -10, 0); g.shellUpdate(.05);
      yes(g.gadgets.some(q => q.owner === u && q.kind === 'remote'), '遠隔爆弾を設置できる');
      for (let i = 0; i < 120; i++) g.gadgetUpdate(1 / 60);
      right(); step(); yes(!g.gadgets.some(q => q.owner === u && q.kind === 'remote') && !g.lock.target, '右クリックは遠隔起爆として動く'); right(false);
      reset('heavy', 'sp', 'cannon'); u.prevWeapon = 'main'; right(); step();
      yes(u.weapon === 'main' && !g.lock.target, '重砲の右クリックは構えを中断する'); right(false);
      reset('heavy'); g.selectWeapon(u, 'sp'); u.slots.sp = g.slotOf('artillery'); u.weapon = 'sp'; u.prevWeapon = 'main'; u.switchT = 0;
      click(); yes(u.weapon === 'main' && !g.lock.target, '榴弾砲の右クリックは砲撃を中断し、戻った主武器をロックしない');
      let primary = 0;
      for (const [cls, slots] of Object.entries(g.ARMORY)) for (const key of slots.main) {
        reset(cls, 'main', key); click(); yes(g.lock.target === e, key + 'の右クリックで捕捉'); click(); yes(!g.lock.target, key + 'の再クリックで解除'); primary++;
      }
      let melee = 0;
      for (const key of Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].type === 'sword')) {
        reset('assault', 'aux', key); click(); yes(g.lock.target === e, key + 'の近接でも手動捕捉'); click(); yes(!g.lock.target, key + 'の近接でも再クリックで解除'); melee++;
      }
      // ロック中でも実弾は任意に選んだ照準点へ飛ぶ。
      reset(); click(); u.slots.main.w = { ...u.slots.main.w, spread: 0 };
      const fromAim = g.targetPoint(e).add(new g.T.Vector3(4, 0, 0)), before = g.fx.length;
      g.shot(u, u.slots.main, fromAim, 0);
      const tracer = g.fx.slice(before).find(q => q.kind === 'tracer');
      yes(tracer && tracer.end.clone().sub(tracer.from).normalize().distanceTo(fromAim.clone().sub(tracer.from).normalize()) < 1e-6, 'ロック中も弾道を敵中心へ補正しない');
      return { checks: checks.length, primary, melee };
    });
    // 全体マップの右クリックは防衛指示に使い、捕捉・解除に回さない。
    await page.evaluate(() => { const t = manualLockTest; t.reset(); t.click(); });
    await page.keyboard.press('m');
    await page.mouse.click(640, 360, { button: 'right' });
    await page.evaluate(() => { const { g, e, yes } = manualLockTest; yes(g.lock.target === e, '全体マップ上の防衛指示でロックを切り替えない'); });
    await page.keyboard.press('m');
    await page.mouse.click(640, 360, { button: 'right' });
    assert.equal(await page.evaluate(() => __g.lock.target === null), true, '地図を閉じた後の右クリックは解除');
    await page.evaluate(() => {
      const g = __g; g.selectMap('dock-melee'); g.setup(); g.running = true;
      const u = g.player, e = g.units.find(q => q.team !== u.team);
      for (const q of g.units) { q.alive = q === u || q === e; q.frozen = true; q.pos.set(0, 120, q === u ? 0 : -30); q.group.position.copy(q.pos); q.group.visible = q.alive; }
      u.switchT = 0; u.yaw = 0; u.pitch = -.055; g.updateCamera(u, 1); g.scene.updateMatrixWorld(true);
    });
    await page.mouse.click(640, 360, { button: 'right' });
    assert.equal(await page.evaluate(() => __g.player.weapon === 'aux' && !!__g.lock.target), true, '近接限定戦でも実クリックで捕捉');
    await page.mouse.click(640, 360, { button: 'right' });
    assert.equal(await page.evaluate(() => __g.lock.target === null), true, '近接限定戦でも実クリックで解除');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...result, realInputs: true, mapCommand: true, meleeArena: true, errors }));
    console.log('手動ロック・解除後の自由照準・持ち替え・装備固有の右クリック：成功。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
