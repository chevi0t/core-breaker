// ダッシュ近接後0.3秒からの横クイックブースト。攻撃中・他の硬直は解除しない。
// node tools/test/melee_recovery_cancel_check.js dbg/melee-cancel [結果JSON]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg/melee-cancel', 'dbg.html')).href);
    const result = await page.evaluate(() => {
      const g = __g, T = g.T, stop = new T.Vector3(), forward = new T.Vector3(0, 0, -1), right = new T.Vector3(1, 0, 0);
      const aim = new T.Vector3(0, 202.6, -100), samples = [], rates = [];
      let checks = 0;
      const ok = (v, m) => { if (!v) throw Error(m); checks++; }, near = (a, b) => Math.abs(a - b) < 1e-6;
      g.selectMap('dock'); g.setup(); g.running = false;
      const u = g.player, bot = g.units.find(q => !q.isPlayer), weapons = Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].type === 'sword');
      for (const q of g.units) { q.frozen = true; q.alive = false; q.pos.set(10000, 100, 10000); }
      function reset(key = 'sword', actor = u) {
        g.equip(actor, 'assault'); actor.slots.aux = g.slotOf(key); actor.weapon = 'aux';
        Object.assign(actor, { alive: true, hp: actor.maxHp, invulT: 0, switchT: 0, yaw: 0, pitch: 0, dashT: 0, longDash: false,
          dashState: '', lungeT: 0, slideT: 0, stun: '', stunT: 0, electricT: 0, ctrlLockT: 0, repairing: false, transfer: null,
          planted: false, flying: false, zip: null, downT: 0, onGround: true, boost: actor.maxBoost, overheat: false, jumpBuf: 0,
          chargerOn: false, target: null, catCd: 0 });
        actor.pos.set(0, 200, 20); actor.vel.set(0, 0, 0); g.lock.target = null;
        for (const k of Object.keys(g.keys)) delete g.keys[k];
        for (const k of Object.keys(g.pressed)) delete g.pressed[k];
        return actor;
      }
      function attack(actor = u, strong = true, dt = 1 / 120) {
        actor.longDash = strong;
        const sl = actor.slots.aux, charged = !!(sl.w.chargeWave || sl.w.meleeCharge);
        if (charged) sl.chargeT = sl.w.chargeTime;
        g.weaponsTick(actor, dt, !charged, aim, 0);
        ok(actor.swing?.dashAttack === strong, sl.w.key + '：通常/ダッシュ近接を実際に開始');
        return actor.swing;
      }
      function frame(actor = u, dt = 1 / 120) {
        g.physics(actor, stop, false, false, dt); g.weaponsTick(actor, dt, false, aim, 0); g.fxUpdate(dt);
      }
      function recover(actor = u, dt = 1 / 120) {
        let n = 0;
        while (actor.recoverT <= 0 && n++ < 1000) frame(actor, dt);
        ok(n < 1000 && actor.meleeRecovery?.stopped, '最後の振りが終わって硬直開始');
      }
      function ready(key = 'sword', actor = u) { reset(key, actor); attack(actor); recover(actor); frame(actor, .3); }
      const snapshot = actor => [actor.recoverT, actor.swing, actor.meleeRecovery, actor.boost, actor.slideT, actor.lungeT, actor.dashT, g.mirages.length, actor.slots.sp.heat];
      function rejected(actor, wish, label) {
        const before = snapshot(actor); ok(!g.shortDash(actor, wish), label + '：ダッシュ不成立');
        ok(snapshot(actor).every((v, i) => v === before[i]), label + '：硬直・振り・燃料・デコイを維持');
      }
      // 全近接を実際に振る。30/60/120Hzで、構え・連撃途中と0.3秒境界を検査。
      for (const hz of [30, 60, 120]) {
        let cancelled = 0, natural = 0;
        for (const key of weapons) {
          reset(key); const dt = 1 / hz, sw = attack(u, true, dt);
          rejected(u, right, key + '/' + hz + '：構え中');
          let frames = 0;
          while (u.recoverT <= 0 && frames++ < 1000) {
            frame(u, dt);
            if (!sw.stopped) rejected(u, right, key + '/' + hz + '：斬撃・連撃中');
          }
          ok(sw.stopped && u.meleeRecovery === sw && u.recoverT > 0, key + '：最終段から計時');
          const duration = u.recoverT;
          for (let i = 0; i < Math.round(.3 * hz) - 1; i++) frame(u, dt);
          if (u.recoverT > 0) rejected(u, right, key + '/' + hz + '：0.3秒より前');
          frame(u, dt);
          if (duration > .3 + 1e-6) {
            const boost = u.boost, cd = u.slots.aux.cd, pos = u.pos.clone(), vy = u.vel.y;
            ok(g.shortDash(u, right), key + '/' + hz + '：0.3秒で横へ解除');
            ok(!u.swing && !u.meleeRecovery && u.recoverT === 0 && u.lungeT === 0 && u.slideT === 0, key + '：戻りと滑りを終了');
            ok(near(boost - u.boost, 9.6) && u.slots.aux.cd === cd, key + '：通常消費、武器クールダウンを維持');
            ok(near(u.vel.x, u.dashV) && near(u.vel.z, 0) && near(u.vel.y, vy < 0 ? vy * .3 : vy), key + '：通常の横ダッシュ速度');
            frame(u, dt);
            ok(u.pos.x > pos.x && u.recoverT === 0 && !u.swing, key + '：次のフレームに横移動、硬直を再設定しない');
            cancelled++;
          } else {
            ok(u.recoverT === 0 && u.meleeRecovery === null, key + '：短い硬直は自然終了'); natural++;
          }
          if (hz === 60) samples.push({ key, recovery: duration, cancel: duration > .3 + 1e-6 });
        }
        rates.push({ hz, cancelled, natural });
      }
      ready(); // 境界の1ms手前は不可、0.3秒ちょうどは可。
      u.recoverT = u.meleeRecovery.a.recover - .299;
      rejected(u, right, '0.299秒'); frame(u, .001); ok(g.shortDash(u, right), '0.300秒ちょうどで許可');
      for (const yaw of [0, .37, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        for (const [side, fwd] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1]]) {
          ready(); u.yaw = yaw;
          const wish = new T.Vector3(Math.cos(yaw) * side - Math.sin(yaw) * fwd, 0, -Math.sin(yaw) * side - Math.cos(yaw) * fwd).normalize();
          ok(g.shortDash(u, wish) && u.dashDir.distanceTo(wish) < 1e-6, '現在の向きで左右・斜め横を許可');
        }
        for (const [side, fwd] of [[0, 0], [0, 1], [0, -1], [.3, 1], [-.3, -1]]) {
          ready(); u.yaw = yaw;
          rejected(u, new T.Vector3(Math.cos(yaw) * side - Math.sin(yaw) * fwd, 0, -Math.sin(yaw) * side - Math.cos(yaw) * fwd).normalize(), '無方向・前後寄り');
        }
      }
      // プレイヤー専用の抜け道にしない。実際のBotユニットも同じ関数と消費。
      ready('sword', bot); ok(!bot.isPlayer && g.shortDash(bot, right), 'Botも0.3秒後に解除');
      for (const [label, change] of [
        ['過熱', p => p.overheat = true], ['残量ゼロ', p => p.boost = 0], ['既にダッシュ中', p => p.dashT = .1],
        ['カタパルト', p => p.ctrlLockT = .1], ['よろけ', p => p.stun = 'stagger'], ['ダウン', p => p.stun = 'down'],
        ['着地硬直', p => p.stun = 'land'], ['受け身', p => p.stun = 'roll'], ['電撃', p => p.electricT = 1],
        ['ポッド', p => p.repairing = true], ['移動待機', p => p.transfer = {}], ['設置構え', p => p.planted = true],
        ['ジップ', p => p.zip = {}], ['大破', p => p.alive = false],
        ['榴弾砲', p => { p.slots.sp = g.slotOf(Object.keys(g.WEAPONS).find(k => g.WEAPONS[k].type === 'artillery')); p.weapon = 'sp'; }],
      ]) { ready(); change(u); rejected(u, right, label); }
      ready(); u.meleeRecovery = null; rejected(u, right, '由来の不明な硬直');
      reset(); const normal = attack(u, false); // 将来、通常技にrecoverを付けても解除対象にしない。
      normal.a = { ...normal.a, recover: 1, time: normal.a.windup + normal.a.sweep + 1 };
      recover(); frame(u, .3); rejected(u, right, '通常近接の硬直');
      ready(); frame(u, 2); ok(u.recoverT === 0 && !u.meleeRecovery, '自然回復で解除権利を消す');
      ready(); g.jolt(u, u.pos.clone().add(forward), 4000, true);
      ok(!u.meleeRecovery && !u.swing && u.stun === 'stagger', '被弾中断で解除権利を消す');
      ready(); g.blast({ team: 'R', owner: bot, spec: { stunSeconds: 1, blast: 10 } }, u.pos.clone(), null);
      ok(!u.meleeRecovery && !u.swing && u.electricT > 0, '電撃中断で解除権利を消す');
      ready(); g.equip(u, 'assault'); ok(!u.meleeRecovery && u.recoverT === 0, '装備更新で解除権利を消す');
      ready(); g.spawn(u); ok(!u.meleeRecovery && u.recoverT === 0 && !u.swing, '再出撃で解除権利を消す');
      reset(); u.chargerOn = true; attack(u); recover(); frame(u, .3);
      ok(g.shortDash(u, right) && u.chargerOn, '加速装置由来のダッシュ近接も解除、起動状態を維持');
      ready('waveSword'); ok((u.waveFired || 0) > 0, 'チャージ光波は斬撃中に射出済み');
      const waves = u.waveFired; ok(g.shortDash(u, right), 'チャージ光波剣も解除'); frame(u, .1);
      ok(u.waveFired === waves, '解除で光波を重複発射しない');
      ready(); u.slots.sp = g.slotOf('mirage'); u.mirageOn = true;
      u.recoverT = u.meleeRecovery.a.recover - .299;
      rejected(u, right, '解除前はミラージュを消費しない'); frame(u, .001);
      const count = g.mirages.length, heat = u.slots.sp.heat;
      ok(g.shortDash(u, right), 'ミラージュ中の硬直解除');
      ok(g.mirages.length === count + 1 && near(heat - u.slots.sp.heat, u.slots.sp.w.decoyCost), '成功時に1体だけデコイ、SP通常消費');
      reset(); const cost = u.boost; ok(g.shortDash(u, forward) && near(cost - u.boost, 9.6), '硬直なしの前ダッシュを維持');
      // 後半の実入力試験へ同じリセット/振り出しを渡す。
      window.cancelFixture = { reset, attack, recover, frame, ready, u };
      return { checks, weapons: weapons.length, rates, samples };
    });
    // キーボードからプレイヤー入力経路を通す。早押しの保持は自動解除にしない。
    await page.evaluate(() => {
      const g = __g, f = cancelFixture; f.reset(); g.running = true;
      document.getElementById('overlay').hidden = true;
      window.inputFrame = dt => { g.playerUpdate(g.player, dt || 1 / 120); for (const k of Object.keys(g.pressed)) delete g.pressed[k]; };
    });
    await page.mouse.click(480, 320, { button: 'right' });
    await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
    await page.keyboard.down('w'); await page.keyboard.down('Shift'); await page.evaluate(() => inputFrame());
    await page.mouse.down(); await page.evaluate(() => inputFrame()); await page.mouse.up();
    assert(await page.evaluate(() => __g.player.swing?.dashAttack), '実入力でダッシュ近接');
    await page.keyboard.up('w'); await page.keyboard.up('Shift');
    await page.evaluate(() => cancelFixture.recover());
    await page.keyboard.down('d'); await page.keyboard.down('Shift'); await page.evaluate(() => inputFrame());
    assert(await page.evaluate(() => __g.player.recoverT > .9 && !__g.player.dashT), '硬直開始直後の横Shiftは無効');
    await page.evaluate(() => { for (let i = 0; i < 40; i++) inputFrame(); });
    assert(await page.evaluate(() => __g.player.recoverT > 0 && !__g.player.dashT), 'Shift保持で0.3秒を越えても自動解除しない');
    await page.keyboard.up('Shift'); await page.keyboard.down('Shift'); await page.evaluate(() => inputFrame());
    assert(await page.evaluate(() => __g.player.recoverT === 0 && !__g.player.swing && __g.player.dashState === 'short' && __g.player.vel.x > 0), '新しい横Shift入力で解除と移動');
    const cd = await page.evaluate(() => __g.player.slots.aux.cd);
    await page.mouse.down(); await page.evaluate(() => inputFrame()); await page.mouse.up();
    assert(cd > 0 && await page.evaluate(() => !__g.player.swing), '解除直後も武器クールダウン中は再攻撃しない');
    await page.keyboard.up('d'); await page.keyboard.up('Shift');
    await page.evaluate(() => { cancelFixture.ready(); __g.player.onGround = true; __g.player.vel.set(0, 0, 0); });
    await page.keyboard.down('Space'); await page.evaluate(() => inputFrame()); await page.keyboard.up('Space');
    assert(await page.evaluate(() => __g.player.recoverT > 0 && !__g.player.dashT && __g.player.vel.y <= 0), 'Spaceでは解除しない');
    await page.evaluate(() => { cancelFixture.ready(); __g.player.yaw = Math.PI / 2; });
    await page.keyboard.down('a'); await page.keyboard.down('Shift'); await page.evaluate(() => inputFrame());
    assert(await page.evaluate(() => !__g.player.recoverT && __g.player.dashDir.z > .99), '回転した機体の左Shiftも正しい方向へ');
    await page.keyboard.up('a'); await page.keyboard.up('Shift');
    assert.deepEqual(errors, []);
    const output = { ...result, realInputs: 7, errors };
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks, weapons: result.weapons, rates: result.rates, realInputs: output.realInputs, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
