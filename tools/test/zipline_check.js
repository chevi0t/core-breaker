// ジップライン（v0.21）：掴む・昇る・上で降りる・途中で手を離す・よろけで落ちる・Bot が使って高所のプラントへ着く
// node tools/test/zipline_check.js dbg  （python3 tools/test/make_dbg.py dbg で作った dbg/dbg.html を開く）
// 白煙循環区のリフトの場所をジップラインに置き換えたデータで試す（リフトは設備として残る）
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { openMap } = require('../mapgen_browser');
global.window = {};
require(path.resolve(__dirname, '../../prototype/maps/circulation.js'));
const base = window.MAP_DATA.circulation, data = { ...base, ziplines: base.ziplines || base.lifts };
delete data.lifts;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  let bad = [], r;
  try {
    const { page, errors } = await openMap(browser, 'circulation', data, 20261020);
    await page.click('#start');
    r = await page.evaluate(() => {
      const g = __g, T = g.T, dt = 0.05, u = g.player, out = {}, still = new T.Vector3();
      for (const v of g.units) { v.frozen = true; if (v !== u) v.pos.set(140, 0, 220 - v.idx * 8); }
      const reset = () => { Object.assign(u, { alive: true, stun: '', zip: null, zipCd: 0, planted: false, swing: null, transfer: null, repairing: false, ctrlLockT: 0, electricT: 0, invulT: 0, hp: 1e6, maxHp: 1e6, boost: 100, overheat: false, flying: false, dashT: 0, longDash: false }); u.vel.set(0, 0, 0); };
      const ride = (s, jump = false) => { for (let t = 0; t < s; t += dt) g.physics(u, still, false, jump && t + dt >= s, dt); };
      out.count = { ziplines: g.ziplines.length, lifts: g.lifts.length };
      const z = g.ziplines[0];
      // 1. 下の乗り場で掴んで上へ。降り場に跳び出して着地する
      reset(); u.pos.copy(z.bottom).add(new T.Vector3(1, 0, 1)); u.onGround = true;
      out.near = !!g.zipNear(u); out.grab = g.zipGrab(u);
      let t = 0; for (; u.zip && t < 5; t += dt) g.physics(u, still, false, false, dt);
      out.rideSeconds = +t.toFixed(2);
      for (let i = 0; i < 80 && !u.onGround; i++) g.physics(u, still, false, false, dt);
      out.top = { y: +u.pos.y.toFixed(2), topY: z.top.y, onGround: u.onGround };
      // 2. 途中で Space：手を離して跳ね、すぐには掴み直せない
      reset(); u.pos.copy(z.bottom); u.onGround = true; g.zipGrab(u); ride(0.3, true);
      out.jumpOff = { off: !u.zip, vy: +u.vel.y.toFixed(1), regrab: g.zipGrab(u) };
      // 3. よろけで落ちる
      reset(); u.pos.copy(z.bottom); u.onGround = true; g.zipGrab(u); ride(0.2);
      g.jolt(u, u.pos.clone().add(new T.Vector3(3, 0, 0)), 4000, false);
      out.jolt = { off: !u.zip, stun: u.stun };
      // 4. 構えている間・遠い所では掴めない
      reset(); u.pos.copy(z.bottom); u.onGround = true; u.planted = true; out.plantedGrab = g.zipGrab(u);
      reset(); u.pos.copy(z.bottom).add(new T.Vector3(8, 0, 8)); out.farNear = !!g.zipNear(u);
      // 5. 昇る間はダッシュできない
      reset(); u.pos.copy(z.bottom); u.onGround = true; g.zipGrab(u); out.dashOnZip = g.shortDash(u, new T.Vector3(1, 0, 0)); g.zipDrop(u, false);
      // 6. Bot が高所のプラントへジップラインで行く（ジャンプパッドより近い所に置く）
      const bots = [], high = g.plants.filter(p => p.pos.y > 5);
      for (const pl of high) for (const team of ['B', 'R']) {
        g.setup(); for (const v of g.units) { v.frozen = true; v.pos.set(140, 0, 220 - v.idx * 8); }
        for (const p of g.plants) { p.owner = team; p.gauge = team === 'B' ? 100 : -100; }
        pl.owner = null; pl.gauge = 0;
        const b = g.units.find(v => v.team === team && !v.isPlayer);
        const zl = g.ziplines.slice().sort((x, y) => x.top.distanceTo(pl.pos) - y.top.distanceTo(pl.pos))[0];
        g.equip(b, 'assault');
        b.pos.copy(zl.bottom).addScaledVector(zl.exit ? zl.exit.clone().negate() : new T.Vector3(1, 0, 0), 6); b.vel.set(0, 0, 0);
        Object.assign(b, { frozen: false, role: 'plant', onGround: true, stun: '', catCd: 0, target: null, zip: null, zipCd: 0 });
        const scene = b.group.parent; g.renderer.render = () => scene.updateMatrixWorld();
        let used = false, arrived = false, ticks = 0;
        for (; ticks < 800; ticks++) {
          g.loop(__advanceClock()); used ||= !!b.zip;
          if (used && b.onGround && Math.abs(b.pos.y - pl.pos.y) < .5 && b.pos.distanceTo(pl.pos) < 30) { arrived = true; break; }
        }
        bots.push({ plant: pl.id, team, used, arrived, seconds: +(ticks * .05).toFixed(1), at: b.pos.toArray().map(v => +v.toFixed(1)) });
      }
      out.bots = bots;
      return out;
    });
    if (errors.length) bad.push('エラー：' + errors.join(' / '));
  } finally { await browser.close(); }
  if (!(r.count.ziplines === 3 && r.count.lifts === 0)) bad.push('ジップラインが3本作られない');
  if (!(r.near && r.grab)) bad.push('下の乗り場で掴めない');
  if (!(r.rideSeconds > 0.5 && r.rideSeconds < 2.5)) bad.push('昇る時間が変 ' + r.rideSeconds);
  if (!(r.top.onGround && r.top.y > r.top.topY - 1)) bad.push('上の降り場に着地しない ' + JSON.stringify(r.top));
  if (!(r.jumpOff.off && r.jumpOff.vy > 0 && !r.jumpOff.regrab)) bad.push('途中で手を離せない・すぐ掴み直せる');
  if (!(r.jolt.off && r.jolt.stun === 'stagger')) bad.push('よろけで落ちない');
  if (r.plantedGrab || r.farNear || r.dashOnZip) bad.push('掴めない時に掴める・昇る間にダッシュできる');
  const lost = r.bots.filter(b => !(b.used && b.arrived));
  if (!r.bots.length || lost.length) bad.push('Bot がジップラインで高所へ着かない ' + JSON.stringify(lost));
  console.log(JSON.stringify(r, null, 1));
  if (bad.length) { console.log('失敗', JSON.stringify(bad)); process.exit(1); }
  console.log('ジップライン：成功。エラーなし');
})().catch(e => { console.error(e); process.exitCode = 1; });
