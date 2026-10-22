// 主武器の系統/型の統一、他性能の互換性、実射時の跳ねと連射数を確認する。
// node tools/test/family_recoil_check.js dbg/family-recoil dbg/family-recoil-before [結果フォルダ]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const out = path.resolve(process.argv[4] || 'dbg/family-recoil/results'), checks = [], errors = [];
const yes = (ok, msg) => { assert.ok(ok, msg); checks.push(msg); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    async function run(dir) {
      const p = await b.newPage();
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await p.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
      await p.goto('file://' + path.resolve(dir, 'dbg.html'));
      const data = await p.evaluate(() => {
        const g = __g; g.selectMap('dock'); document.getElementById('start').click(); g.running = false;
        g.renderer.render = () => g.scene.updateMatrixWorld(true);
        for (const v of g.units) { v.frozen = true; v.alive = false; v.group.visible = false; }
        Object.assign(g.lock, { target: null, visible: false, prevAng: null });
        const u = g.player, rows = [], aim = new g.T.Vector3(0, 202.6, -100);
        const random = Math.random;
        // 系統の基本型全28と、低レート/強装の連射を含めた実射。
        const bases = [...new Set(Object.values(g.ARMORY).flatMap(c => c.main).map(k => g.WEAPONS[k].series))].map(s => Object.values(g.ARMORY).flatMap(c => c.main).find(k => g.WEAPONS[k].series === s));
        for (const key of [...bases, 'gatlingH', 'dualmgR', 'acannonR', 'haggardX']) {
          const cls = Object.keys(g.ARMORY).find(c => g.ARMORY[c].main.includes(key));
          u.isPlayer = true; Object.assign(u.mech, g.MECH_DEFAULT); g.equip(u, cls); u.slots.main = g.slotOf(key);
          Object.assign(u, { isPlayer: false, alive: true, weapon: 'main', switchT: 0, stun: '', repairing: false, transfer: null, onGround: true, yaw: 0, pitch: 0, scoped: false });
          const sl = u.slots.main; sl.w = { ...sl.w, spread: 0 }; sl.spin = 1;
          u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.group.position.copy(u.pos); u.group.visible = true;
          let seed = 7169; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
          const total = sl.ammo + sl.reserve, timeline = []; let maxTurn = 0;
          g.updateCamera(u, 1);
          for (let n = 0; n < 180; n++) {
            g.weaponLook(u, 1 / 60); g.scene.updateMatrixWorld(true);
            const old = g.camera.quaternion.clone(), trigger = !sl.w.chargeTime || sl.chargeT < sl.w.chargeTime;
            g.weaponsTick(u, 1 / 60, trigger, aim, 0); g.updateCamera(u, 1 / 60);
            maxTurn = Math.max(maxTurn, old.angleTo(g.camera.quaternion));
            timeline.push({ t: (n + 1) / 60, v: u.recoil, h: u.recoilYaw || 0 }); g.fxUpdate(1 / 60);
          }
          rows.push({ key, shots: total - sl.ammo - sl.reserve, maxTurn, peak: Math.max(...timeline.map(v => v.v)), horizontal: Math.max(...timeline.map(v => v.h)) - Math.min(...timeline.map(v => v.h)), timeline });
        }
        Math.random = random;
        return { weapons: g.WEAPONS, armory: g.ARMORY, parts: g.PARTS, rows };
      });
      await p.close(); return data;
    }
    const before = await run(process.argv[3] || 'dbg/family-recoil-before'), after = await run(process.argv[2] || 'dbg/family-recoil');
    const primary = Object.values(after.armory).flatMap(c => c.main), changed = new Set(['recoil', 'recoilH', 'recoilDelay', 'recoilRecovery', 'recoilDamping']);
    const rest = w => Object.fromEntries(Object.entries(w).filter(([k]) => !changed.has(k)));
    assert.deepEqual(after.armory, before.armory); assert.deepEqual(after.parts, before.parts);
    for (const [key, w] of Object.entries(after.weapons)) {
      if (primary.includes(key)) assert.deepEqual(rest(w), rest(before.weapons[key]), key + 'の威力・散布・発射レートなどを維持');
      else assert.deepEqual(w, before.weapons[key], key + 'の副/補助/特殊装備の全性能を維持');
    }
    yes(primary.length === 100, '全100主武器を調整し、他194装備・機体・選択順を維持');
    const families = new Map();
    for (const key of primary) {
      const w = after.weapons[key]; if (!families.has(w.series)) families.set(w.series, []); families.get(w.series).push(key);
      yes([w.recoil, w.recoilH, w.recoilRecovery, w.recoilDamping].every(Number.isFinite) && w.recoil > 0 && w.recoilH >= 0 && w.recoilRecovery > 0 && w.recoilDamping >= 0, key + 'の反動設定が有効');
      if (w.semi || w.chargeTime) yes(w.recoilDamping === 0, key + '：単発/充填の一発の跳ねを保持');
    }
    yes(families.size === 28, '28系統すべてに撃ち味を設定');
    for (const keys of families.values()) {
      const base = after.weapons[keys[0]];
      for (const key of keys) {
        const w = after.weapons[key];
        yes(w.recoilDelay === base.recoilDelay && w.recoilRecovery === base.recoilRecovery && w.recoilDamping === base.recoilDamping, key + '：同系統で回復のリズムを共有');
        if (w.label === '精密型') yes(w.recoil < base.recoil && w.recoilH < base.recoilH, key + '：精密型は基準より縦横とも小さい跳ね');
        if (w.label === '強装型') yes(w.recoil > base.recoil, key + '：強装型は一発の縦の重さを持つ');
      }
    }
    for (const now of after.rows) {
      const prior = before.rows.find(v => v.key === now.key);
      yes(now.shots > 0 && now.shots === prior.shots, now.key + '：実際の射撃回数を維持（' + now.shots + '）');
      yes(now.timeline.every(v => Number.isFinite(v.v) && Number.isFinite(v.h) && v.v >= 0), now.key + '：実射中に異常な反動なし');
    }
    for (const key of ['gatling', 'gatlingH']) {
      const now = after.rows.find(v => v.key === key), prior = before.rows.find(v => v.key === key);
      yes(now.horizontal < prior.horizontal * .6 && now.maxTurn < prior.maxTurn * .7, key + '：実射で左右の振幅と1フレームの視点の跳ねを軽減');
    }
    for (const key of ['dualmgR', 'acannonR']) {
      const now = after.rows.find(v => v.key === key), prior = before.rows.find(v => v.key === key);
      yes(now.peak < prior.peak * .6, key + '：600発以下の連射でも反動を蓄積し過ぎない');
    }
    const mag = after.rows.find(v => v.key === 'haggard'), oldMag = before.rows.find(v => v.key === 'haggard');
    assert.deepEqual(mag.timeline.map(v => [v.t, v.v]), oldMag.timeline.map(v => [v.t, v.v]));
    yes(mag.horizontal < oldMag.horizontal * .6, 'マグナムの基本型は縦の跳ねを維持し横ぶれを軽減');
    assert.deepEqual(errors, []); checks.push('ブラウザエラー0');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, before, after, errors }, null, 2) + '\n');
    console.log(`主武器の撃ち味：${checks.length}項目、100武器・28系統・実射64ケース、成功。ブラウザエラー0`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
