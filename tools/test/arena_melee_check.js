// node tools/test/arena_melee_check.js dbg/arena-melee [結果JSON]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; localStorage.setItem('coreBreakerBgm', 'off'); localStorage.setItem('coreBreakerVoice', 'off'); });
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg/arena-melee', 'dbg.html'));
    await p.locator('[data-page="pgMap"]').click();
    await p.locator('[data-map="dock-melee"]').click();
    await p.selectOption('#arenaWeapon', 'pike');
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      const saved = JSON.stringify(g.loadout), select = key => { const el = document.getElementById('arenaWeapon'); el.value = key; el.dispatchEvent(new Event('change')); };
      const swords = Object.keys(g.WEAPONS).filter(key => g.WEAPONS[key].type === 'sword');
      yes(g.mapId === 'dock-melee' && !document.getElementById('arenaWeaponControl').hidden, 'マップ選択から近接限定と専用の武器選択を開ける');
      yes(g.curMap.layout === g.MAPS.dock.layout && g.curMap.terrain === g.MAPS.dock.terrain, '通常アリーナと同じ地形');
      yes(document.getElementById('arenaWeapon').options.length === swords.length && swords.includes('pike') && swords.includes('waveSword'), '杭と光波剣を含む近接武器の全型を選べる');
      document.getElementById('start').click();
      g.renderer.render = () => g.scene.updateMatrixWorld(true);
      yes(g.units.length === 4 && g.units.filter(u => u.team === 'B').length === 2 && g.timeLeft === 300, '2対2・制限時間5分');
      yes(g.player.weapon === 'aux' && g.player.slots.aux.w.key === 'pike' && g.units.every(u => u.slots.aux.w.type === 'sword'), '全員が近接武器を構えて出撃');
      for (const u of g.units) u.frozen = true;
      const u = g.player, enemy = g.units.find(e => e.team !== u.team), aim = new T.Vector3(0, 102.3, -12);
      for (const key of swords) {
        select(key);
        for (const cls of ['assault', 'heavy', 'raid', 'support']) {
          g.equip(u, cls);
          yes(u.slots.aux.w.key === key && u.weapon === 'aux' && Object.keys(u.slots).length === 4, key + '/' + cls + '：4枠を維持して選んだ近接武器を使用');
          yes(u.stats.payload === g.mechStats(u.mech, { aux: key }).payload, key + '/' + cls + '：使用しない装備の重量を加えない');
        }
      }
      select('sword'); g.equip(u, 'assault');
      for (const slot of ['main', 'sub', 'sp']) { g.selectWeapon(u, slot); yes(u.weapon === 'aux', slot + 'への持ち替えを禁止'); }
      yes(!g.toggleSp(u) && !u.chargerOn, '加速装置などの特別装備を禁止');
      for (const cls of ['assault', 'heavy', 'raid', 'support']) {
        g.equip(u, cls); yes(!g.canRevive(u), cls + '：使用不可の修理装備で蘇生を待たせない');
        for (const slot of ['main', 'sub', 'sp']) {
          u.weapon = slot;
          const sl = u.slots[slot], before = [sl.ammo, sl.heat, g.shells.length, g.gadgets.length, enemy.hp];
          g.weaponsTick(u, .1, true, aim, 0, true);
          yes(JSON.stringify(before) === JSON.stringify([sl.ammo, sl.heat, g.shells.length, g.gadgets.length, enemy.hp]), cls + '/' + slot + '：射撃・設置・SPを作動させない');
        }
      }
      function arena(key, range) {
        select(key); g.equip(u, 'assault'); g.spawn(enemy); enemy.hp = enemy.maxHp = 10000;
        for (const e of g.units) { e.pos.set(200, 100, 200); e.group.position.copy(e.pos); }
        u.pos.set(0, 100, 0); enemy.pos.set(0, 100, -range);
        for (const e of [u, enemy]) { e.alive = true; e.invulT = e.weakT = 0; e.armorAvg = 1; e.partArmor = { head: 1, body: 1, arms: 1, legs: 1 }; e.yaw = e.pitch = 0; e.group.position.copy(e.pos); e.group.rotation.set(0, 0, 0); g.weaponLook(e, 0); }
        g.scene.updateMatrixWorld(true);
      }
      arena('sword', 3); g.weaponsTick(u, .01, true, aim, 0);
      const sw = u.swing; g.bladeSweep(u, sw, sw.yaw0 + sw.a.from * Math.PI / 180, sw.yaw0 + sw.a.to * Math.PI / 180);
      yes(enemy.hp < enemy.maxHp, '通常斬撃で実ダメージ');
      arena('waveSword', 12); const waveSlot = u.slots.aux; waveSlot.chargeT = waveSlot.w.chargeTime;
      g.weaponsTick(u, .01, false, aim, 0); const waveSwing = u.swing;
      g.weaponsTick(u, waveSwing.a.windup + waveSwing.a.sweep * .5 + .01, false, aim, 0);
      yes(g.shells.some(sh => sh.spec.bladeWave), '近接限定でもチャージ光波を発射');
      g.shellUpdate(.2); yes(enemy.hp === 8000, '光波は通常どおり2000ダメージ');
      g.hud(300, .016);
      for (const slot of ['main', 'sub', 'sp']) yes(document.getElementById('w-' + slot).getAttribute('aria-disabled') === 'true', slot + 'をHUDで使用不可と表示');
      yes(document.getElementById('aimSp').hidden, '使用しない中央SPゲージを隠す');
      for (const winner of ['B', 'R']) {
        g.setup(); for (const e of g.units) e.frozen = true; g.running = true;
        const attackers = g.units.filter(e => e.team === winner), victims = g.units.filter(e => e.team !== winner);
        for (let n = 1; n <= 10; n++) {
          const v = victims[(n - 1) % 2]; if (!v.alive) g.spawn(v); g.kill(v, attackers[(n - 1) % 2], false); g.loop(performance.now());
          yes(g.ended === (n === 10), winner + '：' + n + '機目は' + (n === 10 ? '決着' : '続行'));
        }
      }
      yes(JSON.stringify(g.loadout) === saved, '通常ルールの保存装備を変更しない');
      g.selectMap('dock'); g.setup(); const normal = g.player; g.equip(normal, 'assault');
      yes(normal.weapon === 'main' && document.getElementById('arenaWeaponControl').hidden && g.toggleSp(normal), '通常2対2へ戻すと主武器とSPを使える');
      g.selectMap('dock-melee'); g.setup(); g.player.isPlayer = false; g.spawn(g.player);
      g.running = true; document.getElementById('overlay').hidden = true;
      const swings = new Set(), ammo = new Map(), violations = new Set(); let minDistance = Infinity, damaged = false;
      for (let frame = 0; frame < 3000 && !g.ended; frame++) {
        g.loop(performance.now());
        for (const e of g.units) {
          if (e.alive && e.weapon !== 'aux') violations.add('近接以外を構えた');
          if (e.swing) swings.add(e.swing);
          if (e.alive && e.hp < e.maxHp) damaged = true;
          if (e.slots.sp.heat < 100 || e.chargerOn || e.cloak || e.fieldOn || e.escortOn || e.barrierOn) violations.add('SPを作動させた');
          for (const k of ['main', 'sub']) { const sl = e.slots[k], n = sl.ammo + sl.reserve; if (ammo.has(sl) && ammo.get(sl) !== n) violations.add('射撃の弾を消費した'); ammo.set(sl, n); }
          if (e.alive) for (const other of g.units) if (other.alive && other.team !== e.team) minDistance = Math.min(minDistance, e.pos.distanceTo(other.pos));
        }
        if (g.gadgets.length || g.barrages.length || g.shells.some(sh => !sh.spec.bladeWave)) violations.add('禁止した弾・設置物を作った');
      }
      yes(!violations.size, '実際のBot戦で銃・設置武器・SPを使用しない：' + [...violations].join('、'));
      yes(minDistance < 8 && swings.size > 0 && damaged, 'Botが実際に間合いを詰めて近接攻撃を命中させる');
      const battle = { seconds: Math.round(300 - g.timeLeft), ended: g.ended, swings: swings.size, minDistance, kills: g.units.reduce((n,e) => n + e.sc.kills, 0), violations: [...violations] };
      g.player.isPlayer = true; g.setup(); g.hud(300, .016);
      return { passed: checks.length, weapons: swords.length, battle, checks };
    });
    for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
      await p.evaluate(mode => { document.querySelector(`[data-console-choice="${mode}"]`).click(); __g.hud(300, .016); }, mode);
      assert.equal(await p.locator('#w-main').getAttribute('aria-disabled'), 'true');
    }
    assert.deepEqual(errors, []);
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ ...result, errors }, null, 2) + '\n');
    console.log(`近接限定：${result.passed}項目・${result.weapons}武器・4コンソール、ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
