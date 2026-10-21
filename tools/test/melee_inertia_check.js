// node tools/test/melee_inertia_check.js dbg/melee-inertia [dbg/変更前] [結果JSON]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }), errors = [];
  async function open(folder) {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; localStorage.setItem('coreBreakerBgm', 'off'); localStorage.setItem('coreBreakerVoice', 'off'); });
    await p.goto('file://' + path.resolve(folder, 'dbg.html')); return p;
  }
  try {
    const p = await open(process.argv[2] || 'dbg/melee-inertia');
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], samples = [], yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      g.selectMap('dock-melee'); g.setup();
      const u = g.player, forward = new T.Vector3(0, 0, -1), stop = new T.Vector3(), aim = new T.Vector3(0, 102.6, -80);
      for (const e of g.units) { e.frozen = true; e.pos.set(10000, 100, 10000); e.group.position.copy(e.pos); }
      const swords = Object.keys(g.WEAPONS).filter(key => g.WEAPONS[key].type === 'sword');
      function reset(part = 'light', key = 'sword') {
        for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0; g.fxUpdate(10);
        u.isPlayer = true;
        const el = document.getElementById('arenaWeapon'); el.value = key; el.dispatchEvent(new Event('change'));
        Object.assign(u.mech, { head: part, body: part, arms: part, legs: part }); g.equip(u, 'assault');
        Object.assign(u, { alive: true, hp: u.maxHp, invulT: 0, yaw: 0, pitch: 0, dashT: 0, longDash: false, dashState: '',
          slideT: 0, recoverT: 0, lungeT: 0, stun: '', stunT: 0, ctrlLockT: 0, electricT: 0, flying: false, zip: null,
          onGround: true, target: null, repairing: false, transfer: null, planted: false, chargerOn: false,
          overheat: false, boost: u.maxBoost, boostIdle: 0, jumpBuf: 0, catCd: 0 });
        u.pos.set(0, 100, 40); u.vel.set(0, 0, 0); g.lock.target = null;
      }
      function attack(mode = 'short', direction = forward) {
        if (mode === 'short') yes(g.shortDash(u, direction), 'ショートダッシュを受理');
        else { u.longDash = true; u.vel.copy(direction).multiplyScalar(u.cruiseV); }
        const sl = u.slots.aux, w = sl.w;
        if (w.chargeWave || w.meleeCharge) sl.chargeT = w.chargeTime;
        const before = u.vel.clone();
        g.swordTick(u, sl, 1 / 60, !(w.chargeWave || w.meleeCharge), aim);
        yes(!!u.swing && u.lungeT > 0 && !u.dashT && !u.longDash, w.key + '/' + mode + '：実際にダッシュ近接へ移行');
        yes(u.vel.distanceTo(before) < 1e-9, w.key + '/' + mode + '：開始時の速度と方向を保つ');
        return before;
      }
      function frame(dt) { g.physics(u, stop, false, false, dt); g.swordTick(u, u.slots.aux, dt, false, aim); g.shellUpdate(dt); g.fxUpdate(dt); }
      for (const part of ['light', 'standard', 'heavy']) for (const key of swords) for (const mode of ['short', 'long']) {
        reset(part, key); const before = attack(mode), a = u.swing.a;
        const bound = Math.max(before.length(), u.lungeSpeed * 1.35), boost = u.boost;
        let peak = before.length(), minSpeed = Infinity;
        for (let i = 0; i < Math.ceil((a.windup + a.sweep) * 60); i++) {
          frame(1 / 60); const speed = Math.hypot(u.vel.x, u.vel.z); peak = Math.max(peak, speed); minSpeed = Math.min(minSpeed, speed);
        }
        yes(peak <= bound + 1e-6 && u.boost >= boost, part + '/' + key + '/' + mode + '：速度を加算せず、踏み込みでブーストを使わない');
        if (key === 'sword') samples.push({ part, mode, entry: before.length(), peak, end: Math.hypot(u.vel.x, u.vel.z), distance: 40 - u.pos.z });
      }
      reset(); const before = attack();
      for (let i = 0; i < 9; i++) frame(1 / 60);
      yes(Math.hypot(u.vel.x, u.vel.z) > before.length() * .72, '軽量機は攻撃開始0.15秒後も勢いを保ち、武器の固定速度へ急減速しない');
      for (let i = 0; i < 160; i++) frame(1 / 60);
      yes(Math.hypot(u.vel.x, u.vel.z) < 1 && !u.swing && u.recoverT <= 0, '振り終わったあとは滑りながら減速し、硬直が解ける');
      reset(); u.isPlayer = false; attack();
      for (let i = 0; i < 9; i++) frame(1 / 60);
      yes(Math.hypot(u.vel.x, u.vel.z) > before.length() * .72, 'Botも同じ慣性を使う');
      reset(); const side = new T.Vector3(1, 0, 0), sideBefore = attack('short', side); frame(1 / 60);
      yes(u.vel.x > sideBefore.x * .8 && u.vel.z < 0, '横ダッシュの勢いを残しながら、斬る方向へ滑らかに曲がる');
      reset(); g.shortDash(u, forward); u.yaw = Math.PI; const reverse = u.vel.clone();
      g.swordTick(u, u.slots.aux, 1 / 60, true, aim); frame(1 / 60);
      yes(u.vel.z < 0 && Math.hypot(u.vel.x, u.vel.z) <= reverse.length(), '逆方向への斬りで速度を瞬時に反転・加算しない');
      reset(); const victim = g.units.find(e => e.team !== u.team); victim.alive = true; victim.pos.set(0, 100, 22);
      g.lock.target = victim; attack('short', side); frame(1 / 60);
      yes(u.swing.tgt === victim && u.vel.x > 0 && u.vel.z < 0, 'ロック誘導中も横の慣性を残す'); victim.alive = false;
      reset(); g.shortDash(u, forward); u.onGround = false; u.vel.y = 5;
      const air = u.vel.clone(); g.swordTick(u, u.slots.aux, 1 / 60, true, aim);
      yes(u.vel.distanceTo(air) < 1e-9, '空中のダッシュ近接も水平・鉛直の速度を引き継ぐ');
      reset(); attack(); const wall = { minX: -20, maxX: 20, minZ: 15, maxZ: 17, bottom: 0, top: 150 }; g.obstacles.push(wall);
      let nearest = Infinity;
      try { for (let i = 0; i < 150; i++) { frame(1 / 60); nearest = Math.min(nearest, u.pos.z); } }
      finally { g.obstacles.splice(g.obstacles.indexOf(wall), 1); }
      yes(nearest >= wall.maxZ + 1.3 - 1e-6, '速い踏み込みでも壁を通り抜けない');
      reset(); attack(); g.jolt(u, u.pos.clone().add(forward), 9000, true);
      yes(!u.swing && u.lungeT === 0 && u.stun === 'down' && Math.hypot(u.vel.x, u.vel.z) <= 14.000001, '吹き飛ばされたら攻撃の慣性を持ち越さない');
      g.spawn(u); yes(u.vel.length() === 0 && !u.swing && u.lungeT === 0, '再出撃で慣性を残さない');
      const rates = [];
      for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
        reset(); attack(); for (let i = 0; i < Math.round(.6 / dt); i++) frame(dt);
        rates.push({ dt, distance: 40 - u.pos.z, speed: Math.hypot(u.vel.x, u.vel.z) });
      }
      yes(Math.max(...rates.map(r => r.distance)) / Math.min(...rates.map(r => r.distance)) < 1.05, '30・60・120fpsで踏み込み距離の差が5%以内');
      return { passed: checks.length, weapons: swords.length, samples, rates, checks };
    });
    async function controls(page) {
      return page.evaluate(() => {
        const g = __g, T = g.T; g.selectMap('dock'); g.setup(); const u = g.player, trace = [];
        Object.assign(u.mech, { head: 'light', body: 'light', arms: 'light', legs: 'light' }); g.equip(u, 'assault');
        Object.assign(u, { yaw: 0, pitch: 0, dashT: 0, longDash: false, slideT: 0, lungeT: 0, recoverT: 0, stun: '', ctrlLockT: 0, flying: false, onGround: true, boost: u.maxBoost, overheat: false, jumpBuf: 0, catCd: 0 });
        u.pos.set(0, 100, 60); u.vel.set(0, 0, 0);
        for (let i = 0; i < 600; i++) {
          const wish = new T.Vector3(i < 180 ? 0 : i < 360 ? 1 : 0, 0, i < 180 ? -1 : i < 360 ? 0 : 1);
          if ([30, 100, 200, 310].includes(i)) g.shortDash(u, wish);
          g.physics(u, wish, i >= 30 && i < 160, i === 60, 1 / 60, i >= 60 && i < 95);
          trace.push([u.pos.x, u.pos.y, u.pos.z, u.vel.x, u.vel.y, u.vel.z, u.boost]);
        }
        return trace;
      });
    }
    let compared = 0;
    if (process.argv[3]) {
      const base = await open(process.argv[3]);
      assert.deepEqual(await controls(p), await controls(base), '近接攻撃以外の歩行・ダッシュ・ジャンプ・滞空は変更前と一致'); compared = 600;
      await base.close();
    }
    assert.deepEqual(errors, []);
    if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify({ ...result, normalFramesCompared: compared, errors }, null, 2) + '\n');
    console.log(`ダッシュ近接の慣性：${result.passed}項目・${result.weapons}武器・通常移動${compared}フレーム比較、ブラウザエラー0`);
    console.log(JSON.stringify({ samples: result.samples, rates: result.rates }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
