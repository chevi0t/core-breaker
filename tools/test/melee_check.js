// 近接の吹き飛ぶ向き・上下の斬り・空振りの硬直（v0.21、#14）
// node tools/test/melee_check.js dbg  （python3 tools/test/make_dbg.py dbg で作った dbg/dbg.html を開く）
// 1. 横なぎ・回転斬りでよろけ・ダウンした相手は刃の進む向きへ飛び、突きはまっすぐ外へ飛ぶ（相手の装甲はBotの機体で変わる）
// 2. 宙に浮いた相手は、照準を上げた横なぎで当たり、水平の横なぎと回転斬りでは当たらない。上げすぎると地上の相手に当たらない
// 3. 全部の近接武器で、振りの見た目が戻る時と、次に動ける・振れる時がずれていない
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**fonts.g*/**', r => r.abort());
  await p.goto('file://' + path.resolve(process.argv[2] || 'dbg', 'dbg.html'));
  await p.evaluate(() => { __g.renderer.render = () => {}; __g.selectMap('mesa'); document.getElementById('start').click(); __g.running = false; });
  const r = await p.evaluate(() => {
    const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), out = { push: {}, tilt: {}, timing: [] };
    for (const q of g.units) { q.frozen = true; if (q !== u && q !== e) { q.alive = false; q.pos.set(10000, 0, 10000); } }
    for (const t of g.turrets) t.alive = false;
    const base = new T.Vector3(-40, 0, 60); base.y = g.terrainH(base.x, base.z);
    const swords = Object.entries(g.WEAPONS).filter(([, w]) => w.type === 'sword');
    // 近接武器 key を持たせ、相手を前方 dist m・足元の高さ lift に置いて1回振る。aim は照準の点（無ければ水平）
    const swing = (key, { dist = 3.5, lift = 0, strong = false, aim = null, side = 0 } = {}) => {
      g.equip(u, 'assault'); u.isPlayer = true; u.slots.aux = g.slotOf(key); g.selectWeapon(u, 'aux'); u.switchT = 0;
      Object.assign(u, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, yaw: 0, pitch: 0, swing: null, dashT: strong ? 0.2 : 0, longDash: false, lungeT: 0, recoverT: 0, stun: '' });
      Object.assign(e, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, yaw: Math.PI, stun: '', stunT: 0, repairing: false, ctrlLockT: 0, planted: false });
      u.pos.copy(base); u.vel.set(0, 0, 0); e.pos.set(base.x + side, base.y + lift, base.z - dist); e.vel.set(0, 0, 0);
      g.lock.target = null;
      const at = aim || new T.Vector3(base.x, base.y + 2.6 + (strong ? -0.6 : 0), base.z - 300);
      const hp = e.hp, sl = u.slots.aux;
      sl.cd = 0;
      g.swordTick(u, sl, 1 / 60, true, at);
      for (let i = 0; i < 400 && u.swing; i++) { g.swordTick(u, sl, 1 / 60, false, at); g.weaponLook(u, 1 / 60); }
      const v = Math.hypot(e.vel.x, e.vel.z);
      return { dmg: Math.round(hp - e.hp), stun: e.stun, dir: v > 0.1 ? [+(e.vel.x / v).toFixed(2), +(e.vel.z / v).toFixed(2)] : null };
    };
    const find = f => swords.find(([, w]) => f(w))?.[0];
    const sword = 'sword' in g.WEAPONS ? 'sword' : find(w => w.normal.spin === undefined && w.strong?.spin);
    const thrust = find(w => !w.normal.strikes && !w.meleeCharge && Math.abs(w.normal.to - w.normal.from) <= 20);
    // 1. 吹き飛ぶ向き。横なぎは左(+75度)から右(-75度)へ振るので、前の相手は右(+x)へ飛ぶ。前は -z
    out.push.slash = swing(sword);
    out.push.spin = swing(sword, { strong: true, dist: 4 });
    out.push.thrust = thrust ? { key: thrust, ...swing(thrust, { dist: 4 }) } : null;
    // 2. 上下の斬り。足元が3m（水平の刃2.6mの0.3m上より高い）の相手
    const up = new T.Vector3(base.x, base.y + 3 + 2, base.z - 3.5);
    out.tilt.level = swing(sword, { lift: 3 });
    out.tilt.up = swing(sword, { lift: 3, aim: up });
    out.tilt.spinUp = swing(sword, { lift: 3, strong: true, dist: 4, aim: up });
    out.tilt.tooHigh = swing(sword, { dist: 4.5, aim: new T.Vector3(base.x, base.y + 2.6 + 300 * Math.tan(Math.PI / 6), base.z - 300) });
    out.tilt.downOnGround = swing(sword, { aim: new T.Vector3(base.x, base.y, base.z - 3.5) });
    // 3. 見た目が戻る時（最後の振りの終わりから a.time までで構えに戻る）と、硬直が解ける時・次に振れる時（a.time）
    for (const [key, w] of swords) for (const kind of ['normal', 'strong']) {
      const a = w[kind]; if (!a) continue;
      const end = a.strikes ? a.windup + Math.max(...a.strikes.map(s => s.at + s.sweep)) : a.windup + a.sweep;
      const recoverEnd = a.recover ? a.windup + a.sweep + a.recover : 0;
      out.timing.push({ key, kind, end: +end.toFixed(3), recoverEnd: +recoverEnd.toFixed(3), time: a.time, ok: end <= a.time + 1e-6 && recoverEnd <= a.time + 1e-6 });
    }
    return out;
  });
  const bad = [];
  const P = r.push, Tt = r.tilt;
  if (!(P.slash.stun && P.slash.dir && P.slash.dir[0] > 0.7)) bad.push('横なぎで右へ飛ばない');
  if (!(P.spin.stun && P.spin.dir && Math.abs(P.spin.dir[0]) > 0.5)) bad.push('回転斬りで刃の進む向きへ飛ばない');
  if (P.thrust && P.thrust.dir && !(P.thrust.dir[1] < -0.9)) bad.push('突きがまっすぐ外へ飛ばない');
  if (Tt.level.dmg) bad.push('水平の横なぎが浮いた相手に当たった');
  if (!Tt.up.dmg) bad.push('照準を上げた横なぎが浮いた相手に当たらない');
  if (Tt.spinUp.dmg) bad.push('回転斬りが照準で上がった（ジャンプで避けられない）');
  if (Tt.tooHigh.dmg) bad.push('上げすぎた横なぎが地上の相手に当たった');
  if (!Tt.downOnGround.dmg) bad.push('下げた横なぎが前の地上の相手に当たらない');
  const late = r.timing.filter(t => !t.ok);
  if (late.length) bad.push('見た目と硬直がずれる：' + late.map(t => t.key + '.' + t.kind).join(', '));
  console.log(JSON.stringify({ push: P, tilt: Tt, timing: `${r.timing.length - late.length}/${r.timing.length} 一致` }, null, 1));
  await b.close();
  if (bad.length || errs.length) { console.log('失敗', JSON.stringify(bad), JSON.stringify(errs)); process.exit(1); }
  console.log('近接の吹き飛び・上下の斬り・硬直：成功。エラーなし');
})();
