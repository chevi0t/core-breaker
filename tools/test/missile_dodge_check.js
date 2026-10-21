// 追加ミサイルの一斉射を、実際のshortDash/physicsで回避する比較。
// node tools/test/missile_dodge_check.js dbg/missiles [出力JSON]
// ゲーム内のパラメータは変更しない。地形の影響を除くため広域マップ上空に平床を置く。
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/missiles');
const output = path.resolve(process.argv[3] || path.join(dir, 'missile-dodge-check.json'));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.stack));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.abort());
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T;
      g.selectMap('wide'); document.getElementById('start').click(); g.running = false; g.renderer.render = () => {};
      for (const q of g.units) { q.frozen = true; q.alive = false; q.group.visible = false; }
      for (const q of g.turrets) q.alive = false;
      // 防御側は実際に初期パーツで作ったプレイヤー。攻撃側は敵軍の機体を使う。
      const defender = g.player, shooter = g.units.find(q => q.team !== defender.team);
      g.obstacles.push({ minX: -175, maxX: 175, minZ: -250, maxZ: 250, top: 100 });
      const floor = new T.Mesh(new T.BoxGeometry(350, 1, 500), new T.MeshBasicMaterial());
      floor.position.y = 99.5; g.scene.add(floor); g.hittables.push(floor); g.scene.updateMatrixWorld(true);
      const keys = Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].missile);
      const modes = ['still', 'step35', 'step20', 'step5', 'long35'], results = [];
      const originalRandom = Math.random;
      let seed = 42;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      try {
        for (const key of keys) for (const distance of [60, 90, 120]) for (const mode of modes) {
          seed = 42;
          for (const sh of g.shells) g.scene.remove(sh.mesh); g.shells.length = 0;
          const cls = g.ARMORY.heavy.sub.includes(key) ? 'heavy' : 'assault';
          shooter.isPlayer = true; g.loadout[cls].sub = key; g.equip(shooter, cls);
          shooter.weapon = 'sub'; shooter.switchT = 0; shooter.lockRange = 200;
          defender.isPlayer = true; Object.assign(defender.mech, g.MECH_DEFAULT); g.equip(defender, 'assault'); defender.isPlayer = false;
          for (const q of [shooter, defender]) {
            Object.assign(q, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, downT: 0, stun: '', stunT: 0, tilt: 0,
              weakT: 0, cloak: false, repairing: false, transfer: null, electricT: 0, jamT: 0, planted: false,
              onGround: true, flying: false, ctrlLockT: 0, recoverT: 0, slideT: 0, chargerOn: false, charging: false,
              lungeT: 0, dashT: 0, longDash: false, overheat: false, boost: q.maxBoost, boostIdle: 0, catCd: 0,
              yaw: 0, pitch: 0, barrierOn: false, fieldOn: false, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 } });
            q.vel.set(0, 0, 0); q.group.visible = true; g.resetMechPose(q);
          }
          shooter.pos.set(0, 100, 70); defender.pos.set(0, 100, 70 - distance);
          for (const q of [shooter, defender]) { q.group.position.copy(q.pos); q.group.rotation.set(0, 0, 0); g.weaponLook(q, 0); }
          g.scene.updateMatrixWorld(true);
          const sl = shooter.slots.sub; g.clearMissileLocks(sl);
          sl.missileLocks = Array.from({ length: sl.w.missile.locks }, () => ({ target: defender, life: defender.lifeId || 0, hidden: 0, far: 0 }));
          let stepped = false, stepAt = null, boostCost = 0, peak = 0, boundary = false, spentAtEnd = 0;
          for (let i = 0; i < 720; i++) {
            const dt = 1 / 60, nearest = Math.min(Infinity, ...g.shells.filter(sh => sh.missileTarget?.target === defender).map(sh => sh.pos.distanceTo(g.targetPoint(defender))));
            const threshold = mode === 'step5' ? 5 : mode === 'step20' ? 20 : 35;
            if (mode !== 'still' && !stepped && nearest <= threshold) {
              const before = defender.boost;
              stepped = g.shortDash(defender, new T.Vector3(1, 0, 0));
              if (stepped) { stepAt = i * dt; boostCost = before - defender.boost; }
            }
            const held = mode === 'long35' && stepped;
            g.physics(defender, held ? new T.Vector3(1, 0, 0) : new T.Vector3(), held, false, dt);
            peak = Math.max(peak, Math.hypot(defender.vel.x, defender.vel.z));
            boundary ||= Math.abs(defender.pos.x) >= 174; spentAtEnd = defender.maxBoost - defender.boost;
            defender.group.position.copy(defender.pos); defender.group.updateMatrixWorld(true);
            // 1回だけ引き金を引く。組の後続弾もその時点の敵位置へ狙う。
            if (i === 0 || sl.bn > 0) g.weaponsTick(shooter, dt, i === 0, g.targetPoint(defender), 0);
            g.shellUpdate(dt); g.fxUpdate(dt); g.puffUpdate(dt);
            if (!g.shells.length && !sl.bn) break;
          }
          results.push({ key, model: sl.w.model, distance, mode, damage: Math.round(1e6 - defender.hp),
            stepAt: stepAt == null ? null : +stepAt.toFixed(4), boostCost: +boostCost.toFixed(4), peak: +peak.toFixed(3),
            x: +defender.pos.x.toFixed(3), spentAtEnd: +spentAtEnd.toFixed(3), boundary });
        }
      } finally { Math.random = originalRandom; }
      return { results, speeds: Object.fromEntries(keys.map(k => [k, { initial: g.WEAPONS[k].proj.speed, maximum: g.WEAPONS[k].proj.maxSpeed, acceleration: g.WEAPONS[k].proj.accel }])) };
    });
    assert.deepEqual(errors, []); assert.equal(result.results.length, 120);
    for (const r of result.results) {
      assert.ok(Number.isFinite(r.damage) && r.damage >= 0);
      if (r.mode === 'still') assert.ok(r.damage > 0, r.key + 'の静止対照に命中する');
      if (r.stepAt != null) assert.ok(Math.abs(r.boostCost - 9.6) < 1e-6 && r.peak > 40, '実際のブースト消費・踏み込み速度');
    }
    for (const key of ['missile', 'missileF', 'mlrsF']) {
      const r = result.results.find(r => r.key === key && r.distance === 90 && r.mode === 'step20');
      assert.equal(r.damage, 0, key + '：90mからの一斉射を20m手前からの横ステップで回避'); assert.equal(r.boundary, false);
    }
    const report = { date: '2026-10-21', scenarios: result.results.length, errors,
      setup: '広域マップ上空の平床。標準パーツの強襲機、装甲倍率1・計測用耐久100万。60Hz・固定乱数42。最大捕捉の一斉射。shortDash/physics/射出/誘導/爆風は本体。捕捉は完了状態を与え、射手の捕捉距離は200mに固定して発射後だけを比較する。',
      limitation: '静止対照と横1回の踏み込み/横巡航の比較。boundary=trueは外周到達を含み、自由空間での回避判定から外す。全マップ・全パーツ・全タイミングの保証ではない。', ...result };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    for (const key of Object.keys(result.speeds)) console.log(key + ': ' + result.results.filter(r => r.key === key && r.distance === 90).map(r => r.mode + '=' + r.damage).join(' / '));
    console.log(`成功: ${report.scenarios}条件・実行エラー0。${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
