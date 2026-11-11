// 実ブラウザ2台。ゲストのC入力をホストで判定し、充填保持・解除後の発射を写真で同期する。
// node tools/test/online_stunner_charge_check.js dbg [出力先] [--mock-transport]
const { check } = require('./lib');
const { harness, room, frames, input, neutral, sleep, TRANSPORT_MODE } = require('./online_test_helpers');
check('オンライン格闘中のスタンガン充填', async ({ browser, dir, ok, errors }) => {
  const h = await harness(dir); let r;
  try {
    for (const [key, actionId, air, ratio] of [['stunner', 'tackle', false, .35], ['stunnerD', 'kick', false, 1], ['stunnerW', 'kick', true, .4]]) {
      const label = `${key} ${air ? '空中' : ''}${actionId}`;
      r = await room(browser, h, errors, { guests: 1, teamSize: 2, guestClasses: ['support'], beforeStart: async (host, [guest]) => {
        await guest.evaluate(({ key, actionId }) => {
          const e = CBOnlineGame.state.equipment;
          CBOnlineGame.setEquipment({ ...e, cls: 'support', actionId, loadout: { ...e.loadout, aux: key },
            loadouts: { ...e.loadouts, support: { ...e.loadouts.support, aux: key } } });
        }, { key, actionId });
        await sleep(100);
      } });
      const guest = r.guests[0], held = { ...neutral, trigger: true, yaw: 0, pitch: 0, aimPoint: [0, 202, -40] };
      await input(r.host, neutral); await input(guest, held); await frames(r.pages, 5);
      await r.host.evaluate(({ air, ratio }) => {
        const g = __g, u = g.units.find(u => u.controller === 'remoteHuman'); window.__actor = u;
        g.obstacles.splice(0, g.obstacles.length, { minX: -150, maxX: 150, minZ: -150, maxZ: 150, top: 200 }); g.waters.length = 0;
        for (const other of g.units) if (other !== u) { other.controller = 'remoteHuman'; other.controlInput = { keys: {}, pressed: {} }; other.pos.set(120, 200, 120); }
        g.resetLifeState(u);
        Object.assign(u, { alive: true, hp: u.maxHp, invulT: 0, boost: u.maxBoost, overheat: false,
          onGround: !air, yaw: 0, pitch: 0, switchT: 0, weapon: 'aux' });
        u.pos.set(0, air ? 230 : 200, 20); u.vel.set(0, 0, 0);
        const sl = u.slots.aux; sl.cd = 0; sl.chargeT = sl.w.chargeTime * ratio; sl.holdT = ratio === 1 ? 2 : 0;
        for (const f of g.stunFields.splice(0)) g.scene.remove(f.mesh);
      }, { air, ratio });
      ok(await r.host.evaluate(({ key, actionId }) => __actor.slots.aux.w.key === key && __actor.actionId === actionId, { key, actionId }), label + '：選択した装備がホストに届く');
      await input(guest, { ...held, keys: { KeyC: true }, pressed: { KeyC: true } });
      await frames([guest], 1, 1000 / 60); await input(guest, { ...held, keys: { KeyC: true } }); await sleep(60);
      let started = false;
      for (let i = 0; i < 20 && !started; i++) { await frames(r.pages, 1, 1000 / 60); await sleep(15); started = await r.host.evaluate(() => !!__actor.actionMove); }
      ok(started, label + '：ゲストのC入力でホストが格闘を開始');
      const saved = await r.host.evaluate(() => ({ charge: __actor.slots.aux.chargeT, hold: __actor.slots.aux.holdT }));
      ok(saved.charge > 0, label + '：開始時に充填が消えない');
      await sleep(80); await frames([guest], 3, 1000 / 60);
      ok(await guest.evaluate(s => Math.abs(__g.player.slots.aux.chargeT - s.charge) < .002 &&
        Math.abs(__g.player.slots.aux.holdT - s.hold) < .002 && !!__g.player.actionMove, saved), label + '：充填と保持時間・格闘姿勢をゲストへ同期');
      // 格闘中に左を離しても放電を出さず、後硬直まで充填を保持する。
      await input(guest, { ...neutral, yaw: 0, pitch: 0, aimPoint: [0, 202, -40] }); await frames([guest], 1, 1000 / 60); await sleep(60);
      let recovery = false, finished = false;
      for (let i = 0; i < 130; i++) {
        await frames(r.pages, 1, 1000 / 60);
        const state = await r.host.evaluate(() => ({ busy: __g.actionBusy(__actor), recovery: __actor.actionRecoverT,
          charge: __actor.slots.aux.chargeT, hold: __actor.slots.aux.holdT, fields: __g.stunFields.length }));
        if (!state.busy) { finished = true; break; }
        if (Math.abs(state.charge - saved.charge) > 1e-7 || Math.abs(state.hold - saved.hold) > 1e-7 || state.fields) throw Error(label + '：格闘中に充填変化か誤発射');
        if (!recovery && state.recovery > 0) {
          recovery = true; let synced = false;
          // 固定60Hzの技終了が30Hz写真の間に来た場合は、次の写真までホストも進める。
          for (let n = 0; n < 4 && !synced; n++) {
            await frames(r.pages, 1, 1000 / 60); await sleep(80); await frames([guest], 3, 1000 / 60);
            synced = await guest.evaluate(s => __g.player.actionRecoverT > 0 && Math.abs(__g.player.slots.aux.chargeT - s.charge) < .002, saved);
          }
          ok(synced, label + '：後硬直中も充填をゲストへ同期');
        }
      }
      ok(recovery && finished, label + '：左を離しても格闘と後硬直中は保存し、誤発射しない');
      const fired = await r.host.evaluate(() => {
        const sl = __actor.slots.aux, f = __g.stunFields[0];
        return { fields: __g.stunFields.length, damage: f?.dmg, charge: sl.chargeT, hold: sl.holdT, ammo: sl.ammo, stun: __actor.stun, pos: __actor.pos.toArray() };
      });
      const expected = await r.host.evaluate(s => { const w = __actor.slots.aux.w; return Math.round(w.stunField.dmg[0] + (w.stunField.dmg[1] - w.stunField.dmg[0]) * s.charge / w.chargeTime); }, saved);
      console.log(label + ' 発射確認', JSON.stringify({ saved, fired, expected }));
      ok(fired.fields === 1 && Math.abs(fired.damage - expected) < 1e-7 && fired.charge === 0 && fired.hold === 0 && fired.ammo === 1,
        label + '：ホストで硬直終了後に保存した充填量の1発だけを確定');
      await frames(r.pages, 4, 1000 / 60); await sleep(80); await frames([guest], 3, 1000 / 60);
      ok(await guest.evaluate(() => __g.player.slots.aux.chargeT === 0 && __g.player.slots.aux.holdT === 0 && __g.player.slots.aux.ammo === 1), label + '：発射後の充填消費もゲストへ同期');
      await r.close(); r = null;
    }
    console.log('通信方式：' + TRANSPORT_MODE);
  } finally { await r?.close().catch(() => {}); await h.close(); }
}, { page: false });
