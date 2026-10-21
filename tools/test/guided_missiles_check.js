// ブラウザ版の誘導弾：捕捉、発射配分、衝突、警告、Botを実際のゲーム処理で確認する。
// python3 tools/test/make_dbg.py dbg/missiles && node tools/test/guided_missiles_check.js dbg/missiles
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = path.resolve(__dirname, '../..'), dir = path.resolve(process.argv[2] || 'dbg/missiles');
const source = JSON.parse(fs.readFileSync(path.join(root, 'research/weapons/types/guided-missiles.json'), 'utf8'));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    p.on('pageerror', e => errors.push(e.stack));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.abort());
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const catalog = await p.evaluate(() => ({ weapons: __g.WEAPONS, armory: __g.ARMORY }));
    for (const [base, family] of Object.entries(source.families)) {
      const ws = Object.values(catalog.weapons).filter(w => w.series === catalog.weapons[base].series);
      assert.equal(ws.length, family.adopted.length);
      for (const row of family.adopted) {
        const w = ws.find(w => w.label === (row.label || '標準型'));
        assert.ok(w, base + row.label); assert.ok(catalog.armory[family.class].sub.includes(w.key));
        for (const k of ['rpm', 'mag', 'mags', 'reload', 'kg']) assert.equal(w[k], row[k], w.key + k);
        for (const k of ['dmg', 'blast', 'speed', 'maxSpeed', 'accel', 'turn']) assert.equal(w.proj[k], row[k], w.key + k);
        for (const k of ['shots', 'locks', 'rank']) assert.equal(w.missile[k], row[k], w.key + k);
        assert.ok(Math.abs(w.recoil * 180 / Math.PI - row.recoilV) < 1e-8);
        assert.ok(Math.abs(w.recoilH * 180 / Math.PI - row.recoilH) < 1e-8);
        assert.match(w.model, /^[A-Z]{2}-\d+[A-Z]*$/); assert.equal(w.noLock, true);
      }
    }
    const checks = await p.evaluate(() => {
      const g = __g, T = g.T, out = [], yes = (ok, name) => { if (!ok) throw Error(name); out.push(name); };
      const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
      g.selectMap('city'); document.getElementById('start').click(); g.running = false;
      const u = g.player, enemies = g.units.filter(q => q.team !== u.team), e = enemies[0], e2 = enemies[1];
      const scene = g.scene, originalRender = g.renderer.render.bind(g.renderer);
      g.renderer.render = () => scene.updateMatrixWorld(true);
      const clear = () => { for (const sh of g.shells) scene.remove(sh.mesh); g.shells.length = 0; };
      const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.visible = q.alive; } scene.updateMatrixWorld(true); };
      function reset(key = 'missile', bot = false) {
        clear();
        for (const q of g.units) { q.alive = false; q.frozen = true; q.isPlayer = false; }
        for (const q of g.turrets) q.alive = false;
        const cls = key.startsWith('mlrs') ? 'heavy' : 'assault';
        u.isPlayer = true; g.loadout[cls].sub = key; g.equip(u, cls); u.isPlayer = !bot;
        for (const q of [u, e, e2]) {
          Object.assign(q, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, downT: 0, cloak: false, cloakT: 0,
            stun: '', electricT: 0, jamT: 0, weakT: 0, repairing: false, transfer: null, flying: false,
            barrierOn: false, fieldOn: false, escortOn: false, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 } });
          q.vel.set(0, 0, 0);
        }
        u.pos.set(0, 100, 0); e.pos.set(0, 100, -55); e2.pos.set(24, 100, -55);
        u.yaw = u.pitch = 0; u.target = e; u.aimPos.copy(g.targetPoint(e)); u.reloadMul = u.aimMul = 1; u.lockRange = 70;
        g.selectWeapon(u, 'sub'); u.switchT = 0;
        g.camera.position.set(0, 102.4, 0); g.camera.lookAt(g.targetPoint(e)); g.camera.updateMatrixWorld(true);
        g.lock.target = null; g.clearMissileLocks(u.slots.sub); sync();
        return u.slots.sub;
      }
      function tick(seconds, trigger = false, alt = false) {
        for (let n = 0; n < Math.round(seconds * 100); n++) g.weaponsTick(u, .01, trigger, g.targetPoint(e), 0, alt);
      }
      const launch = (sl, target = e, from = new T.Vector3(0, 102.4, 0)) => {
        const sh = g.shoot(u, from, new T.Vector3(0, 0, -sl.w.proj.speed), sl.w.proj);
        if (target) sh.missileTarget = { target, life: target.lifeId || 0 };
        return sh;
      };
      const wall = () => {
        const mesh = new T.Mesh(new T.BoxGeometry(20, 12, 1), new T.MeshBasicMaterial());
        mesh.position.set(0, 103, -10); scene.add(mesh); g.hittables.push(mesh); sync();
        return () => { g.hittables.splice(g.hittables.indexOf(mesh), 1); scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); };
      };
      {
        const sl = reset(); tick(.38); yes(!sl.missileLocks.length, '強襲の捕捉は0.38秒では成立しない');
        tick(.01); yes(sl.missileLocks.length === 1, '0.39秒で捕捉が成立');
        tick(1); yes(sl.missileLocks.length === 1, '強襲の基本型は単一ロック');
        tick(.01, false, true); yes(!sl.missileLocks.length, '右クリックで捕捉解除');
        tick(.5, false, true); yes(!sl.missileLocks.length, '解除を押している間は再捕捉しない');
      }
      {
        const sl = reset(); tick(.2); g.camera.lookAt(new T.Vector3(25, 102.4, -55)); g.camera.updateMatrixWorld(true); tick(.1);
        g.camera.lookAt(g.targetPoint(e)); g.camera.updateMatrixWorld(true); tick(.19);
        yes(!sl.missileLocks.length, '未完了の捕捉は照準を外すと進みを失う');
        tick(.2); yes(sl.missileLocks.length === 1, '照準を戻した後は捕捉時間を数え直す');
      }
      {
        const sl = reset('mlrs'); tick(.78); yes(sl.missileLocks.length === 3, 'MLRSは1体に3重ロックできる');
        yes(g.spotted.B.has(e), 'ロック成立時に味方へ索敵情報を共有');
        const cap = sl.ammo; tick(.01, true); tick(.7);
        yes(sl.ammo === cap - 6 && g.shells.length === 6, '3ロックで6発を射出');
        yes(g.shells.every(sh => sh.missileTarget.target === e), '全ロックを1体へ集中できる');
      }
      {
        const sl = reset('mlrs'); tick(.26); g.camera.lookAt(g.targetPoint(e2)); g.camera.updateMatrixWorld(true); tick(.26);
        yes(new Set(sl.missileLocks.map(x => x.target)).size === 2, 'MLRSは別々の2体を捕捉できる');
        tick(.01, true); tick(.5);
        yes(g.shells.length === 4 && [e, e2].every(q => g.shells.filter(sh => sh.missileTarget?.target === q).length === 2), 'ロックごとに2発ずつ目標を振り分ける');
      }
      {
        const sl = reset(); tick(.01, true); tick(.55);
        yes(g.shells.length === 4 && !sl.bn, '1クリック後に離しても弾倉4発を撃ち切る');
        yes(g.shells.every(sh => !sh.missileTarget), '未捕捉で撃つと全弾が直進する');
        const before = g.shells[0].vel.clone(); tick(.4); g.shellUpdate(.1);
        yes(g.shells[0].vel.angleTo(before) < 1e-7 && !g.shells[0].missileTarget, '発射後に捕捉しても直進弾は誘導されない');
        tick(3, true); const remaining = sl.ammo + sl.reserve; tick(3, true);
        yes(sl.ammo + sl.reserve === remaining, '左を押し続けてもプレイヤーの次の一斉射は自動開始しない');
      }
      {
        const sl = reset('mlrs'); tick(.01, true); tick(.13);
        yes(g.shells.length === 2, 'MLRSの未捕捉発射は1組2発');
        tick(.01); tick(.01, true); yes(g.shells.length === 2, '未捕捉連射には専用の待ち時間がある');
      }
      {
        const sl = reset(); tick(.39); const remove = wall(); tick(.49);
        yes(sl.missileLocks.length === 1, '遮蔽で0.49秒は捕捉を保持'); tick(.02);
        yes(!sl.missileLocks.length, '遮蔽0.5秒超過で捕捉解除'); remove();
        tick(.39); g.selectWeapon(u, 'main'); yes(!sl.missileLocks.length, '持ち替えで未発射の捕捉を解除');
      }
      {
        const sl = reset(); tick(.39); e.pos.z = -110; sync(); tick(1.99);
        yes(sl.missileLocks.length === 1, '距離外でも2秒未満は保持'); tick(.02); yes(!sl.missileLocks.length, '距離外2秒超過で解除');
      }
      for (const state of ['cloak', 'downT']) {
        const sl = reset(); e[state] = state === 'cloak' ? true : 10; tick(1);
        yes(!sl.missileLocks.length, state + 'の敵は新しく捕捉しない');
      }
      for (const state of ['repairing', 'transfer', 'electricT']) {
        const sl = reset(); u[state] = state === 'transfer' ? {} : 1; tick(1, true);
        yes(sl.ammo === sl.w.mag && !g.shells.length, state + '中は発射できない');
      }
      {
        const sl = reset(); tick(.39); u.jamT = 1; tick(.01); yes(!sl.missileLocks.length, '電子妨害で捕捉を失う');
        u.jamT = 0; tick(.39); tick(.01, true); const sh = g.shells[0]; g.selectWeapon(u, 'main'); u.alive = false;
        g.shellUpdate(.1); yes(sh.missileTarget?.target === e, '発射後の持ち替え・発射者大破でも追尾を継続');
      }
      {
        const sl = reset('mlrs'); const sh = launch(sl); sh.distance = 50; e.pos.x = 25; sync();
        const before = sh.vel.clone(); g.missileFlight(sh, .1);
        yes(sh.vel.x > 0 && sh.vel.angleTo(before) <= sl.w.proj.turn * .1 + 1e-6, '旋回角には毎秒の上限があり瞬間的に敵へ向けない');
        yes(sh.vel.length() > sl.w.proj.speed && sh.vel.length() <= sl.w.proj.maxSpeed, 'MLRSは初速から上限速度へ加速する');
        g.spawn(e); g.missileFlight(sh, .1); yes(!sh.missileTarget, '同じ機体が再出撃しても古い弾は追尾を再開しない');
      }
      {
        const sl = reset(), sh = launch(sl); e.pos.z = 10; g.missileFlight(sh, .1);
        yes(!sh.missileTarget && near(sh.vel.x, 0), '追い越した弾はUターンしない');
      }
      {
        const sl = reset(), remove = wall(); launch(sl); g.shellUpdate(.5);
        yes(!g.shells.length && e.hp === 1e6, '壁に衝突して消え、壁越しの敵へ到達しない'); remove();
      }
      {
        const sl = reset('mlrsH'), sh = launch(sl); e2.alive = false;
        for (let i = 0; i < 200 && g.shells.includes(sh); i++) { if (i < 40) e.pos.x += .05; sync(); g.shellUpdate(.01); }
        yes(e.hp < 1e6 && !g.shells.includes(sh), '誘導弾が横移動した敵を追って実ダメージを与える');
      }
      {
        const sl = reset(); g.selectMap('city');
        const c = g.cores.R, hp = c.hp;
        scene.updateMatrixWorld(true);
        const outside = c.pos.clone().add(new T.Vector3(0, 0, 18));
        g.shoot(u, outside, c.pos.clone().sub(outside).normalize().multiplyScalar(sl.w.proj.speed), sl.w.proj);
        for (let i = 0; i < 90; i++) g.shellUpdate(.01);
        yes(c.hp === hp, 'ミサイルはコアの傘に遮られる');
        const from = c.pos.clone().add(new T.Vector3(0, -7, 18)), direction = c.pos.clone().sub(from).normalize().multiplyScalar(sl.w.proj.speed);
        g.shoot(u, from, direction, sl.w.proj); for (let i = 0; i < 90; i++) g.shellUpdate(.01);
        yes(c.hp < hp, '未捕捉のミサイルでも敵コアの結晶へ直撃させれば損傷する');
      }
      {
        const sl = reset(); g.shoot(u, new T.Vector3(0, 200, 0), new T.Vector3(30, 0, 0), sl.w.proj); g.shellUpdate(9);
        yes(!g.shells.length, '射程250mを超えた弾は消える');
      }
      {
        reset(); e.slots.sub = g.slotOf('mlrs'); e.weapon = 'sub'; e.slots.sub.missileLocks = [{ target: u, life: u.lifeId || 0 }];
        g.running = true; g.lockWarning(u, .01);
        yes(!document.getElementById('lockDirections').hidden && !document.getElementById('lockDirections').classList.contains('firing'), '敵のミサイル捕捉は既存の橙警告に出る');
        e.slots.sub.missileLocks = []; e.alive = false;
        const sh = g.shoot(e, new T.Vector3(20, 102.4, 0), new T.Vector3(-30, 0, 0), g.WEAPONS.mlrs.proj);
        sh.missileTarget = { target: u, life: u.lifeId || 0 }; g.lockWarning(u, .01);
        yes(document.getElementById('lockDirections').classList.contains('firing'), '発射者が倒れても飛来する誘導弾は赤警告');
        sh.missileTarget = null; g.lockWarning(u, .01); yes(document.getElementById('lockDirections').hidden, '未捕捉の直進弾は警告しない'); g.running = false;
      }
      {
        reset('mlrs', true); e2.alive = false; u.frozen = false; u.actCd = 0; u.think = 0; u.onGround = true;
        let fired = false;
        for (let i = 0; i < 200; i++) { g.botUpdate(u, .01); sync(); if (g.shells.some(sh => sh.missileTarget?.target === e)) { fired = true; break; } }
        yes(fired, 'Botが実際に持ち替え・捕捉待ち・誘導射撃を実行'); u.frozen = true;
      }
      {
        reset('missile', true); u.lockRange = 20; u.chargerOn = true; e.pos.z = -38;
        yes(g.botAct(u, true, g.cores.R)?.slot !== 'sub', '頭部の捕捉距離外ではBotがミサイルを選ばない');
      }
      clear(); g.renderer.render = originalRender; g.running = false;
      return out;
    });
    assert.deepEqual(errors, []); console.log(checks.map(s => '成功: ' + s).join('\n'));
    fs.writeFileSync(path.join(dir, 'guided-missiles-check.json'), JSON.stringify({ passed: checks.length, catalog: 8, checks, errors }, null, 2) + '\n');
    console.log(`成功: ${checks.length}項目・追加8型の出典照合・実行エラー0`);
    if (process.argv.includes('--screenshots')) {
      const media = path.join(root, 'media/guided-missiles'); fs.mkdirSync(media, { recursive: true });
      await p.reload();
      const fixture = await p.evaluate(() => {
        const g = __g, T = g.T; g.selectMap('city'); document.getElementById('start').click(); g.running = false;
        window.__dt = 1e-9;
        for (const q of g.units) { q.frozen = true; q.alive = false; q.group.visible = false; }
        for (const q of g.turrets) q.alive = false;
        const u = g.player, targets = g.units.filter(q => q.team !== u.team).slice(0, 2);
        g.loadout.heavy.sub = 'mlrs'; g.equip(u, 'heavy');
        Object.assign(u, { alive: true, hp: u.maxHp, invulT: 0, weapon: 'sub', switchT: 0, yaw: 0, pitch: -.035, onGround: true, lockRange: 100 });
        u.pos.set(-63, g.terrainH(-63, 350), 350); u.vel.set(0, 0, 0); u.group.visible = true;
        for (const [i, e] of targets.entries()) {
          Object.assign(e, { alive: true, hp: e.maxHp, invulT: 0, cloak: false });
          e.pos.set(-67 + i * 10, g.terrainH(-67 + i * 10, 315), 315); e.vel.set(0, 0, 0); e.yaw = Math.PI;
          e.group.position.copy(e.pos); e.group.rotation.set(0, e.yaw, 0); e.group.visible = true; g.weaponLook(e, 0);
        }
        let found = false;
        for (let z = 60; z <= 350 && !found; z += 10) for (let x = -120; x <= -30 && !found; x += 10) {
          u.pos.set(x, g.terrainH(x, z), z); u.group.position.copy(u.pos);
          targets.forEach((e, i) => { e.pos.set(x - 3 + i * 6, g.terrainH(x - 3 + i * 6, z - 35), z - 35); e.group.position.copy(e.pos); });
          g.scene.updateMatrixWorld(true);
          found = u.pos.y >= 0 && targets.every(e => e.pos.y >= 0 && Math.abs(e.pos.y - u.pos.y) < 1 && g.canSee(u, e, g.targetPoint(e)));
        }
        if (!found) throw Error('撮影用の見通せる場所が見つからない');
        u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); g.weaponLook(u, 0); g.scene.updateMatrixWorld(true);
        g.updateCamera(u, 1); g.camera.updateMatrixWorld(true);
        for (let i = 0; i < 55; i++) g.weaponsTick(u, .01, false, g.targetPoint(targets[0]), 0);
        g.running = true; g.hud(g.timeLeft, .01); g.renderer.render(g.scene, g.camera);
        return { map: 'city', player: u.pos.toArray(), targets: targets.map(e => e.pos.toArray()), locks: u.slots.sub.missileLocks.length };
      });
      assert.ok(fixture.locks >= 2, '撮影位置から実際に2捕捉以上を成立させる');
      await p.screenshot({ path: path.join(media, 'lock.png') });
      await p.evaluate(() => {
        const g = __g, u = g.player, e = g.units.find(q => q.alive && q.team !== u.team);
        for (let i = 0; i < 40; i++) { g.weaponsTick(u, .01, i === 0, g.targetPoint(e), 0); g.shellUpdate(.01); g.fxUpdate(.01); g.puffUpdate(.01); }
        g.hud(g.timeLeft, .01); g.renderer.render(g.scene, g.camera);
      });
      await p.screenshot({ path: path.join(media, 'flight.png') });
      await p.evaluate(() => {
        const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.alive && q.team !== u.team);
        const from = u.pos.clone().add(new T.Vector3(18, 3, -12));
        const sh = g.shoot(e, from, g.targetPoint(u).sub(from).normalize().multiplyScalar(30), g.WEAPONS.mlrs.proj);
        sh.missileTarget = { target: u, life: u.lifeId || 0 }; g.lockWarning(u, .01); g.renderer.render(g.scene, g.camera);
      });
      await p.screenshot({ path: path.join(media, 'warning.png') });
      await p.evaluate(() => { __g.running = false; document.exitPointerLock(); document.getElementById('overlay').hidden = false; document.querySelector('[data-page="pgCustom"]').click(); });
      await p.waitForFunction(() => !document.pointerLockElement);
      await p.locator('[data-cu="heavy"]').click(); await p.locator('[data-cslot="sub"]').click();
      const series = p.locator('[data-series="gq"]');
      if (await series.getAttribute('aria-expanded') === 'false') await series.click();
      await p.locator('[data-pick="mlrs"]').click(); await p.locator('[data-pick="mlrsH"]').hover();
      await p.screenshot({ path: path.join(media, 'custom.png') });
      fs.writeFileSync(path.join(media, 'capture.json'), JSON.stringify({ ...fixture, description: '画面確認用の固定配置。自然なBOT戦の記録ではない。', errors }, null, 2) + '\n');
      assert.deepEqual(errors, []); console.log('撮影: media/guided-missiles');
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
