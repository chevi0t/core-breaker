// 高レート時の反動軽減と、主武器の基準値・弾道・腕部・回復、視点への二重加算を確認する。
// node tools/test/primary_recoil_check.js dbg/recoil-after dbg/recoil-before media/primary-recoil
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const after = path.resolve(process.argv[2] || 'dbg/recoil-after'), before = path.resolve(process.argv[3] || 'dbg/recoil-before');
const out = path.resolve(process.argv[4] || 'media/primary-recoil'), checks = [], errors = [];
const yes = (ok, label) => { assert.ok(ok, label); checks.push(label); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    async function page(dir) {
      const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
      await p.goto('file://' + path.join(dir, 'dbg.html'));
      await p.evaluate(() => {
        const g = __g; g.renderer.render = () => g.scene.updateMatrixWorld(); g.selectMap('dock'); document.getElementById('start').click(); g.running = false;
        for (const u of g.units) { u.frozen = true; u.alive = false; u.group.visible = false; }
      });
      return p;
    }
    const baseline=await page(before),old=await baseline.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));await baseline.close();
    const p=await page(after);
    const data = await p.evaluate(() => ({ weapons: __g.WEAPONS, parts: __g.PARTS, armory: __g.ARMORY }));
    const primary = new Set(Object.values(data.armory).flatMap(c => c.main)), fields = new Set(['recoil', 'recoilH', 'recoilDelay', 'recoilRecovery', 'recoilDamping']);
    for (const [key, w] of Object.entries(data.weapons)) {
      if (primary.has(key)) {
        yes(Number.isFinite(w.recoil) && w.recoil > 0 && Number.isFinite(w.recoilH) && w.recoilH >= 0 && w.recoilDelay >= 0 && w.recoilRecovery > 0, key + 'の縦横反動と回復が有効');
        assert.deepEqual(Object.fromEntries(Object.entries(w).filter(([k]) => !fields.has(k))), Object.fromEntries(Object.entries(old.weapons[key]).filter(([k]) => !fields.has(k))), key + 'の反動以外の性能');
      } else assert.deepEqual(w, old.weapons[key], key + 'の既存性能');
    }
    assert.deepEqual(data.armory, old.armory); assert.deepEqual(data.parts, old.parts);
    yes(primary.size === 100, '主武器100種と他の武器・機体/装備順の互換性');
    const reference = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../research/weapons/primary-recoil-tuning.json'), 'utf8'));
    for (const { key, degrees: [v, h] } of reference.weapons) yes(Math.abs(data.weapons[key].recoil * 180 / Math.PI - v) < 1e-10 && Math.abs(data.weapons[key].recoilH * 180 / Math.PI - h) < 1e-10, key + 'の採用記録にある縦横設定');
    const functional = await p.evaluate(() => {
      const g = __g, u = g.player, checks = [], close = (a, b) => Math.abs(a - b) < 1e-7;
      const check = (ok, text) => { if (!ok) throw Error(text); checks.push(text); };
      function reset(key = 'haggard') {
        const cls = Object.keys(g.ARMORY).find(c => g.ARMORY[c].main.includes(key));
        Object.assign(u.mech, g.MECH_DEFAULT); u.isPlayer = true; g.equip(u, cls); u.slots.main = g.slotOf(key);
        Object.assign(u, { isPlayer: true, alive: true, invulT: 0, weapon: 'main', switchT: 0, stun: '', repairing: false, transfer: null, onGround: true, yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0 });
        u.pos.set(0, 120, 0); u.vel.set(0, 0, 0); u.group.position.copy(u.pos); u.group.visible = true; g.weaponLook(u, 0); g.scene.updateMatrixWorld(true);
      }
      reset();
      const random = Math.random; Math.random = () => .75;
      const arms = [];
      for (const arm of ['light', 'standard', 'heavy']) {
        u.mech.arms = arm; g.equip(u, 'support'); const w = g.WEAPONS.haggard; g.recoilKick(u, w);
        arms.push({ arm, absorb: u.recoilAbsorb, v: u.recoil, h: u.recoilYaw });
        check(close(u.recoil * u.recoilAbsorb, w.recoil) && close(u.recoilYaw * u.recoilAbsorb, w.recoilH * .5), arm + '腕は縦横の反動吸収を同じ倍率で適用');
      }
      for (const arm of ['light', 'standard', 'heavy']) for (const [rpm, factor] of [[300, 1], [600, 1], [900, 2/3], [1200, .5], [1500, .4], [3000, .2]]) {
        reset('gatling'); u.mech.arms = arm; g.equip(u, 'heavy');
        const w = { ...g.WEAPONS.gatling, rpm }; g.recoilKick(u, w);
        check(close(u.recoil * u.recoilAbsorb, w.recoil * factor) && close(u.recoilYaw * u.recoilAbsorb, w.recoilH * .5 * factor), `${arm}腕/${rpm}発：1発の縦横反動が${factor}倍`);
      }
      for (const variant of [{ semi: true }, { chargeTime: 1 }, { type: 'cannon' }]) {
        reset(); const w = { ...g.WEAPONS.haggard, rpm: 1500, ...variant }; g.recoilKick(u, w);
        check(close(u.recoil * u.recoilAbsorb, w.recoil) && close(u.recoilYaw * u.recoilAbsorb, w.recoilH * .5), '単発・充填・重砲はレートで反動を軽減しない ' + JSON.stringify(variant));
      }
      reset(); u.isPlayer = false; g.recoilKick(u, g.WEAPONS.gatling);
      const botKick = [u.recoil, u.recoilYaw]; reset(); g.recoilKick(u, g.WEAPONS.gatling);
      check(close(u.recoil, botKick[0]) && close(u.recoilYaw, botKick[1]), 'プレイヤーとBotに同じレート補正を適用');
      const nums = g.itemNums('main', 'gatling');
      check(close(nums.find(n => n[0] === '縦反動')[1], .12) && close(nums.find(n => n[0] === '横反動')[1], .26), 'カスタマイズはガトリングの補正後の縦0.12°・横±0.26°を表示');
      reset(); g.recoilKick(u, g.WEAPONS.haggard); const start = u.recoil;
      g.recoilRecover(u, .099); check(close(u.recoil, start), '撃った直後の0.1秒は反動を保持');
      g.recoilRecover(u, .151); check(close(u.recoil, start - .06 * .15), '保持時間をまたぐフレームでも回復の時間を正しく数える');
      const recovered = [];
      for (const fps of [30, 60, 144]) {
        reset(); g.recoilKick(u, g.WEAPONS.haggard); for (let i = 0; i < fps / 2; i++) g.recoilRecover(u, 1 / fps);
        recovered.push(u.recoil);
      }
      check(recovered.every(x => close(x, recovered[0])), '30/60/144fpsで0.5秒後の回復量が一致');
      g.recoilRecover(u, 2); check(u.recoil === 0 && u.recoilYaw === 0, '撃ち止めると縦横とも0へ戻る');
      reset(); u.recoil = .2; u.recoilYaw = .08; g.recoilKick(u, g.WEAPONS.rocket);
      check(close(u.recoil, .2) && close(u.recoilYaw, .08), '副武器へ持ち替えても残った反動を切り詰めない');
      reset(); u.recoil = .04; u.recoilYaw = .02; g.updateCamera(u, .016);
      const dir = g.camera.getWorldDirection(new g.T.Vector3());
      check(close(Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), .04) && close(Math.atan2(-dir.x, -dir.z), .02), '縦横の反動で以前と同じ角度だけ視点が動く');
      const e = g.units.find(v => v.team !== u.team); e.pos.set(0, 120, -40); e.alive = true;
      u.pitch=Math.atan2(-2.1,40);u.recoil=u.recoilYaw=0;Object.assign(g.lock,{target:e,visible:true,prevAng:null});g.lockFollow(u,.01);
      const neutral=[u.yaw,u.pitch];u.recoil=.2;u.recoilYaw=.1;g.lockFollow(u,.01);
      check(close(u.yaw,neutral[0])&&close(u.pitch,neutral[1]),'静止した敵のロックは射撃反動を自動で補償しない');
      Object.assign(g.lock,{target:null,visible:false,prevAng:null});
      e.alive = false; e.group.visible = false;
      reset('gatling'); u.slots.main.w = { ...u.slots.main.w, spread: 0 }; u.slots.main.spin = 1;
      const begin = g.fx.length; g.weaponsTick(u, .05, true, new g.T.Vector3(0, 122.6, -100), 0);
      const burst = g.fx.slice(begin).filter(f => f.kind === 'tracer');
      check(burst.length >= 2, '低いfpsの1フレームでガトリングを複数発射');
      const pitches = burst.map(f => { const d = f.end.clone().sub(f.from); return Math.atan2(d.y, Math.hypot(d.x, d.z)); });
      check(pitches[1] > pitches[0] + .001, '同じフレームの2発目にも軽減後の反動を反映');
      reset('gatling'); u.slots.main.w = { ...u.slots.main.w, spread: 0 }; u.recoil = .04; u.recoilYaw = .02; g.updateCamera(u, .016);
      const aim = g.camera.position.clone().addScaledVector(g.camera.getWorldDirection(new g.T.Vector3()), 300);
      const n = g.fx.length; g.shot(u, u.slots.main, aim, 0);
      const ray = g.fx.slice(n).find(f => f.kind === 'tracer'), actual = ray.end.clone().sub(ray.from).normalize(), expected = aim.clone().sub(ray.from).normalize();
      check(actual.distanceTo(expected) < 1e-7, '視点へ反映済みの反動を弾道へ二重に加えない');
      reset('gatling'); const far = new g.T.Vector3(0, 122.6, -100); u.recoil = .1;
      check(!g.botRecoilReady(u, far), 'Botは体幅を外れる反動が残ると射撃を休む');
      g.recoilRecover(u, 3); check(g.botRecoilReady(u, far), '同じ回復規則で落ち着くとBotも射撃を再開できる');
      g.spawn(u); check(u.recoil === 0 && u.recoilYaw === 0 && u.cameraRecoil === 0 && u.cameraRecoilYaw === 0, '再出撃で縦横と視点に反映済みの反動をリセット');
      Math.random = random;
      return { checks, arms };
    });
    functional.checks.forEach(x => checks.push(x));
    async function samples(dir, version) {
      const q = await page(dir), rows = [];
      for (const [key, seconds, pause] of [['haggard', 2.5, false], ['haggard', 4, true], ['gatling', 3, false], ['ar', 3, false]]) {
        const sample = await q.evaluate(({ key, seconds, pause }) => {
          const g = __g, u = g.player, cls = Object.keys(g.ARMORY).find(c => g.ARMORY[c].main.includes(key));
          Object.assign(u.mech, g.MECH_DEFAULT); u.isPlayer = true; g.equip(u, cls); u.slots.main = g.slotOf(key);
          u.slots.main.w = { ...u.slots.main.w, spread: 0 }; // 武器固有の散布と分け、反動による実射線の変化を比べる。
          Object.assign(u, { isPlayer: false, alive: true, weapon: 'main', switchT: 0, stun: '', repairing: false, transfer: null, onGround: true, yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0 });
          u.pos.set(0, 120, 0); u.group.position.copy(u.pos); u.group.visible = true; u.vel.set(0, 0, 0);
          const random = Math.random; let seed = 7169; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
          const points = [], timeline = [], aim = new g.T.Vector3(0, 122.6, -100), dt = .01;
          g.updateCamera(u, 1); let cameraTurn = 0;
          for (let i = 0; i < seconds / dt; i++) {
            g.weaponLook(u, dt); g.scene.updateMatrixWorld(true);
            const n = g.fx.length, trigger = !pause || i % 100 < 1;
            g.weaponsTick(u, dt, trigger, aim, 0);
            const previous = g.camera.quaternion.clone(); g.updateCamera(u, dt);
            cameraTurn = Math.max(cameraTurn, previous.angleTo(g.camera.quaternion));
            for (const f of g.fx.slice(n)) if (f.kind === 'tracer') {
              const d = f.end.clone().sub(f.from), t = (-100 - f.from.z) / d.z, hit = f.from.clone().addScaledVector(d, t);
              points.push({ time: i * dt, x: hit.x, y: hit.y - 122.6 });
            }
            timeline.push({ t: i * dt, v: u.recoil * 180 / Math.PI, h: (u.recoilYaw || 0) * 180 / Math.PI });
            g.fxUpdate(dt);
          }
          Math.random = random;
          return { key, seconds, pause, points, timeline, cameraTurn, maxVertical: Math.max(...timeline.map(v => v.v)), horizontalRange: Math.max(...points.map(v => v.x)) - Math.min(...points.map(v => v.x)) };
        }, { key, seconds, pause });
        rows.push({ version, ...sample });
      }
      await q.close(); return rows;
    }
    const plots = [...await samples(before, 'before'), ...await samples(after, 'after')];
    fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify({ seed: 7169, distance: 100, spread: 0, plots }, null, 2) + '\n');
    const a = (key, pause, version) => plots.find(s => s.key === key && s.pause === pause && s.version === version);
    assert.deepEqual(a('haggard',false,'after').timeline.map(v=>[v.t,v.v]),a('haggard',false,'before').timeline.map(v=>[v.t,v.v]),'マグナムの縦反動の蓄積・回復を維持');
    const magYaw = version => Math.max(...a('haggard',false,version).timeline.map(v => Math.abs(v.h)));
    yes(magYaw('after') < magYaw('before') * .8, 'マグナムは一発の縦の重さを保ち、発射後の横の跳ね角を軽減');
    for (const key of ['gatling', 'ar']) {
      const prior = a(key, false, 'before'), now = a(key, false, 'after');
      yes(now.points.length === prior.points.length, key + 'の実際の発射数と連射速度を維持');
      yes(now.maxVertical < prior.maxVertical * .8 && now.horizontalRange < prior.horizontalRange * .8, key + 'の3秒実射で反動による縦横の散りを軽減');
      yes(now.cameraTurn < prior.cameraTurn * .8, key + 'の射撃による1フレームの視点の跳ねを軽減');
    }
    yes(a('haggard', false, 'after').maxVertical > a('haggard', true, 'after').maxVertical, '間をあけたマグナム射撃で蓄積を抑えられる');
    await p.bringToFront();
    await p.evaluate(() => { document.exitPointerLock?.(); __g.renderCustom(); __g.showPage('pgCustom'); document.getElementById('overlay').hidden = false; });
    await p.waitForFunction(() => !document.pointerLockElement);
    await p.locator('[data-cu="heavy"]').click(); await p.locator('[data-cslot="main"]').click();
    // 系統キーはカタログから探す。
    const series = data.weapons.gatling.series, row = p.locator(`[data-series="${series}"]`);
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
    await p.locator('[data-pick="gatlingH"]').hover();
    const comparison = await p.locator('#cuDiff').textContent();
    yes(comparison.includes('縦反動') && comparison.includes('横反動') && comparison.includes('0.12°') && comparison.includes('0.26°'), 'カスタマイズで調整後の縦横反動を比較できる');
    await p.screenshot({ path: path.join(out, 'customization.png') });
    yes(errors.length === 0, 'ブラウザエラーなし');
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, functional, errors }, null, 2) + '\n');
    console.log(`主武器反動：${checks.length}項目、実射の比較${plots.length}ケース、成功。ブラウザエラー0`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
