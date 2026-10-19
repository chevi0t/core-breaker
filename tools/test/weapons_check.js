// 使い方: python3 tools/test/make_dbg.py <dir> で作ったデバッグ版に対して node tools/test/weapons_check.js <dir>（ONLY=ar,sniper で絞れる）
// v0.11 武器48種を1つずつ試す：撃つ役（青のBot、止めて weaponsTick を直接呼ぶ）と的（赤、止める）を港の倉庫街に置いて、
// ダメージ・設置物・索敵・SP・崩れを数える
const path = require('path');
let chromium; // Playwright：普通に入っていればそれを、無ければこの環境の場所から
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  p.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**fonts.g*/**', r => r.abort());
  await p.goto('file://' + path.resolve(dir, 'dbg.html'));
  await p.evaluate(() => { __g.renderer.render = () => { const u=__g.units[0]; if(u)u.group.parent.updateMatrixWorld(); }; });
  const E = (fn, a) => p.evaluate(fn, a);
  await E(() => __g.selectMap(location.hash.slice(1) || 'dock'));
  await p.evaluate(() => document.getElementById('start').click());
  await p.waitForTimeout(500);
  await E(() => {
    const g = __g; { const sc = g.units[0].group.parent; g.renderer.render = () => sc.updateMatrixWorld(); }
    for (const tu of g.turrets) tu.alive = false;
    g.timeLeft = 1e5;
    const sh = g.units.find(u => !u.isPlayer && u.team === 'B'), tg = g.units.find(u => u.team === 'R'), al = g.player;
    for (const u of g.units) { u.frozen = true; }
    al.isPlayer = false; // 味方役（プレイヤーも止める）
    window.__T = { sh, tg, al };
  });
  // 的までの見通しの良い場所を探す
  const spot = await E(() => {
    const g = __g, T = g.T;
    for (let z = -60; z <= 60; z += 6) for (let x = -50; x <= 50; x += 6) {
      const y = g.terrainH(x, z), from = new T.Vector3(x, y + 3, z);
      let ok = true;
      for (const d of [5, 15, 25, 40]) {
        const to = new T.Vector3(x, g.terrainH(x, z - d) + 2.4, z - d);
        if (Math.abs(g.terrainH(x, z - d) - y) > 0.3) { ok = false; break; }
        const dir = to.clone().sub(from), dist = dir.length();
        const h = g.castFrom(from, dir.normalize(), null, dist);
        if (h && h.dist < dist - 0.5) { ok = false; break; }
      }
      if (ok && g.clearPath(x, z, x, z - 40, y)) return [x, z];
    }
    return null;
  });
  console.log('場所', spot);
  const results = [];
  const list = await E(() => Object.entries(__g.ARMORY).flatMap(([c, s]) => Object.entries(s).flatMap(([k, ws]) => ws.map(w => [c, k, w]))));
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [cls, slot, key] of list) {
    if (only.length && !only.includes(key)) continue;
    const r = await E(async ([cls, slot, key, spot, dbgPos]) => {
      const g = __g, T = g.T, { sh, tg, al } = __T, w = g.WEAPONS[key];
      // 装備（Botは本来ランダムなので、プレイヤー扱いにして loadout から）
      g.loadout[cls][slot] = key;
      sh.isPlayer = true; g.equip(sh, cls); sh.isPlayer = false;
      const P = w.proj || {};
      const near = w.type === 'artillery' ? 60 : w.type === 'sword' ? (key === 'spear' ? 6 : 4) : w.pellets ? 10 : P.kind === 'sentry' ? 20 : w.type === 'cannon' ? 40 : 18;
      const y = g.terrainH(spot[0], spot[1]);
      Object.assign(sh, { alive: true, hp: sh.maxHp, stun: '', invulT: 0, cloak: false, chargerOn: false, fieldOn: false, swing: null, weapon: slot, switchT: 0, planted: !!w.plant, yaw: 0 });
      sh.pos.set(spot[0], y, spot[1]); sh.vel.set(0, 0, 0);
      Object.assign(tg, { alive: true, hp: 1e6, maxHp: 1e6, stun: '', invulT: 0, cloak: false, weakT: 0, swing: null, vis: 1 });
      tg.pos.set(spot[0], y, spot[1] - near); tg.vel.set(0, 0, 0); tg.group.visible = true;
      Object.assign(al, { alive: true, hp: 3000, maxHp: 10000, stun: '', invulT: 0 });
      al.pos.set(spot[0] + 5, y, spot[1] + 1); al.group.visible = true;
      for (const gd of g.gadgets.slice()) g.damage(gd, null, 1e9); // 前の試しの設置物を壊す
      g.spotted.R.clear(); g.spotted.B.clear();
      for (const sh2 of g.shells.slice()) { sh2.mesh.parent && sh2.mesh.parent.remove(sh2.mesh); } g.shells.length = 0;
      const tp = () => new T.Vector3(tg.pos.x, tg.pos.y + 2.4, tg.pos.z);
      // 狙う点：設置物は的の手前の地面、ほかは的の胴体。回復は味方
      const ground = new T.Vector3(spot[0], y, spot[1] - (P.kind === 'sentry' ? 6 : P.hover ? 30 : near - 1));
      const aimAt = () => w.type === 'artillery' ? new T.Vector3(tg.pos.x,g.terrainH(tg.pos.x,tg.pos.z),tg.pos.z) : w.type === 'repairPost' ? new T.Vector3(spot[0],y,spot[1]-2) : w.type === 'repair' ? new T.Vector3(al.pos.x, al.pos.y + 2.4, al.pos.z) : P.kind === 'mine' || P.kind === 'remote' || P.kind === 'sentry' || (P.kind === 'sensor' && !P.hover) ? ground : P.hover ? ground : w.drone ? new T.Vector3(spot[0], y + 15, spot[1] - 40) : tp();
      const sp0 = sh.slots.sp.heat, sl = sh.slots[slot], ammo0 = sl.ammo + sl.reserve;
      let shots = 0, maxStun = '', fired = 0;
      if (['charger', 'camo', 'field', 'barrier', 'escort'].includes(w.type)) g.toggleSp(sh);
      const dt = 0.05, T0 = w.type === 'artillery' ? w.flight+(w.shots-1)*(w.interval||0)+2 : w.type === 'cannon' ? 8 : P.kind === 'sentry' ? 6 : 4;
      let det = false;
      for (let t = 0; t < T0; t += dt) {
        // 遠隔爆弾は2.5秒で起爆
        if (P.kind === 'remote' && t > 2.5 && !det) { det = true; g.detonateRemotes(sh); }
        // チャージ撃ち（v0.15）は満タンまで引いて離すのを繰り返す
        const trig = w.type === 'sword' ? t < 0.1 : P.kind === 'sentry' ? t < 0.3 : w.chargeTime ? t % (w.chargeTime + 0.25) < w.chargeTime + 0.1 : !(P.kind === 'remote' && t > 2) && !(['mine', 'sensor'].includes(P.kind) && t > 0.5);
        const before = sl.ammo;
        g.weaponsTick(sh, dt, trig, aimAt(), 0.006, false);
        if (sl.ammo < before) fired += before - sl.ammo;
        // 弾・設置物・偵察機は main ループ（止めていない）で進む。ここでは時間を流す
        // 世界を進める（ループの rAF を待つ）
        await new Promise(r => requestAnimationFrame(r));
        if (tg.stun && !maxStun) maxStun = tg.stun;
      }
      const dmg = Math.round(1e6 - tg.hp);
      return { key, name: w.name, type: w.type, fired: w.type === 'artillery' ? sh.artilleryFired : fired, ammoUsed: ammo0 - (sl.ammo + sl.reserve), dmg, stun: maxStun, weak: tg.weakT > 0,
        gadgets: g.gadgets.map(x => x.name + (x.pos.y - y > 1 ? `@${Math.round(x.pos.y - y)}m` : '') + (dbgPos ? `(${(x.pos.x - sh.pos.x).toFixed(1)},${(x.pos.z - sh.pos.z).toFixed(1)}) tg(${(tg.pos.x - sh.pos.x).toFixed(1)},${(tg.pos.z - sh.pos.z).toFixed(1)})` : '')).join(','), spotted: g.spotted.B.has(tg), drones: g.drones.length,
        sp: Math.round(sp0) + '→' + Math.round(sh.slots.sp.heat), on: [sh.chargerOn && 'charger', sh.cloak && 'cloak', sh.fieldOn && 'field', sh.barrierOn && 'barrier', sh.escortOn && 'escort'].filter(Boolean).join(''), allyHp: Math.round(al.hp) };
    }, [cls, slot, key, spot, !!process.env.ONLY]);
    results.push(r);
    console.log(`${cls}/${slot} ${r.key} ${r.name}: 発射${r.fired} 弾減${r.ammoUsed} ダメ${r.dmg}${r.stun ? ' 崩れ=' + r.stun : ''}${r.weak ? ' 弱化' : ''}${r.gadgets ? ' 設置=' + r.gadgets : ''}${r.spotted ? ' 索敵' : ''}${r.drones ? ' 偵察機' + r.drones : ''} SP${r.sp}${r.on ? ' 作動=' + r.on : ''} 味方HP${r.allyHp}`);
  }
  console.log('エラー', errs);
  await b.close();
  if (errs.length) throw new Error(errs.join('\n'));
})().catch(e => { console.error(e); process.exitCode = 1; });
