// node tools/test/killcam_weapon_check.js dbg/killcam-weapon [結果・画像の出力先]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/killcam-weapon');
const out = path.resolve(process.argv[3] || path.join(dir, 'results'));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; localStorage.setItem('coreBreakerBgm', 'off'); localStorage.setItem('coreBreakerVoice', 'off'); });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      g.selectMap('city'); document.getElementById('start').click();
      const victim = g.player, enemy = g.units.find(u => u.team !== victim.team);
      const vec = (x, y, z) => new T.Vector3(x, y, z), aim = () => victim.pos.clone().add(vec(0, 2.3, 0));
      function reset() {
        for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0;
        for (const item of g.gadgets.slice()) g.removeGadget(item);
        g.clearArtillery(); g.clearSecondaryEffects();
        g.spawn(victim); g.spawn(enemy); g.equip(enemy, 'assault');
        for (const u of g.units) { u.frozen = true; u.pos.set(200, 100, 200); u.group.position.copy(u.pos); }
        victim.pos.set(0, 100, -12); enemy.pos.set(0, 100, 0);
        for (const u of [victim, enemy]) { u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); u.yaw = u.pitch = 0; u.invulT = 0; u.weakT = 0; u.armorAvg = 1; u.partArmor = { head: 1, body: 1, arms: 1, legs: 1 }; g.weaponLook(u, 0); }
        victim.hp = 1; g.scene.updateMatrixWorld(true); g.running = true;
      }
      function show(expected, label) {
        yes(!victim.alive && victim.deathWeapon === expected, label + '：致死の武器を記録');
        if (victim.downT > 0) g.wreck(victim);
        g.hud(g.timeLeft, .016);
        yes(!document.getElementById('killcam').hidden && document.getElementById('killcamWeapon').textContent === '撃破武器：' + expected, label + '：相手名と一緒に武器名を表示');
      }
      function launch(key) {
        const sl = g.slotOf(key); g.shot(enemy, sl, aim(), 0); return g.shells.at(-1);
      }
      reset(); const rifle = g.WEAPONS.ar;
      g.fire(enemy, aim(), 0, rifle, enemy.pos.clone().add(vec(0, 2.3, 0)));
      const recorded = victim.deathWeapon; g.equip(enemy, 'raid');
      show(rifle.name, '即着弾の主武器');
      yes(recorded === rifle.name, '敵の持ち替え後も致死時の武器を維持');
      reset(); const variant = Object.values(g.WEAPONS).find(w => w.name !== rifle.name && w.series === rifle.series);
      g.fire(enemy, aim(), 0, variant, enemy.pos.clone().add(vec(0, 2.3, 0))); show(variant.name, '主武器の型名');
      reset(); const rocket = launch('rocket');
      yes(rocket.weaponName === g.WEAPONS.rocket.name && rocket.spec === g.WEAPONS.rocket.proj, '発射済みロケットに名前を固定し、弾道設定の参照は維持');
      g.equip(enemy, 'raid'); g.shellUpdate(.2); show(g.WEAPONS.rocket.name, '持ち替え後に着弾するロケット');
      reset(); const delayed = launch('rocket'); g.spawn(enemy); g.blast(delayed, aim(), null); show(g.WEAPONS.rocket.name, '発射者の再出撃後の爆風');
      reset(); const guided = Object.values(g.WEAPONS).find(w => w.proj?.guided);
      const missile = launch(guided.key); g.equip(enemy, 'support'); g.blast(missile, aim(), null); show(guided.name, '誘導ミサイル');
      reset(); const mineShot = launch('mine'); g.placeGadget(mineShot, victim.pos.clone(), null);
      const mine = g.gadgets.at(-1); mine.pos.copy(victim.pos); mine.mesh.position.copy(mine.pos); mine.armT = 0; mine.age = 5; g.equip(enemy, 'raid'); g.gadgetUpdate(.02); show(g.WEAPONS.mine.name, '設置後に持ち替えた地雷');
      reset(); const remoteShot = launch('remote'); g.placeGadget(remoteShot, victim.pos.clone(), null);
      g.gadgets.at(-1).armT = 0; g.spawn(enemy); g.detonateRemotes(enemy); show(g.WEAPONS.remote.name, '設置者の再出撃後の遠隔爆弾');
      reset(); const sentryShot = launch('sentry'); g.placeGadget(sentryShot, enemy.pos.clone(), null);
      const sentry = g.gadgets.at(-1); sentry.pos.copy(enemy.pos); sentry.mesh.position.copy(sentry.pos).y += 1.04; sentry.armT = 0; g.equip(enemy, 'heavy'); g.sentryTick(sentry, .02); show(g.WEAPONS.sentry.name, '自動砲台の射撃');
      reset(); const heatWeapon = Object.values(g.WEAPONS).find(w => w.proj?.heatDps);
      const heatShot = launch(heatWeapon.key); g.secondaryBurst(heatShot, aim(), null); g.equip(enemy, 'raid'); g.secondaryUpdate(.02); show(heatWeapon.name, '残留する熱球');
      reset(); const chainWeapon = Object.values(g.WEAPONS).find(w => w.proj?.chainCount), chainShot = launch(chainWeapon.key);
      g.startChain(chainShot, aim()); g.equip(enemy, 'support'); g.blast(g.chains[0], aim(), null); show(chainWeapon.name, '連鎖ボム');
      reset(); enemy.weapon = 'aux'; const sword = g.slotOf('sword'); enemy.slots.aux = sword;
      victim.pos.set(0, 100, -3); victim.group.position.copy(victim.pos); g.scene.updateMatrixWorld(true);
      g.swordTick(enemy, sword, .01, true, aim()); const swing = enemy.swing;
      g.bladeSweep(enemy, swing, swing.yaw0 + swing.a.from * Math.PI / 180, swing.yaw0 + swing.a.to * Math.PI / 180); show(sword.w.name, '近接斬撃');
      reset(); const waveWeapon = Object.values(g.WEAPONS).find(w => w.chargeWave), waveSlot = g.slotOf(waveWeapon.key);
      enemy.weapon = 'aux'; enemy.slots.aux = waveSlot; waveSlot.chargeT = waveWeapon.chargeTime;
      g.swordTick(enemy, waveSlot, .01, false, aim()); const chargedSwing = enemy.swing;
      g.swordTick(enemy, waveSlot, chargedSwing.a.windup + chargedSwing.a.sweep * .5 + .01, false, aim());
      const wave = g.shells.find(sh => sh.spec.bladeWave); yes(wave?.weaponName === waveWeapon.name, '光波にも振り始めた剣の名前を引き継ぐ');
      g.shellUpdate(.2); show(waveWeapon.name, '剣から発射した光波');
      reset(); g.equip(enemy, 'heavy'); enemy.weapon = 'sp'; const cannon = g.slotOf('cannon'); enemy.slots.sp = cannon;
      g.cannonTick(enemy, cannon, .02, true, aim(), true, false); const cannonShot = g.shells.at(-1);
      g.equip(enemy, 'raid'); g.blast(cannonShot, aim(), null); show(cannon.w.name, '重砲');
      reset(); const artillery = g.slotOf('artillery'); enemy.slots.sp = artillery; enemy.weapon = 'sp'; enemy.bombard = victim.pos.clone();
      g.artilleryTick(enemy, artillery, .02, false, aim(), true, false); const barrage = g.barrages[0];
      yes(barrage?.weaponName === artillery.w.name, '榴弾砲は爆撃指示時の武器名を記録');
      g.equip(enemy, 'raid'); g.blast(barrage, aim(), null); show(artillery.w.name, '遅れて着弾する榴弾砲');
      reset(); const turret = g.turrets.find(t => t.team !== victim.team);
      const turretShot = g.shoot(turret, aim(), vec(0, 0, -1)); g.blast(turretShot, aim(), null); show('防衛砲台', '固定防衛砲台');
      yes(getComputedStyle(document.getElementById('killerFace')).display === 'none', '固定防衛砲台にはパイロット顔を付けない');
      reset(); const safe = { ...rifle, name: '<img src=x onerror=alert(1)>' };
      g.fire(enemy, aim(), 0, safe, enemy.pos.clone().add(vec(0, 2.3, 0))); show(safe.name, '武器名は文字として表示');
      yes(!document.querySelector('#killcamWeapon img'), '武器名のHTMLを実行しない');
      g.spawn(victim); g.hud(g.timeLeft, .016); yes(victim.deathWeapon === null && document.getElementById('killcam').hidden, '再出撃で前の死因を消す');
      reset(); g.fire(enemy, aim(), 0, rifle, enemy.pos.clone().add(vec(0, 2.3, 0)));
      yes(victim.downT > 0 && victim.deathWeapon === rifle.name, '行動不能になった時点で武器を保持');
      g.revive(victim, enemy); yes(victim.deathWeapon === null && victim.alive, '蘇生時にも前の死因を消す');
      reset(); g.kill(victim, victim, false, Infinity, g.WEAPONS.rocket.name); g.hud(g.timeLeft, .016);
      yes(document.getElementById('killcam').hidden, '自爆時のカメラの規則は維持');
      reset(); g.fire(enemy, aim(), 0, rifle, enemy.pos.clone().add(vec(0, 2.3, 0))); show(rifle.name, '表示見本');
      return { passed: checks.length, checks };
    });
    for (const [width, height] of [[640, 480], [1280, 720]]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(350); // 再出撃パネルの位置の遷移（0.3秒）を待つ。
      const layout = await p.evaluate(() => { const el = document.getElementById('killcamWeapon'), r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
      await p.screenshot({ path: path.join(out, `killcam-weapon-${width}.png`) });
      assert.ok(layout.x >= 0 && layout.y >= 0 && layout.right <= width && layout.bottom <= height, '撃破武器が画面内に収まる：' + JSON.stringify({ width, height, layout }));
    }
    await p.screenshot({ path: path.join(out, 'killcam-weapon.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ ...result, errors }, null, 2) + '\n');
    console.log(`撃破武器：${result.passed}項目、2画面幅、ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
