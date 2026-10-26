// LI-5の4型を実射し、時間・損傷・SP・旋回・Bot・比較・保存と既存性能を確認する。
// node tools/test/beam_cannon_variants_check.js dbg/li5 /tmp/li5-check dbg/li5-base
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/li5');
const out = path.resolve(process.argv[3] || '/tmp/li5-check');
const baseDir = process.argv[4] && path.resolve(process.argv[4]);
const specs = [
  { key: 'beamCannon', model: 'LI-5', dps: 7200, contact: 2700, use: 5, kg: 700, charge: 40, keep: 35 },
  { key: 'beamCannonD', model: 'LI-5D', dps: 4800, contact: 1800, use: 7, kg: 750, charge: 30, keep: 25 },
  { key: 'beamCannonG', model: 'LI-5G', dps: 10000, contact: 3750, use: 2.5, kg: 820, charge: 25, keep: 25 },
  { key: 'beamCannonQ', model: 'LI-5Q', dps: 7800, contact: 3000, use: 1.8, kg: 770, charge: 12, keep: 12 },
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**fonts.g*/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    const catalog = () => page.evaluate(() => JSON.parse(JSON.stringify({ weapons: __g.WEAPONS, parts: __g.PARTS, armory: __g.ARMORY, classes: __g.CLASSES })));
    let before;
    if (baseDir) {
      await page.goto('file://' + path.join(baseDir, 'dbg.html'));
      before = await catalog();
    }
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const after = await catalog();
    if (before) {
      assert.deepEqual(Object.keys(after.weapons).filter(key => !before.weapons[key]), specs.slice(1).map(spec => spec.key));
      for (const [key, old] of Object.entries(before.weapons)) {
        const now = { ...after.weapons[key] }, prior = { ...old };
        // シリーズが複数型になると標準型の表示ラベルだけが付く。
        if (key === 'beamCannon') { delete now.label; delete prior.label; }
        assert.deepEqual(now, prior, key + 'の既存定義');
      }
      assert.deepEqual(after.parts, before.parts);
      assert.deepEqual(after.classes, before.classes);
      const armory = structuredClone(after.armory);
      armory.heavy.sp = armory.heavy.sp.filter(key => !specs.slice(1).some(spec => spec.key === key));
      assert.deepEqual(armory, before.armory);
    }
    const result = await page.evaluate(specs => {
      const g = __g, T = g.T, checks = [], rates = [];
      const yes = (value, message) => { if (!value) throw Error(message); checks.push(message); };
      const near = (a, b, epsilon = 1e-5) => Math.abs(a - b) < epsilon;
      g.selectMap('dock'); g.setup(); g.running = false;
      const shooter = g.player, enemy = g.units.find(unit => unit.team !== shooter.team);
      const ally = g.units.find(unit => unit !== shooter && unit.team === shooter.team);
      const aim = new T.Vector3(0, 202.4, -100);
      function reset(spec) {
        for (const unit of g.units) {
          unit.frozen = true; unit.alive = false; unit.pos.set(10000, 200, 10000); unit.group.position.copy(unit.pos);
        }
        g.loadout.heavy.sp = spec.key; Object.assign(shooter.mech, g.MECH_DEFAULT); g.equip(shooter, 'heavy');
        Object.assign(shooter, { alive: true, invulT: 0, switchT: 0, yaw: 0, pitch: 0, stun: '', stunT: 0, electricT: 0, ctrlLockT: 0, repairing: false, transfer: null, zip: null, flying: false, onGround: true, dashT: 0, longDash: false, lungeT: 0, recoverT: 0 });
        shooter.pos.set(0, 200, 0); shooter.vel.set(0, 0, 0); shooter.group.position.copy(shooter.pos); shooter.group.rotation.set(0, 0, 0);
        g.selectWeapon(shooter, 'sp'); shooter.switchT = 0; shooter.slots.sp.supply = 1; g.weaponLook(shooter, .65);
        for (const [unit, z] of [[enemy, -60], [ally, -30]]) {
          Object.assign(unit, { alive: true, invulT: 0, weakT: 0, hp: 1e7, maxHp: 1e7, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 }, stun: '', stunT: 0, repairing: false, barrierOn: false, ctrlLockT: 0, electricT: 0 });
          unit.pos.set(0, 200, z); unit.vel.set(0, 0, 0); unit.group.position.copy(unit.pos); unit.group.rotation.set(0, 0, 0);
        }
        g.scene.updateMatrixWorld(true);
        return shooter.slots.sp;
      }
      function frame(dt = 1 / 60, trigger = true) {
        g.weaponsTick(shooter, dt, trigger, aim, 0); g.weaponLook(shooter, dt); g.fxUpdate(dt);
      }
      for (const spec of specs) {
        const w = g.WEAPONS[spec.key], label = spec.model;
        yes(w.model === label && w.dps === spec.dps && w.contact === spec.contact && w.use === spec.use && w.kg === spec.kg && w.charge === spec.charge && (w.chargeKeep ?? w.charge) === spec.keep, label + 'のAC採用値');
        yes(w.range === 175 && w.warmup === .5 && w.beamRadius === .6 && near(w.turnRate, Math.PI / 36) && w.plant, label + 'の射程・準備・半径・毎秒5度・移動禁止');
        yes(g.ARMORY.heavy.sp.includes(spec.key) && w.series === 'li', label + 'を重火力の同一シリーズに登録');
        const specRates = [];
        for (const hz of [30, 60, 120]) {
          const sl = reset(spec), dt = 1 / hz;
          let frames = 0;
          while (shooter.weapon === 'sp' && frames < (spec.use + 2) * hz) { frame(dt); frames++; }
          yes(shooter.weapon === 'main' && !shooter.beamFire && !shooter.planted && !shooter.beamVisual.root.visible, label + '/' + hz + 'Hzで照射終了と格納');
          yes(near(frames * dt, spec.use + .5, dt + .001) && sl.heat === 0 && sl.overheat, label + '/' + hz + 'Hzで照射秒数とSP使い切り');
          const damage = 1e7 - enemy.hp;
          yes(damage > spec.dps * 2 * (spec.use - .3) + spec.contact * 2 && damage < spec.dps * 2 * spec.use + spec.contact * 2 && ally.hp === 1e7, label + '/' + hz + 'Hzで実射損傷・到達時間・味方貫通');
          specRates.push({ hz, damage, time: frames * dt });
        }
        yes(Math.max(...specRates.map(rate => rate.damage)) - Math.min(...specRates.map(rate => rate.damage)) < 1, label + 'の30/60/120Hz損傷差1未満');
        rates.push({ key: spec.key, rates: specRates });
        reset(spec);
        for (let i = 0; i < 60; i++) frame();
        const hp = enemy.hp;
        for (let i = 0; i < 30; i++) frame();
        yes(near(hp - enemy.hp, spec.dps, .01), label + 'の両肩0.5秒の実損傷');
        const yaw = shooter.yaw, pitch = shooter.pitch;
        shooter.yaw += 1; shooter.pitch += .5; g.beamCannonTurn(shooter, 1 / 60);
        yes(Math.hypot(shooter.yaw - yaw, shooter.pitch - pitch) <= Math.PI / 36 / 60 + 1e-8, label + 'の機体旋回制限');
        const direction = new T.Vector3(0, 1, 0).applyQuaternion(shooter.beamVisual.lanes[0].group.quaternion);
        aim.x = 100; frame(); aim.x = 0;
        const next = new T.Vector3(0, 1, 0).applyQuaternion(shooter.beamVisual.lanes[0].group.quaternion);
        yes(direction.angleTo(next) <= Math.PI / 36 / 60 + 1e-6, label + 'の照射方向の旋回制限');
        g.selectWeapon(shooter, 'main');
        const sl = shooter.slots.sp;
        sl.heat = 40; sl.overheat = false; g.weaponsTick(shooter, spec.keep * .6, false, aim, 0);
        yes(near(sl.heat, 100), label + 'の中断時SP回復');
        sl.heat = 0; sl.overheat = true; g.weaponsTick(shooter, spec.charge, false, aim, 0);
        yes(near(sl.heat, 100) && !sl.overheat, label + 'のOH回復');
        reset(spec); g.equip(enemy, 'heavy'); enemy.slots.sp = g.slotOf(spec.key); enemy.slots.sub = g.slotOf('rocket'); enemy.slots.aux = g.slotOf('weaken');
        Object.assign(enemy, { isPlayer: false, alive: true, target: shooter, onGround: true, stun: '', repairing: false, transfer: null, weapon: 'main', yaw: Math.PI });
        ally.alive = false; g.scene.updateMatrixWorld(true);
        yes(g.botAct(enemy, true, g.cores[shooter.team])?.slot === 'sp', label + 'をBotも選択');
      }
      return { checks, rates };
    }, specs);
    const ui = [];
    for (const spec of specs) {
      await page.reload();
      await page.evaluate(key => {
        document.querySelector('[data-page="pgCustom"]').click();
        document.querySelector('[data-cu="heavy"]').click();
        document.querySelector('[data-cslot="sp"]').click();
        if (!document.querySelector(`[data-pick="${key}"]`)) document.querySelector('#cuSeries [data-series="li"]').click();
      }, spec.key);
      await page.locator(`[data-pick="${spec.key}"]`).hover();
      const comparison = (await page.locator('#cuDiff').innerText()).replace(/,/g, '');
      assert(comparison.includes(String(spec.dps * 2)) && comparison.includes(String(spec.contact * 2)) && comparison.includes(spec.use + '秒'), spec.model + 'の比較表示');
      await page.locator(`[data-pick="${spec.key}"]`).click();
      await page.evaluate(() => __g.loop(performance.now()));
      if (spec.key !== 'beamCannon') await page.screenshot({ path: path.join(out, spec.key + '.png'), fullPage: true });
      await page.reload();
      assert.equal(await page.evaluate(() => __g.loadout.heavy.sp), spec.key, spec.model + 'の保存と再読込');
      ui.push(spec.model);
    }
    assert.deepEqual(errors, []);
    const output = { ...result, ui, existingCatalogCompared: !!before, errors };
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks.length, rates: result.rates, ui, existingCatalogCompared: !!before, errors }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
