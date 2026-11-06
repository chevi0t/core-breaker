// レーザーの武器（レーザーバトルライフル0.4秒、光学狙撃銃1秒）の即時レーザー、残光、命中・遮蔽、遠くでも威力が落ちないことを確認する。
// node tools/test/laser_sniper_check.js dbg/projectile-visibility-after media/plasma-visual
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2]), out = path.resolve(process.argv[3] || 'media/plasma-visual');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    fs.mkdirSync(out, { recursive: true });
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], cases = [];
      const yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      g.selectMap('dock'); document.getElementById('start').click(); g.running = false;
      const u = g.player, target = g.units.find(v => v.team !== u.team), source = new T.Vector3(0, 202.6, 0), aim = new T.Vector3(0, 202.6, -60);
      function reset(key = 'lightSniper', team = 'B') {
        g.fxUpdate(10); for (const v of g.units) { v.alive = false; v.frozen = true; v.group.visible = false; }
        g.equip(u, 'raid'); u.slots.sub = g.slotOf(key);
        Object.assign(u, { team, alive: true, weapon: 'sub', switchT: 0, yaw: 0, pitch: 0, invulT: 0 });
        Object.assign(target, { team: team === 'B' ? 'R' : 'B', alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, weakT: 0, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 } });
        u.pos.set(0, 200, 0); target.pos.set(0, 200, -60); u.vel.set(0, 0, 0);
        for (const v of [u, target]) { v.group.position.copy(v.pos); v.group.rotation.set(0, 0, 0); v.group.visible = true; g.weaponLook(v, 0); }
        g.scene.updateMatrixWorld(true); g.camera.position.set(12, 206, 5); g.camera.lookAt(0, 202.6, -35); g.camera.updateMatrixWorld(true);
      }
      const keys = Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].laserFade > 0);
      yes(keys.filter(k => g.WEAPONS[k].series === 'ln').length === 2 && keys.filter(k => g.WEAPONS[k].series === 'lt').length === 5, 'レーザーバトルライフル2型と光学狙撃銃5型');
      for (const team of ['B', 'R']) for (const key of keys) {
        reset(key, team); const w = g.WEAPONS[key], hp = target.hp;
        g.fire(u, aim, 0, w, source); const laser = g.fx.filter(f => f.kind === 'laser'), label = team + '/' + key;
        yes(Math.abs(hp - target.hp - w.dmg) < 1e-6, label + ' 発射時に従来の威力で命中する');
        yes(laser.length > 0 && laser.every(f => f.obj.material.color.getHex() === 0xb8ff32 && f.obj.scale.y === f.len), label + ' 射線全体に緑レーザーを即座に描く');
        yes(!g.fx.some(f => f.kind === 'tracer' || f.kind === 'smoke') && !g.shells.length, label + ' 飛んでいく弾と白い煙を重ねない');
        yes(g.fx.some(f => f.kind === 'flash' && f.obj.position.distanceTo(target.pos) < 5 && f.age === 0), label + ' 着弾演出も発射と同時');
        g.fxUpdate(.03); const first = laser.map(f => ({ width: f.obj.scale.x, opacity: f.obj.material.opacity }));
        yes(first.every(f => f.opacity > .9), label + ' 発射直後ははっきり光る');
        const sharp = laser[0].obj.material.map; g.fxUpdate(.12);
        yes(laser.every((f, i) => f.obj.scale.x > first[i].width && f.obj.material.opacity > 0 && f.obj.material.opacity < .4) && laser[0].obj.material.map !== sharp, label + ' ぼやけた太い残光へ移る');
        const F = w.laserFade, mid = laser.map(f => f.obj.material.opacity); g.fxUpdate(F / 2 - .15);
        yes(F === (w.series === 'lt' ? 1 : .4), label + ' 残光の秒数');
        yes(laser.every((f, i) => g.fx.includes(f) && f.obj.material.opacity > 0 && f.obj.material.opacity <= mid[i]), label + ' 残光の半ばでも薄れながら残る');
        g.fxUpdate(F / 2 - .01); yes(laser.every(f => g.fx.includes(f) && f.obj.material.opacity > 0), label + ' 発射後' + (F - .01).toFixed(2) + '秒まで残光が残る');
        g.fxUpdate(.02); yes(laser.every(f => !g.fx.includes(f) && !f.obj.parent), label + ' ' + F + '秒で残光を片付ける');
        cases.push({ team, key, damage: hp - target.hp, segments: laser.length, beamLength: laser.reduce((n, f) => n + f.len, 0) });
      }
      reset(); const wall = new T.Mesh(new T.BoxGeometry(10, 10, .5), new T.MeshBasicMaterial()); wall.position.set(0, 202.6, -30);
      g.scene.add(wall); g.hittables.push(wall); wall.updateMatrixWorld(true); const hp = target.hp;
      g.fire(u, aim, 0, g.WEAPONS.lightSniper, source);
      const distance = g.fx.filter(f => f.kind === 'laser').reduce((n, f) => n + f.len, 0);
      yes(target.hp === hp && distance < 30, '壁でレーザーが止まり、背後の敵へ命中しない');
      g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
      for (const key of keys) { // 遠く（550m）でも発射と同時に全威力で当たる
        reset(key); const w = g.WEAPONS[key], far = new T.Vector3(0, 202.6, -550); target.pos.set(0, 200, -550); target.group.position.copy(target.pos); g.scene.updateMatrixWorld(true);
        const hp = target.hp; g.fire(u, far, 0, w, source);
        yes(!w.falloff && Math.abs(hp - target.hp - w.dmg) < 1e-6, key + ' 550mでも威力が落ちず、発射と同時に命中する');
      }
      yes(g.WEAPONS.lightSniper.name === 'レーザーバトルライフル' && g.WEAPONS.optSniper.name === '光学狙撃銃', '名前');
      { const shots = (key, sec) => { reset(key); const sl = u.slots.sub; const a = sl.ammo; for (let t = 0; t < sec; t += 1 / 60) g.gunTick(u, sl, 1 / 60, true, aim, 0); g.fxUpdate(10); return a - sl.ammo; };
        yes(shots('optSniper', .5) === 1, '光学狙撃銃は1発');
        yes(shots('optSniperK', .3) === 3, '光学狙撃銃・三点射型は1回で3発'); }
      window.__laserFixture = { reset, source, aim };
      return { passed: checks.length, checks, cases };
    });
    for (const [name, seconds] of [['laser-flash', .03], ['laser-afterglow', .18]]) {
      const png = await p.evaluate(seconds => {
        const g = __g, f = __laserFixture; f.reset(); g.fire(g.player, f.aim, 0, g.WEAPONS.lightSniper, f.source); g.fxUpdate(seconds);
        g.scene.updateMatrixWorld(true); g.renderer.render(g.scene, g.camera); return g.renderer.domElement.toDataURL('image/png');
      }, seconds);
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'laser-validation.json'), JSON.stringify({ ...result, errors }, null, 2) + '\n');
    console.log(`レーザー武器：${result.passed}項目、${result.cases.length}ケース成功。ブラウザエラー0`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
