// リペアフィールド全3型の蘇生・SP・Botの接近と起動・従来の修理装備を実処理で確認する。
// python3 tools/test/make_dbg.py dbg/repair-field && node tools/test/repair_field_revive_check.js dbg/repair-field
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/repair-field');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.stack));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.abort());
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const checks = await p.evaluate(() => {
      const g = __g, T = g.T, out = [], yes = (v, name) => { if (!v) throw Error(name); out.push(name); };
      const near = (a, b) => Math.abs(a - b) < 1e-5;
      g.selectMap('city'); document.getElementById('start').click(); g.running = false; g.renderer.render = () => {};
      const u = g.player, [a, b] = g.units.filter(q => q.team === u.team && q !== u), enemy = g.units.find(q => q.team !== u.team);
      // 同じ高さの平床で、地形と移動経路による差を除く。
      g.obstacles.push({ minX: -70, maxX: 70, minZ: -70, maxZ: 70, top: 100 });
      const sync = () => { for (const q of [u, a, b, enemy]) { q.group.position.copy(q.pos); q.group.visible = q.alive || q.downT > 0; } g.scene.updateMatrixWorld(true); };
      function reset(key = 'field') {
        for (const q of g.units) { q.alive = false; q.downT = 0; q.group.visible = false; q.frozen = true; q.isPlayer = false; }
        for (const t of g.turrets) t.alive = false;
        for (const gd of g.gadgets.slice()) g.removeGadget(gd);
        u.isPlayer = true; g.loadout.support.sp = key; g.equip(u, 'support');
        for (const q of [u, a, b, enemy]) {
          Object.assign(q, { alive: true, hp: q.maxHp, invulT: 0, downT: 0, reviveAcc: 0, stun: '', tilt: 0,
            repairing: false, transfer: null, flying: false, ctrlLockT: 0, onGround: true, fieldOn: false,
            jamT: 0, electricT: 0, healing: false, planted: false, target: null, recoverT: 0, dashT: 0, longDash: false, catCd: 0 });
          q.vel.set(0, 0, 0);
        }
        u.pos.set(0, 100, 0); a.pos.set(3, 100, 0); b.pos.set(60, 100, 60); enemy.pos.set(60, 100, -60);
        u.fieldN = 0; sync(); return u.slots.sp;
      }
      const down = q => { q.alive = false; q.hp = 0; q.downT = 10; q.reviveAcc = 0; q.downYaw = q.yaw; q.group.visible = true; };
      function tickField(seconds) {
        for (let i = 0; i < Math.round(seconds * 100); i++) {
          if (a.downT > 0) g.downTick(a, .01);
          g.fieldTick(u, u.slots.sp, .01);
        }
      }
      for (const key of ['field', 'fieldW', 'fieldG']) {
        const sl = reset(key); down(a); g.toggleSp(u); g.fieldTick(u, sl, .1);
        yes(near(a.reviveAcc, sl.w.heal * .1), key + '：行動不能の味方に毎秒の修復量を加算');
        yes(!a.alive && a.hp === 0 && u.fieldN === 1, key + '：蘇生準備中の味方を回復対象数に含める');
        yes(near(sl.heat, 100 - 100 / sl.w.use * 1.5 * .1), key + '：蘇生中も味方1機ぶんのSPを消費');
        const ticks = Math.ceil(3000 / sl.w.heal * 100);
        sl.heat = 100; a.reviveAcc = 0; tickField((ticks - 1) / 100);
        yes(!a.alive, key + '：修復量3000未満では起きない');
        const revives = u.sc.support, hpCore = g.cores[u.team].hp; tickField(.01);
        yes(a.alive && a.downT === 0 && near(a.hp, a.maxHp * .3) && a.invulT === 3, key + '：3000で耐久3割・無敵3秒の蘇生');
        yes(u.sc.support === revives + g.SC.revive && g.cores[u.team].hp === hpCore, key + '：蘇生スコアを加算し、大破のコア損失は出さない');
      }
      {
        const sl = reset(); down(a); g.fieldTick(u, sl, .1); yes(a.reviveAcc === 0, '起動していないフィールドは蘇生しない');
        u.fieldOn = true; a.pos.x = sl.w.radius + .01; g.fieldTick(u, sl, .1); yes(a.reviveAcc === 0, '半径の外は蘇生しない');
        a.pos.x = sl.w.radius; g.fieldTick(u, sl, .1); yes(a.reviveAcc > 0, '半径の境界内は蘇生対象');
      }
      {
        const sl = reset(); down(a); a.downT = 0; down(enemy); enemy.pos.set(2, 100, 0); u.fieldOn = true;
        g.fieldTick(u, sl, 1); yes(a.reviveAcc === 0 && enemy.reviveAcc === 0, '大破済み・敵軍の行動不能機は対象外');
      }
      {
        const sl = reset(); u.hp -= 1000; a.hp -= 1000; const score = u.sc.support; u.fieldOn = true;
        g.fieldTick(u, sl, .1);
        yes(near(u.maxHp - u.hp, 900) && near(a.maxHp - a.hp, 900), '生存中の自機と味方の修理速度は維持');
        yes(near(sl.heat, 99.7) && u.fieldN === 1 && u.sc.support === score, '自己修理で味方の人数/SP消費/修理スコアを増やさない');
      }
      {
        const sl = reset(); down(a); down(b); b.pos.set(5, 100, 0); u.fieldOn = true;
        g.fieldTick(u, sl, .1);
        yes(a.reviveAcc === 100 && b.reviveAcc === 100 && u.fieldN === 2 && near(sl.heat, 99.6), '2機を同時に蘇生し、2機ぶんの追加SPを消費');
      }
      for (const state of ['overheat', 'dead', 'pod']) {
        const sl = reset(); down(a); u.fieldOn = true;
        if (state === 'overheat') { sl.overheat = true; sl.heat = 0; }
        if (state === 'dead') u.alive = false;
        if (state === 'pod') u.repairing = true;
        g.fieldTick(u, sl, .1);
        yes(!u.fieldOn && a.reviveAcc === 0, state + '：フィールドを停止して蘇生しない');
      }
      {
        const sl = reset(); u.slots.sp.heat = 100; g.kill(a, enemy, false, 1000);
        yes(a.downT === 10 && g.canRevive(u), 'フィールド持ちがいればBotの蘇生待機は1秒に短縮されない');
        g.downTick(a, .1); yes(a.downT > 9, '未起動でも蘇生可能なフィールド持ちを待つ');
        sl.overheat = true; sl.heat = 0; g.downTick(a, .1); yes(a.downT <= 1, '過熱して起こせない場合は待機を短縮する');
      }
      {
        reset(); g.kill(a, enemy, false, 1000); u.repairing = true; g.downTick(a, .1);
        yes(!g.canRevive(u) && a.downT <= 1, 'ポッド利用中のフィールド持ちを蘇生待ちの相手にしない');
      }
      {
        const sl = reset(); down(a); u.slots.sp.heat = 100; g.botAct(u, false, g.cores.R);
        yes(u.fieldOn, 'Botは生存者が無傷でも行動不能の味方にフィールドを起動');
        g.fieldTick(u, sl, .1); yes(a.reviveAcc === 100, 'Botの起動したフィールドが実際に蘇生を進める');
      }
      {
        const sl = reset('fieldG'); down(a); a.pos.set(14, 100, 0); sync();
        u.isPlayer = false; u.frozen = false; u.think = 0; u.actCd = 0; u.sideT = 0; u.waypoint = null; u.target = null;
        const before = u.pos.distanceTo(a.pos);
        for (let i = 0; i < 800 && !a.alive; i++) {
          if (a.downT > 0) g.downTick(a, .01);
          g.botUpdate(u, .01); sync();
        }
        yes(u.pos.distanceTo(a.pos) < before && u.pos.distanceTo(a.pos) < sl.w.radius, '狭い9m型でもBotが範囲内まで接近');
        yes(a.alive, 'Botが接近・起動・修復3000まで行い実際に蘇生'); u.frozen = true;
      }
      {
        reset('repairPost'); down(a); const sl = u.slots.sp;
        g.postFieldTick({ owner: u, team: u.team, pos: u.pos.clone(), spec: sl.w, field: { visible: true } }, 3000 / sl.w.heal);
        yes(a.alive && near(a.hp, a.maxHp * .3), '従来のリペアビーコンによる蘇生を維持');
      }
      {
        reset('repair'); down(a); u.pos.z = 8; sync();
        g.repairTick(u, u.slots.sp, 3000 / u.slots.sp.w.heal, true, g.targetPoint(a), false);
        yes(a.alive && near(a.hp, a.maxHp * .3), '従来のリペアユニットによる蘇生を維持');
      }
      return out;
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(dir, 'repair-field-revive-check.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + '\n');
    console.log(checks.map(s => '成功: ' + s).join('\n')); console.log(`成功: ${checks.length}項目・実行エラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
