// VR-8Hの推進終了・落下・実衝突と、他の弾道が変わらないことをブラウザ本体で確認する。
// make_dbg.pyで現在/比較元を作り、node tools/test/vr8h_ballistics_check.js <現在dbg> <比較元dbg> [結果dir]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
const after = path.resolve(process.argv[2]), before = path.resolve(process.argv[3]);
const out = path.resolve(process.argv[4] || '/tmp/vr8h-ballistics-check');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] }), errors = [];
  async function open(dir) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.stack));
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto(pathToFileURL(path.join(dir, 'dbg.html')).href);
    await page.waitForFunction(() => window.__g);
    return page;
  }
  try {
    const p = await open(after), old = await open(before);
    const catalog = page => page.evaluate(() => JSON.parse(JSON.stringify({ weapons: __g.WEAPONS, armory: __g.ARMORY, parts: __g.PARTS })));
    const current = await catalog(p), baseline = await catalog(old);
    const changed = Object.keys(current.weapons).filter(k => JSON.stringify(current.weapons[k]) !== JSON.stringify(baseline.weapons[k]));
    assert.deepEqual(changed, ['rocketH']); assert.deepEqual(current.armory, baseline.armory); assert.deepEqual(current.parts, baseline.parts);
    const kept = structuredClone(current.weapons.rocketH); kept.desc = baseline.weapons.rocketH.desc;
    delete kept.proj.burnDistance; delete kept.proj.coastGrav;
    assert.deepEqual(kept, baseline.weapons.rocketH);
    // 各投射物を同じ高所から発射し、位置・速度・寿命・姿勢を比較元と照合する。
    async function projectileSnapshots(page) {
      return page.evaluate(() => {
        const g = __g, T = g.T; g.selectMap('dock'); g.setup(); g.running = false;
        for (const u of g.units) { u.alive = false; u.group.visible = false; }
        const u = g.player, rows = {};
        const clear = () => { for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0; };
        g.scene.updateMatrixWorld(true);
        for (const [key, w] of Object.entries(g.WEAPONS)) {
          if (!w.proj || key === 'rocketH') continue;
          clear();
          const sh = g.shoot(u, new T.Vector3(0, 200, 0), new T.Vector3(0, 0, -(w.proj.speed || 45)), w.proj, w.energy, '', w.name);
          rows[key] = [];
          for (let n = 0; n < 30; n++) {
            g.shellUpdate(.05);
            rows[key].push({ active: g.shells.includes(sh), pos: sh.pos.toArray(), vel: sh.vel.toArray(), life: sh.life, quaternion: sh.mesh.quaternion.toArray() });
          }
        }
        clear(); return rows;
      });
    }
    const previous = await projectileSnapshots(old), snapshots = await projectileSnapshots(p);
    assert.deepEqual(snapshots, previous);
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], samples = [], w = g.WEAPONS.rocketH;
      const yes = (v, name) => { if (!v) throw Error(name); checks.push(name); };
      const near = (a, b, tol = 1e-7) => Math.abs(a - b) < tol;
      const clear = () => { for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0; };
      g.selectMap('dock'); g.setup(); g.running = false;
      for (const u of g.units) { u.alive = false; u.group.visible = false; }
      const u = g.player;
      function reset(isPlayer = true, key = 'rocketH') {
        clear(); u.isPlayer = true; Object.assign(u.mech, g.MECH_DEFAULT); g.equip(u, 'heavy'); u.slots.sub = g.slotOf(key);
        Object.assign(u, { isPlayer, alive: true, weapon: 'sub', switchT: 0, stun: '', invulT: 0, repairing: false, transfer: null, electricT: 0, aimMul: 1, recoil: 0, recoilYaw: 0, cameraRecoil: 0, cameraRecoilYaw: 0 });
        u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.yaw = u.pitch = 0; u.group.position.copy(u.pos);
        g.weaponLook(u, 0); g.scene.updateMatrixWorld(true);
      }
      const launch = (from = new T.Vector3(0, 200, 0), dir = new T.Vector3(0, 0, -1)) => g.shoot(u, from, dir.clone().multiplyScalar(w.proj.speed), w.proj, false, '', w.name);
      function advance(seconds, dt) { while (seconds > 1e-9) { const step = Math.min(dt, seconds); g.shellUpdate(step); seconds -= step; } }
      yes(w.model === 'VR-8H' && w.proj.speed === 45, '対象モデルと現行弾速');
      yes(w.proj.burnDistance === 40 && w.proj.coastGrav === 24 && !w.proj.grav, '40m以遠に重力・自動投擲補正なし');
      yes(g.wStats(w).some(s => s.includes('推進 40m')), '機体カスタマイズに推進距離を表示');
      for (const dt of [.05, 1 / 30, 1 / 120]) for (const isPlayer of [true, false]) {
        reset(isPlayer); const sh = launch(); let t = 0;
        for (const distance of [39, 40, 40.1, 60, 80]) {
          const next = distance / 45; advance(next - t, dt); t = next;
          const coast = Math.max(0, (distance - 40) / 45), drop = 12 * coast * coast;
          yes(near(sh.pos.z, -distance) && near(sh.pos.y, 200 - drop) && near(sh.vel.y, -24 * coast), `${dt}/${isPlayer}: ${distance}mの実弾道`);
          const facing = new T.Vector3(0, 1, 0).applyQuaternion(sh.mesh.quaternion);
          yes(facing.angleTo(sh.vel.clone().normalize()) < 1e-7, '弾体は落下を含む進行方向を向く');
          samples.push({ dt, isPlayer, distance, drop: 200 - sh.pos.y, verticalSpeed: sh.vel.y });
        }
      }
      for (const dir of [new T.Vector3(0, .6, -.8), new T.Vector3(.6, 0, -.8), new T.Vector3(0, -.6, -.8), new T.Vector3(0, 1, 0)]) {
        reset(); const start = new T.Vector3(0, 200, 0), sh = launch(start, dir);
        advance(40 / 45, .05); yes(sh.pos.distanceTo(start.clone().addScaledVector(dir, 40)) < 1e-7, '上下・斜めでも飛翔40mまでは直線');
        const poweredPos = sh.pos.clone(); advance(.5, .05);
        yes(sh.pos.distanceTo(poweredPos.addScaledVector(dir, 22.5).add(new T.Vector3(0, -3, 0))) < 1e-7, '上向き・斜めの慣性も維持して落下');
      }
      for (const isPlayer of [true, false]) {
        reset(isPlayer); const from = g.muzzle(u), aim = from.clone().add(new T.Vector3(0, 0, -100)), ammo = u.slots.sub.ammo;
        g.weaponsTick(u, .01, true, aim, 0);
        const sh = g.shells[0];
        yes(g.shells.length === 1 && u.slots.sub.ammo === ammo - 1 && near(sh.vel.y, 0), 'プレイヤー/Botの実発射で弾を1発消費し上向き補正しない');
        yes(sh.weaponName === w.name, '持ち替え前の武器名を保持');
        g.selectWeapon(u, 'main'); u.alive = false; advance(60 / 45, .05);
        yes(near(from.y - sh.pos.y, 12 * (20 / 45) ** 2), '持ち替え・発射者大破でも同じ弾道');
      }
      reset(); const sh = launch();
      let before = g.fx.length; g.shellUpdate(.05);
      yes(g.fx.length > before, '推進中は噴射炎を出す');
      advance(40 / 45 - .05, .05); before = g.fx.length; g.shellUpdate(.05);
      yes(g.fx.length === before && sh.burnLeft < 1e-6, '40mで新しい噴射炎を止める');
      reset(); const expired = launch(); g.shellUpdate(10);
      yes(!g.shells.includes(expired) && near(expired.age, 3) && near(expired.pos.z, -135), '大きい時間刻みでも従来の3秒で消え余分に進まない');
      // 実際の薄い壁に向け、燃焼境界の前後と落下中の衝突を調べる。
      for (const distance of [20, 39.99, 40.01, 60]) {
        reset(); const coast = Math.max(0, (distance - 40) / 45), y = 200 - 12 * coast * coast;
        const mesh = new T.Mesh(new T.BoxGeometry(4, .8, .02), new T.MeshBasicMaterial());
        mesh.position.set(0, y, -distance); g.scene.add(mesh); g.hittables.push(mesh); g.scene.updateMatrixWorld(true);
        try { const sh = launch(); advance((distance + 5) / 45, .05); yes(!g.shells.includes(sh), `${distance}mの厚さ2cmの壁で爆発`); }
        finally { g.hittables.splice(g.hittables.indexOf(mesh), 1); g.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
      }
      // 落下した弾を敵の胴体に当て、元の爆風ダメージを使う。直線上にはない敵へ届く。
      reset(); const e = g.units.find(q => q.team !== u.team), targetDistance = 60;
      Object.assign(e, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, downT: 0, stun: '', weakT: 0, barrierOn: false, partArmor: { head: 1, body: 1, arms: 1, legs: 1 }, armorAvg: 1 });
      e.pos.set(0, 200 - 12 * ((targetDistance - 40) / 45) ** 2 - 2.5, -targetDistance);
      e.group.position.copy(e.pos); e.group.visible = true; e.group.rotation.set(0, 0, 0); g.weaponLook(e, 0); g.scene.updateMatrixWorld(true);
      const hit = launch(); advance(1.7, .05);
      yes(!g.shells.includes(hit) && e.hp < 1e6, '放物線上の敵に実衝突し爆風ダメージ');
      e.alive = false; e.group.visible = false;
      reset(); const terrain = g.terrainH(0, -70), groundShot = launch(new T.Vector3(0, terrain + 3, 0));
      advance(2.5, .05); yes(!g.shells.includes(groundShot), '落下して地面に接触すると爆発');
      clear(); return { checks, samples, weapon: w, damagedEnemy: 1e6 - e.hp };
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ changedWeapons: changed, preservedProjectileTypes: Object.keys(snapshots), ...result, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks.length, changedWeapons: changed, preservedProjectileTypes: Object.keys(snapshots).length, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exit(1); });
