// 命中と被弾の表示を実射・防御・連射・リセットで確認する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/feedback');
const out = path.resolve(process.argv[3] || path.join(dir, 'results'));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    fs.mkdirSync(out, { recursive: true });
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const report = await p.evaluate(() => {
      const g = __g, T = g.T, checks = [], $ = id => document.getElementById(id);
      const yes = (v, text) => { if (!v) throw Error(text); checks.push(text); };
      g.selectMap('dock'); $('start').click(); g.running = true;
      const u = g.player, e = g.units.find(v => v.team !== u.team), ally = g.units.find(v => v !== u && v.team === u.team);
      const opacity = id => +$(id).style.opacity;
      function reset() {
        g.spawn(u); g.equip(u, 'assault'); g.running = true; g.fxUpdate(10); g.shells.length = 0;
        for (const v of g.units) { v.alive = false; v.frozen = true; v.group.visible = false; v.respawnT = 100; }
        for (const v of [u, e]) {
          Object.assign(v, { alive: true, hp: 100000, maxHp: 100000, invulT: 0, armorAvg: 1, weakT: 0, yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0, stun: '', repairing: false, barrierOn: false, downT: 0, scoped: false });
          v.partArmor = { head: 1, body: 1, arms: 1, legs: 1 }; v.vel.set(0, 0, 0);
        }
        u.pos.set(0, 200, 0); e.pos.set(0, 200, -25);
        for (const v of [u, e]) { v.group.position.copy(v.pos); v.group.rotation.set(0, 0, 0); v.group.visible = true; g.weaponLook(v, 0); }
        g.scene.updateMatrixWorld(true); g.updateCamera(u, 1); g.camera.lookAt(0, 200, -100);
        g.resetCombatFeedback();
      }
      reset();
      const old = { hp: e.hp, yaw: u.yaw, pitch: u.pitch, recoil: u.recoil, pos: u.pos.toArray(), q: g.camera.quaternion.toArray() };
      const result = g.fire(u, new T.Vector3(0, 202, -25), 0, u.slots.main.w, new T.Vector3(0, 202, -5));
      yes(!!result && e.hp < old.hp, '自射撃の実命中で損傷する'); g.hitMark(result === 'head'); g.combatFeedbackHud();
      yes(opacity('headMark') === 1 && !$('headMark').classList.contains('critical'), '胴体命中は白い×');
      yes(u.yaw === old.yaw && u.pitch === old.pitch && u.recoil === old.recoil && JSON.stringify(u.pos.toArray()) === JSON.stringify(old.pos) && JSON.stringify(g.camera.quaternion.toArray()) === JSON.stringify(old.q), '表示で視点・反動・移動を変更しない');
      g.hitMark(true); g.hitMark(false); g.combatFeedbackHud();
      yes($('headMark').classList.contains('critical') && opacity('headTxt') === 1, '同じ散弾の通常命中でも金色の頭部表示を消さない');
      for (let i = 0; i < 100; i++) { g.combatFeedbackUpdate(.05); g.hitMark(false); g.combatFeedbackHud(); }
      yes(!$('headMark').classList.contains('critical') && opacity('headTxt') === 0 && $('headMark').style.transform === 'scale(1)', '通常連射は頭部表示を延長せず、拡大を積み上げない');
      g.combatFeedbackUpdate(1); g.combatFeedbackHud(); yes(opacity('headMark') === 0, '命中表示が消える');
      reset(); g.damage(u, e, 500, false, false, null, e.pos, false); g.combatFeedbackHud();
      yes(u.hp === 99500 && opacity('damageEdge') > 0 && g.damageSectors[0].t > 0, '実被弾は損傷量を維持し前方の弧と画面端を表示');
      g.flashDamage(new T.Vector3(20, 200, 0), 300); g.flashDamage(new T.Vector3(0, 200, 20), 300); g.combatFeedbackHud();
      yes(g.damageSectors.filter(s => s.t > 0).length === 3, '前・右・後ろの被弾が同時に残る');
      g.camera.lookAt(100, g.camera.position.y, g.camera.position.z); g.combatFeedbackHud();
      yes(Math.abs(+$('damageDirections').children[0].getAttribute('transform').match(/[-\d.]+/)[0] + 90) < .01, '右を向くと元の前方の被弾弧が左へ回る');
      for (let i = 0; i < 1000; i++) g.flashDamage(e.pos, 99999);
      g.combatFeedbackHud(); yes(opacity('damageEdge') <= .6 && g.damageSectors.length === 8 && $('damageDirections').children.length === 8, '大量連射でも濃さ・方向表示数は固定上限');
      g.combatFeedbackUpdate(1); g.combatFeedbackHud(); yes(opacity('damageEdge') === 0 && g.damageSectors.every(s => s.t === 0), '被弾後に全表示が減衰する');
      reset(); u.invulT = 2; g.damage(u, e, 500); g.combatFeedbackHud(); yes(opacity('damageEdge') === 0, '無敵中は被弾表示なし');
      reset(); g.equip(u, 'heavy'); u.slots.sp = g.slotOf('barrier'); u.barrierOn = true; g.damage(u, e, 100, false, false, null, e.pos); g.combatFeedbackHud();
      yes(u.hp === 100000 && opacity('damageEdge') === 0, 'バリアで吸収した射撃は被弾表示なし');
      reset(); g.flashDamage(e.pos, 0); g.combatFeedbackHud(); yes(opacity('damageEdge') === 0, '威力0は被弾表示なし');
      const blast = (owner, at) => g.blast({ owner, team: owner.team, spec: { dmg: 1000, blast: 10 } }, at, null);
      reset(); blast(ally, g.targetPoint(u)); g.combatFeedbackHud(); yes(opacity('damageEdge') === 0, '味方の無損傷爆風では表示なし');
      reset(); blast(e, g.targetPoint(u).add(new T.Vector3(-3, 0, 0))); g.combatFeedbackHud(); yes(g.damageSectors[6].t > 0, '爆風は発射者でなく爆心の方向');
      reset(); const hp = u.hp; g.fire(e, new T.Vector3(0, 202, 0), 0, u.slots.main.w, new T.Vector3(0, 202, -15)); g.combatFeedbackHud();
      yes(u.hp < hp && opacity('damageEdge') > 0, '敵の実射撃でも被弾表示へ到達');
      const rand = Math.random; let calls = 0;
      try { Math.random = () => { calls++; return .5; }; g.hitMark(true); g.flashDamage(e.pos, 300); g.combatFeedbackUpdate(.01); g.combatFeedbackHud(); } finally { Math.random = rand; }
      yes(calls === 0, 'HUD演出はゲームの乱数を消費しない');
      u.scoped = true; g.hud(g.timeLeft, 0); yes(opacity('headMark') > 0 && opacity('damageEdge') > 0, 'スコープ中も命中と被弾を表示');
      g.running = false; g.combatFeedbackHud(); yes(opacity('headMark') === 0 && opacity('damageEdge') === 0, '一時停止時には表示を隠す');
      g.running = true; u.alive = false; g.combatFeedbackHud(); yes(opacity('damageEdge') === 0, '撃破後の視点には表示を残さない');
      g.spawn(u); yes(g.damageSectors.every(s => !s.t) && opacity('headMark') === 0, '再出撃でリセット');
      g.flashDamage(e.pos, 500); g.hitMark(true); g.buildMap('dock'); yes(g.damageSectors.every(s => !s.t) && opacity('headMark') === 0, 'マップ再構築でリセット');
      reset();
      const baseChildren = g.scene.children.length, baseObjects = new Set(g.scene.children);
      for (let i = 0; i < 200; i++) g.impact(new T.Vector3(0, 202, -25), 'hit', 0);
      g.fxUpdate(.001);
      const cores = g.scene.children.filter(o => !baseObjects.has(o) && o.isSprite && o.material.color?.getHex() === 0xffffff);
      yes(cores.length > 0 && cores.length <= 48 && cores.every(o => o.material.depthTest && !o.material.depthWrite), '白い着弾の芯は上限付きで奥行き判定を維持');
      g.fxUpdate(10); yes(g.scene.children.length === baseChildren, '連続着弾終了後に追加物を全て片付ける');
      g.hitMark(true); g.flashDamage(e.pos, 500); g.setup();
      yes(g.damageSectors.every(s => !s.t) && opacity('headMark') === 0, '再試合でもリセット');
      return { checks, errors: [] };
    });
    // 通常の試合画面で4種HUDと低解像度の重なりも画像で確認する。
    for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
      await p.evaluate(mode => {
        const g = __g; document.querySelector(`[data-console-choice="${mode}"]`).click();
        g.selectMap('city'); document.getElementById('start').click(); g.running = true;
        g.player.invulT = 0; for (const u of g.units) u.frozen = true; g.loop(performance.now()); g.updateCamera(g.player, 1); g.hitMark(false);
        g.flashDamage(g.player.pos.clone().add(new g.T.Vector3(20, 0, -20)), 2000);
        g.flashDamage(g.player.pos.clone().add(new g.T.Vector3(-20, 0, 0)), 500);
        g.hud(g.timeLeft, 0); g.renderer.render(g.scene, g.camera);
      }, mode);
      const separation = await p.evaluate(() => {
        const damage = document.getElementById('damageDirections').getBoundingClientRect().width * .43;
        const name = document.body.dataset.console === 'mechanical' ? '--mech-lock-warning-diameter' : '--lock-warning-diameter';
        return damage - parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) / 2;
      });
      assert(separation > 8, mode + '：被ロック警告と被弾の弧を離す');
      report.checks.push(mode + '：被ロック警告と被弾の弧を離す');
      await p.screenshot({ path: path.join(out, mode + '.png') });
    }
    await p.evaluate(() => { __g.player.scoped = true; __g.hitMark(true); __g.hud(__g.timeLeft, 0); });
    await p.screenshot({ path: path.join(out, 'scoped.png') });
    assert(await p.evaluate(() => getComputedStyle(document.getElementById('damageEdge')).zIndex === '2'));
    await p.evaluate(() => { __g.player.scoped = false; });
    await p.setViewportSize({ width: 640, height: 360 });
    await p.evaluate(() => { __g.hitMark(true); __g.hud(__g.timeLeft, 0); __g.renderer.render(__g.scene, __g.camera); });
    await p.screenshot({ path: path.join(out, 'compact.png') });
    assert.deepEqual(errors, []); report.errors = errors;
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
    console.log(`成功：${report.checks.length}項目、ブラウザエラーなし`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
