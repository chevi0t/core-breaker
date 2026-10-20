// 光波剣：入力・威力・遮蔽・充填解除・Botを実際の武器処理で確かめる。
// python3 tools/test/make_dbg.py dbg/wave-sword && node tools/test/wave_sword_check.js dbg/wave-sword
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg/wave-sword', 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g;
      g.renderer.render = sc => sc.updateMatrixWorld(true);
      g.selectMap('dock'); document.getElementById('start').click(); g.running = false;
      // selectMap/setup は機体を作り直すので、開始後の参照を使う。
      return !!g.player;
    });
    if (!result) throw new Error('出撃できない');
    const r = await p.evaluate(() => {
      const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), passed = [];
      const check = (ok, msg) => { if (!ok) throw new Error(msg); passed.push(msg); };
      const near = (a, b) => Math.abs(a - b) < 1e-5;
      const scene = u.group.parent, originalHits = g.hittables.slice(), extras = [];
      const world = () => { for (const q of [u, e]) { q.group.position.copy(q.pos); q.group.rotation.set(0, q.yaw, 0); g.weaponLook(q, 0); q.group.updateMatrixWorld(true); } };
      const reset = (dist = 25) => {
        for (const s of g.shells) scene.remove(s.mesh); g.shells.length = 0;
        for (const m of extras) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } extras.length = 0;
        g.hittables.splice(0, g.hittables.length, ...originalHits);
        for (const q of g.units) { q.frozen = true; q.barrierOn = false; if (q !== u && q !== e) { q.alive = false; q.group.visible = false; } }
        for (const t of g.turrets) t.alive = false;
        u.isPlayer = true; g.loadout.assault.aux = 'waveSword'; g.equip(u, 'assault'); g.selectWeapon(u, 'aux');
        for (const q of [u, e]) {
          Object.assign(q, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, weakT: 0, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 },
            switchT: 0, stun: '', stunT: 0, electricT: 0, repairing: false, ctrlLockT: 0, transfer: null, swing: null, lungeT: 0, dashT: 0,
            recoverT: 0, slideT: 0, longDash: false, yaw: q === u ? 0 : Math.PI, pitch: 0, onGround: true, target: null, planted: false });
          q.vel.set(0, 0, 0); q.group.visible = true;
        }
        u.waveFired = 0; u.pos.set(0, 200, 0); e.pos.set(0, 200, -dist); g.lock.target = null; world();
      };
      const aim = height => new T.Vector3(0, 200 + (height ?? 2.6), -300);
      const tick = (dt, trigger, at = aim()) => { g.weaponsTick(u, dt, trigger, at, 0); world(); };
      const hold = seconds => { for (let t = 0; t < seconds - 1e-6; t += .02) tick(.02, true); };
      const finish = () => { for (let i = 0; i < 120; i++) tick(.02, false); };
      const wave = (from = new T.Vector3(0, 202.6, 0), dir = new T.Vector3(0, 0, -1)) => g.shoot(u, from, dir.multiplyScalar(70), g.WEAPONS.waveSword.chargeWave);
      const fly = () => { for (let i = 0; i < 60; i++) g.shellUpdate(.02); };
      const obstacle = (x, z, width = 6, kind = null) => {
        const m = new T.Mesh(new T.BoxGeometry(width, 10, .2), new T.MeshBasicMaterial());
        m.position.set(x, 202.6, z); if (kind) m.userData.ref = { kind, team: e.team, hp: 10000 };
        scene.add(m); m.updateMatrixWorld(true); g.hittables.push(m); extras.push(m); return m;
      };
      reset();
      const w = g.WEAPONS.waveSword, sword = g.WEAPONS.sword;
      check(near(w.normal.dmg, sword.normal.dmg * .7) && near(w.strong.dmg, sword.strong.dmg * .7) && w.chargeWave.dmg === 2000, '指定威力：通常4200・強打7000・光波2000');
      check(w.model === 'LJ-6' && w.maker === 'lumina' && w.series === 'lj' && g.ARMORY.assault.aux.includes('waveSword'), '独立したシリーズ・型番で強襲補助に登録');
      hold(4); check(!u.swing && !g.shells.length && near(u.slots.aux.chargeT, 1.2), '満充填を保持中は振らず、過熱しない');
      tick(.02, false); tick(.08, false); check(!g.shells.length, '光波は離した瞬間より後、振りの途中で発生');
      finish(); check(u.waveFired === 1 && g.shells.length === 1, '通常の満充填斬りは光波1発だけ');
      reset(); hold(1.2); u.dashT = .2; tick(.02, false, aim(2)); finish();
      check(u.waveFired === 1 && g.shells.length === 1, 'ダッシュ回転斬りも光波1発だけ');
      for (const strong of [false, true]) {
        reset(3.5); hold(.1); u.dashT = strong ? .2 : 0; tick(.02, false, aim(strong ? 2 : 2.6)); finish();
        check(near(1e6 - e.hp, strong ? 7000 : 4200) && !u.waveFired, (strong ? '短押しの強打7000' : '短押しの通常斬り4200') + '、光波なし');
        reset(3.5); hold(1.2); u.dashT = strong ? .2 : 0; tick(.02, false, aim(strong ? 2 : 2.6)); finish(); fly();
        check(near(1e6 - e.hp, strong ? 9000 : 6200) && u.waveFired === 1, '近距離の満充填' + (strong ? '強打は7000＋2000' : '通常斬りは4200＋2000'));
      }
      reset(); hold(1.2); tick(.02, false); finish();
      const before = e.hp; g.shellUpdate(.1); check(e.hp === before, '光波は弾速に従って飛び、即着弾しない'); fly();
      check(near(before - e.hp, 2000) && !g.shells.length, '遠距離の直撃2000、命中で消える');
      reset(); e.partArmor = { head: .5, body: .5, arms: .5, legs: .5 }; wave(); fly();
      check(near(1e6 - e.hp, 1000), '光波に部位装甲が効く');
      reset(); wave(new T.Vector3(0, 203.7, 0)); fly();
      check(near(1e6 - e.hp, 2000), '頭に当たっても追加倍率なし');
      reset(); e.pos.x = 2.1; world(); wave(); fly(); check(near(1e6 - e.hp, 2000), '中心線を外しても光波の幅内なら命中');
      reset(); e.pos.x = 5; world(); wave(); fly(); check(e.hp === 1e6, '光波の幅外には命中しない');
      for (const kind of [null, 'umbrella', 'core']) {
        reset(); const m = obstacle(0, -10, 6, kind); wave(); fly();
        check(e.hp === 1e6 && !g.shells.length && (!kind || m.userData.ref.hp === 10000), (kind || '壁') + 'で止まり、背後へ通らない');
      }
      reset(); obstacle(0, -.15); wave(); fly(); check(e.hp === 1e6 && !g.shells.length, '壁に密着しても裏へ撃てない');
      reset(); obstacle(.6, 0, .3); wave(); fly(); check(e.hp === 1e6 && !g.shells.length, '出現位置の横の壁を幅だけ通り抜けない');
      reset(); e.team = u.team; wave(); fly(); check(e.hp === 1e6 && !g.shells.length, '味方は無傷で光波を遮る'); e.team = u.team === 'B' ? 'R' : 'B';
      reset(); const barrierKey = Object.keys(g.WEAPONS).find(k => g.WEAPONS[k].type === 'barrier');
      e.slots.sp = g.slotOf(barrierKey); e.slots.sp.heat = 100; e.barrierOn = true; wave(); fly();
      check(e.hp === 1e6 && e.slots.sp.heat < 100 && !g.shells.length, 'バリアはSPを消費して光波を防ぐ');
      reset(70); wave(); const shell = g.shells[0]; g.shellUpdate(2);
      check(near(shell.pos.z, -60) && !g.shells.length && e.hp === 1e6, '大きな時間刻みでも射程60mで消える');
      reset(); e.pos.set(100, 200, 100); world();
      const ground = new T.Vector3(-40, g.terrainH(-40, 60) + 3, 60); wave(ground, new T.Vector3(0, -1, 0)); fly();
      check(!g.shells.length, '地面への着弾で消える');
      for (const cancel of ['持ち替え', 'ポッド', 'よろけ', '電撃', 'エリア移動', '撃破']) {
        reset(); hold(.8);
        if (cancel === '持ち替え') g.selectWeapon(u, 'main');
        if (cancel === 'ポッド') u.repairing = true;
        if (cancel === 'よろけ') u.stun = 'stagger';
        if (cancel === '電撃') u.electricT = 1;
        if (cancel === 'エリア移動') u.transfer = { t: 2 };
        if (cancel === '撃破') g.kill(u, e, false, 100);
        tick(.02, false); check(!u.slots.aux.chargeT && !u.swing && !u.waveFired, cancel + 'で充填を取り消す');
      }
      reset(); hold(1.2); tick(.02, false); u.stun = 'stagger'; finish();
      check(!u.waveFired && !g.shells.length, '振り始めてから発生前に中断されても光波を出さない');
      reset(); hold(1.2); tick(.02, false); u.yaw = Math.PI / 2;
      for (let i = 0; i < 30; i++) tick(.02, false, new T.Vector3(300, 202.6, 0));
      check(u.waveFired === 1 && g.shells[0].vel.z < -69 && Math.abs(g.shells[0].vel.x) < .001, '離した時の照準方向へ直進し、振り途中の照準に誘導されない');
      reset(); u.isPlayer = false; u.frozen = false; u.walkV = u.dashV = u.cruiseV = 0;
      Object.assign(u, { think: 100, actCd: 100, act: null, dodgeT: 100, target: e, aimTarget: e, reacq: 0, botRkT: 100 });
      u.aimPos.copy(e.pos).y += 2.4; u.aimPrev.copy(u.aimPos);
      for (let i = 0; i < 500; i++) {
        u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.onGround = true;
        g.botUpdate(u, .02); world(); g.shellUpdate(.02);
      }
      check(u.waveFired >= 2 && e.hp < 1e6, 'Botも中距離で充填・解放して光波を繰り返し当てる');
      reset(); wave(); const mesh = g.shells[0].mesh; g.selectMap('city');
      check(!g.shells.length && !mesh.parent, 'マップ切替で飛翔中の光波を破棄');
      return { passed: passed.length, checks: passed };
    });
    // mouseDownの書き換えではなく、実際のマウス押下・解放を通す。
    await p.evaluate(() => {
      const g = __g; document.getElementById('start').click(); g.running = false;
      const u = g.player;
      for (const q of g.units) { q.frozen = true; if (q !== u) q.alive = false; }
      g.equip(u, 'assault'); g.selectWeapon(u, 'aux');
      Object.assign(u, { alive: true, invulT: 100, switchT: 0, stun: '', repairing: false, electricT: 0, transfer: null, swing: null, waveFired: 0, yaw: 0, pitch: 0 });
      u.pos.set(-50, g.terrainH(-50, -48), -48); u.vel.set(0, 0, 0); window.__dt = .05;
      document.getElementById('overlay').hidden = true; g.running = true; document.exitPointerLock();
    });
    await p.waitForFunction(() => !document.pointerLockElement);
    await p.mouse.move(400, 300); await p.mouse.click(400, 300, { button: 'right' });
    await p.waitForFunction(() => !!document.pointerLockElement);
    await p.mouse.down();
    await p.waitForFunction(() => __g.player.slots.aux.chargeT >= 1.2);
    const full = await p.evaluate(() => ({ swing: !!__g.player.swing, hud: document.getElementById('ammo').textContent, text: document.getElementById('ammoSub').textContent }));
    if (full.swing || full.hud !== '100%' || !full.text.includes('準備完了')) throw new Error('マウス長押し/HUDの満充填が不一致: ' + JSON.stringify(full));
    await p.mouse.up(); await p.waitForFunction(() => __g.player.waveFired === 1);
    await p.evaluate(() => { __g.running = false; });
    r.checks.push('実マウスの長押しでHUD100%、離すと光波を発射'); r.passed++;
    console.log(JSON.stringify(r, null, 1));
    if (errors.length) throw new Error('ブラウザエラー: ' + errors.join('\n'));
    console.log('光波剣：成功。ブラウザエラーなし');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
