// 実際の発射・再装填と連動する警告、レート別の実弾軌跡、着弾演出とゲーム計算の互換性。
// node tools/test/incoming_fire_check.js dbg dbg/incoming-before [画像・結果の保存先]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const after = path.resolve(process.argv[2] || 'dbg'), before = path.resolve(process.argv[3] || 'dbg/incoming-before'), out = path.resolve(process.argv[4] || 'dbg/incoming-fire');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [], errors = [], yes = (ok, msg) => { assert.ok(ok, msg); checks.push(msg); };
  fs.mkdirSync(out, { recursive: true });
  async function page(dir) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => {
      requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined;
      let state = 27; Math.random = () => { state = Math.imul(state, 1664525) + 1013904223 >>> 0; return state / 4294967296; };
    });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    await p.evaluate(() => { const g = __g; g.selectMap('city'); document.getElementById('start').click(); for (const u of g.units) u.frozen = true; });
    return p;
  }
  try {
    const p = await page(after);
    const warning = await p.evaluate(() => {
      const g = __g, p = g.player, e = g.units.find(u => u.team !== p.team), other = g.units.find(u => u.team !== p.team && u !== e), checks = [];
      const ok = (x, msg) => { if (!x) throw Error(msg); checks.push(msg); }, $ = id => document.getElementById(id);
      g.units.forEach(u => { u.alive = false; }); g.turrets.forEach(t => { t.alive = false; });
      Object.assign(p, { alive: true, cloak: false, invulT: 0, yaw: 0 }); p.pos.set(0, 200, 0);
      function enemy(u, x, z) { g.equip(u, 'assault'); u.slots.main = g.slotOf('ar'); Object.assign(u, { alive: true, target: p, locked: true, weapon: 'main', switchT: 0, recoil: 0, recoilYaw: 0, invulT: 0, stun: '', repairing: false, transfer: null }); u.pos.set(x, 200, z); u.group.position.copy(u.pos); }
      enemy(e, 0, -40); enemy(other, 40, 0);
      g.lockWarning(p, .016);
      ok(!$('lockDirections').hidden && !$('lockDirections').classList.contains('firing'), 'ロック中だけなら橙の警告');
      ok(!$('lockDirections').textContent.trim() && !$('lockAlert') && !$('lockAlertInfo'), '方向の文字・上部の警告文・機数を画面に出さない');
      const orbit = $('lockDirections').getBoundingClientRect().width, aimRadius = (+$('aimGauge').getAttribute('width') - 8) / 2;
      ok(Math.abs(orbit / 2 / aimRadius - 1.5) < .01, '三角の配置半径を照準外周の1.5倍にする');
      const aim = new g.T.Vector3(0, 202, -150);
      e.slots.main.reloadT = 1; g.weaponsTick(e, .01, true, aim, 0); g.lockWarning(p, .016);
      ok(!g.incomingShots.size, 'トリガーを押していても再装填中には被発砲にしない');
      e.slots.main.reloadT = 0; e.slots.main.cd = 0; g.weaponsTick(e, .01, true, aim, 0); g.lockWarning(p, .016);
      ok($('lockDir0').classList.contains('firing') && !$('lockDir2').classList.contains('firing'), '実射した方向だけ赤、別方向のロックは橙');
      const fired = getComputedStyle($('lockDir0').firstElementChild), idle = getComputedStyle($('lockDir2').firstElementChild);
      ok(parseFloat(fired.borderBottomWidth) > parseFloat(idle.borderBottomWidth) && parseFloat(fired.borderLeftWidth) > parseFloat(idle.borderLeftWidth), 'ロック中の三角を発砲時より一回り小さくする');
      ok([idle, fired].every(s => +s.opacity > 0 && +s.opacity < 1 && parseFloat(s.borderLeftWidth) * 2 < parseFloat(s.borderBottomWidth)), '両方の三角を細め・半透明にする');
      ok($('lockDirections').getBoundingClientRect().width === orbit, '発砲しても他方向のロック表示の配置半径を動かさない');
      g.lockWarning(p, .3); g.lockWarning(p, .016);
      ok(!$('lockDirections').classList.contains('firing'), '発砲の強調は短時間でロック表示へ戻る');
      e.locked = false; other.alive = false; g.shot(e, e.slots.main, aim, 0); g.lockWarning(p, .016);
      ok($('lockDirections').hidden && !g.incomingShots.size, 'ロックなしの実射では警告を出さない');
      e.locked = true; g.equip(e, 'raid'); e.slots.sub = g.slotOf('sniper'); e.weapon = 'sub'; g.shot(e, e.slots.sub, aim, 0); g.lockWarning(p, .016);
      ok($('lockDirections').hidden && !g.incomingShots.size, '狙撃銃は古いロック状態が残っていても無警告');
      enemy(e, 0, -40); p.cloak = true; g.shot(e, e.slots.main, aim, 0); g.lockWarning(p, .016);
      ok($('lockDirections').hidden, '光学迷彩中の自機には警告を出さない'); p.cloak = false;
      e.alive = false;
      const tu = g.turrets.find(t => t.team !== p.team);
      Object.assign(tu, { alive: true, hp: tu.maxHp || 1e4, target: p, locked: true, think: 10, fireCd: 0, shots: 3, yaw: Math.PI });
      tu.pos.copy(p.pos).add(new g.T.Vector3(0, 0, -20));
      tu.head.position.copy(tu.pos).setY(202);
      g.turretUpdate(tu, .01); g.lockWarning(p, .016);
      ok($('lockDirections').classList.contains('firing'), '防衛砲台の実際の射出でも赤く警告');
      g.spawn(p); g.lockWarning(p, .016); ok(!g.incomingShots.size, '再出撃時に前の発砲強調を残さない');
      tu.alive = false; enemy(e, 0, -40); enemy(other, 40, 0); p.pos.set(0, 200, 0);
      window.warningActors = { e, other }; g.lockWarning(p, .016);
      return checks;
    });
    warning.forEach(x => yes(true, x));
    for (const size of [{ width: 1280, height: 720 }, { width: 640, height: 480 }]) {
      await p.setViewportSize(size);
      for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
        const bounds = await p.evaluate(mode => {
          document.querySelector(`[data-console-choice="${mode}"]`).click(); __g.hud(240, .016);
          const $ = id => document.getElementById(id), r = $('lockDirections').getBoundingClientRect();
          const aimRadius = mode === 'mechanical' ? +$('mech-sp-bg').getAttribute('d').match(/A ([\d.]+)/)[1] : (+$('aimGauge').getAttribute('width') - 8) / 2;
          const cx = innerWidth / 2, cy = innerHeight / 2;
          const outside = [...document.querySelectorAll('.lockSector:not([hidden]) i')].every(el => { const b = el.getBoundingClientRect(); return Math.hypot(Math.max(b.left - cx, 0, cx - b.right), Math.max(b.top - cy, 0, cy - b.bottom)) > aimRadius; });
          return { ratio: r.width / 2 / aimRadius, outside, left: r.left, top: r.top, right: r.right, bottom: r.bottom, text: $('lockDirections').textContent, header: !!$('lockAlert') };
        }, mode);
        yes(Math.abs(bounds.ratio - 1.5) < .01 && bounds.outside && bounds.left >= 0 && bounds.top >= 0 && bounds.right <= size.width && bounds.bottom <= size.height && !bounds.text.trim() && !bounds.header, `${mode} ${size.width}pxで配置半径1.5倍・照準外側・文字なしを維持`);
        if (size.width === 1280 && mode === 'standard') {
          await p.screenshot({ path: path.join(out, 'locked.png') });
          await p.evaluate(() => { const g = __g; g.shot(warningActors.e, warningActors.e.slots.main, new g.T.Vector3(0, 202, -100), 0); g.lockWarning(g.player, .016); });
          await p.waitForTimeout(120); await p.screenshot({ path: path.join(out, 'fired.png') });
          await p.evaluate(() => { __g.lockWarning(__g.player, .4); __g.lockWarning(__g.player, .016); });
        }
      }
    }
    await p.setViewportSize({ width: 1280, height: 720 });
    const visuals = await p.evaluate(() => {
      const g = __g, T = g.T; g.fxUpdate(20); const rows = [];
      g.camera.position.set(12, 203, 8); g.camera.lookAt(0, 202, -55); g.camera.fov = 70; g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld();
      for (const key of ['gatling', 'ar', 'marks']) {
        g.tracer(new T.Vector3(0, 202, 0), new T.Vector3(0, 202, -150), 'R', false, g.WEAPONS[key]);
        const f = g.fx[g.fx.length - 1]; g.fxUpdate(.12);
        const pixelWidth = f.obj.scale.x * 2 * innerHeight / (2 * f.obj.position.distanceTo(g.camera.position) * Math.tan(g.camera.fov * Math.PI / 360));
        rows.push({ key, length: f.obj.scale.y, pixelWidth, depthTest: f.obj.material.depthTest, fade: f.fade }); g.fxUpdate(20);
      }
      let draws = 0; const rnd = Math.random; Math.random = () => { draws++; return .5; };
      const at = new T.Vector3(0, 202, -55); g.impact(at, 'world', .1); Math.random = rnd;
      const detail = g.fx.filter(f => f.kind === 'impactDust' || f.kind === 'impactSparks');
      const delayed = detail.length === 2 && detail.every(f => f.age < 0 && !f.obj.parent);
      g.fxUpdate(.15); const visible = detail.every(f => f.obj.parent && f.obj.material.opacity > 0);
      g.fxUpdate(1); const expired = detail.every(f => !g.fx.includes(f) && !f.obj.parent);
      for (let i = 0; i < 150; i++) g.impact(at, 'world', 0);
      const capped = g.fx.filter(f => f.impactDetail).length; g.fxUpdate(2); g.impact(at, 'world', 0);
      return { rows, draws, delayed, visible, expired, capped, reused: g.fx.filter(f => f.impactDetail).length };
    });
    const [gat, ar, marks] = visuals.rows;
    yes(gat.length < ar.length && ar.length < marks.length, '高レート銃ほど短く、低レート銃ほど長い軌跡を実際に描く');
    yes(visuals.rows.every(r => r.pixelWidth >= 3.39 && r.depthTest), '敵弾は3.4px相当の太さを保ち、壁越しには表示しない');
    yes(gat.fade < marks.fade, '高レートの残光も短くし、連射時の重なりを抑える');
    yes(visuals.delayed && visuals.visible && visuals.expired, '火花の粒と粉塵は着弾に合わせて出て、短時間で片付く');
    yes(visuals.capped <= 96 && visuals.reused === 2, '追加演出の上限を守り、消えた枠を再利用');
    for (const [name, color] of [['light', 0xdfe6eb], ['dark', 0x18252f]]) {
      const render = await p.evaluate(color => {
        const g = __g, T = g.T; g.fxUpdate(20);
        const scene = new T.Scene(); scene.background = new T.Color(color);
        g.camera.position.set(35, 205, 0); g.camera.lookAt(0, 202, -54); g.camera.updateMatrixWorld();
        for (const [i, key] of ['gatling', 'ar', 'marks'].entries()) {
          g.tracer(new T.Vector3(0, 206 - i * 4, 0), new T.Vector3(0, 206 - i * 4, -150), 'R', false, g.WEAPONS[key]);
        }
        g.fxUpdate(.12); for (const f of g.fx) scene.add(f.obj);
        g.renderer.render(scene, g.camera);
        const gl = g.renderer.getContext(), pixels = new Uint8Array(innerWidth * innerHeight * 4);
        gl.readPixels(0, 0, innerWidth, innerHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 235 && pixels[i + 1] > 140 && pixels[i + 1] < 205 && pixels[i + 2] < 125) count++;
        const png = g.renderer.domElement.toDataURL('image/png').split(',')[1];
        for (const f of g.fx) scene.remove(f.obj);
        return { count, png };
      }, color);
      yes(render.count > 100, name + 'の背景でも通常合成の橙の筋を画素として描画');
      fs.writeFileSync(path.join(out, 'tracers-' + name + '.png'), Buffer.from(render.png, 'base64'));
    }

    async function simulation(dir) {
      const q = await page(dir);
      const result = await q.evaluate(() => {
        const g = __g, u = g.player, e = g.units.find(u => u.team !== g.player.team), rows = [];
        g.running = false; g.units.forEach(q => { q.alive = q === u || q === e; });
        Object.assign(e, { hp: 1e7, maxHp: 1e7, invulT: 0, weakT: 0, armorAvg: 1, partArmor: { head: 1, body: 1, arms: 1, legs: 1 } });
        u.pos.set(0, 200, 0); e.pos.set(0, 200, -60); u.group.position.copy(u.pos); e.group.position.copy(e.pos); g.scene.updateMatrixWorld(true);
        let state = 123, draws = 0; Math.random = () => { draws++; state = Math.imul(state, 1664525) + 1013904223 >>> 0; return state / 4294967296; };
        for (const key of ['ar', 'gatling', 'marks', 'rail']) {
          const hp = e.hp; g.fire(u, new g.T.Vector3(0, 202.5, -100), .003, g.WEAPONS[key], new g.T.Vector3(0, 202.5, 0));
          rows.push({ key, damage: hp - e.hp, end: g.fx.filter(f => f.kind === 'tracer').at(-1).end.toArray(), rng: state });
        }
        const prev = draws; g.impact(new g.T.Vector3(0, 202, -20), 'world', 0);
        return { rows, impactDraws: draws - prev };
      }); await q.close(); return result;
    }
    const old = await simulation(before), now = await simulation(after);
    assert.deepEqual(now, old, '射撃・着弾の変更前後比較');
    yes(now.rows.some(r => r.damage > 0), '変更前後で実射の着弾位置・威力・乱数列と着弾演出の乱数消費が一致');
    async function impactImage(dir, version) {
      const q = await page(dir);
      const result = await q.evaluate(() => {
        const g = __g, T = g.T, scene = new T.Scene(); scene.background = new T.Color(0xc6d2da);
        g.fxUpdate(20);
        const wall = new T.Mesh(new T.PlaneGeometry(100, 100), new T.MeshBasicMaterial({ color: 0x76838c }));
        wall.position.set(0, 200, -56); scene.add(wall);
        g.camera.position.set(0, 204, 0); g.camera.lookAt(0, 203, -55); g.camera.fov = 70; g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld();
        let seed = 12; Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296; };
        g.impact(new T.Vector3(0, 203, -55.99), 'world', 0); g.fxUpdate(.08);
        for (const f of g.fx) scene.add(f.obj); g.renderer.render(scene, g.camera);
        const gl = g.renderer.getContext(), pixels = new Uint8Array(64 * 64 * 4);
        gl.readPixels(innerWidth / 2 - 32, innerHeight / 2 - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.max(Math.abs(pixels[i] - pixels[0]), Math.abs(pixels[i + 1] - pixels[1]), Math.abs(pixels[i + 2] - pixels[2])) > 15) visible++;
        return { visible, png: g.renderer.domElement.toDataURL('image/png').split(',')[1] };
      });
      fs.writeFileSync(path.join(out, 'impact-wall-' + version + '.png'), Buffer.from(result.png, 'base64'));
      await q.close(); return result.visible;
    }
    const impactBefore = await impactImage(before, 'before'), impactAfter = await impactImage(after, 'after');
    yes(impactAfter > impactBefore * 1.2, '壁際の着弾も粉塵と火花が埋もれず、見える画素の面積が増える');
    yes(errors.length === 0, 'ブラウザエラーなし');
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, visuals, old, now, impactBefore, impactAfter, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, rows: visuals.rows, errors })); await p.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
