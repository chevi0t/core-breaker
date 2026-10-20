// 壁に張り付いて撃っても壁の向こうへ弾が出ないこと（v0.20 の muzzleClamp）
// node tools/test/muzzle_wall_check.js dbg  （python3 tools/test/make_dbg.py dbg で作った dbg/dbg.html を開く）
// 前に壁を置き、その向こうの敵を各兵装の主武器で20発撃つ。敵へのダメージが0で、開けた所では銃口が動かないこと
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
    const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), scene = u.group.parent, out = [];
    for (const q of g.units) { q.frozen = true; if (q !== u && q !== e) { q.alive = false; q.pos.set(10000, 0, 10000); } }
    for (const t of g.turrets) t.alive = false;
    const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.rotation.y = q.yaw || 0; } scene.updateMatrixWorld(true); };
    const base = new T.Vector3(-40, 0, 60); base.y = g.terrainH(base.x, base.z);
    // 前（-z）に厚さ0.6mの壁。機体の中心から壁の手前の面まで1.4m（胴の半径1.3mのすぐ外）
    const wall = new T.Mesh(new T.BoxGeometry(12, 10, 0.6), new T.MeshBasicMaterial());
    wall.position.set(base.x, base.y + 5, base.z - 1.4 - 0.3); scene.add(wall); g.hittables.push(wall);
    const results = {};
    for (const [cls, main] of [['assault', null], ['heavy', null], ['raid', null], ['support', null]]) {
      g.equip(u, cls); u.isPlayer = true; g.selectWeapon(u, 'main'); u.switchT = 0;
      Object.assign(u, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, yaw: 0, pitch: 0, recoil: 0 });
      Object.assign(e, { alive: true, hp: 1e6, maxHp: 1e6, invulT: 0, yaw: Math.PI });
      u.pos.copy(base); e.pos.set(base.x, base.y, base.z - 8);
      g.weaponLook(u, 0.01); g.mechPose && g.mechPose(u, 0); sync();
      const raw = g.muzzle(u, false, false), m = g.muzzle(u);
      const aim = e.pos.clone().add(new T.Vector3(0, 2.4, 0)), hp = e.hp;
      let hits = 0;
      for (let i = 0; i < 20; i++) g.fire(u, aim, 0, { dmg: 100, range: 400 });
      results[cls] = { weapon: u.slots.main.w.name, rawZ: +(raw.z - base.z).toFixed(2), clampedZ: +(m.z - base.z).toFixed(2), wallFace: -1.4, enemyDamage: hp - e.hp };
    }
    // 開けた所では銃口は動かない
    scene.remove(wall); g.hittables.splice(g.hittables.indexOf(wall), 1); sync();
    const raw = g.muzzle(u, false, false), m = g.muzzle(u);
    results.open = { same: raw.distanceTo(m) < 1e-9 };
    return results;
  });
  console.log(JSON.stringify(r, null, 1));
  const bad = Object.entries(r).filter(([k, v]) => k === 'open' ? !v.same : v.enemyDamage !== 0);
  await b.close();
  if (bad.length || errs.length) { console.log('失敗', JSON.stringify(bad), JSON.stringify(errs)); process.exit(1); }
  console.log('壁越しの射撃なし・開けた所の銃口は同じ：成功。エラーなし');
})();
