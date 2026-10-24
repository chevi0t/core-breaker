// 索敵装備の実際の走査からパルスが出て、索敵性能や射線へ影響しないことを確かめる。
// python3 tools/test/make_dbg.py dbg && node tools/test/recon_pulse_check.js dbg [画像出力先]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const out = path.resolve(process.argv[3] || 'dbg/recon-pulse'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg', 'dbg.html')).href);
    await page.evaluate(() => {
      const g = __g, T = g.T, checks = [];
      g.selectMap('city'); g.setup(); g.running = true; document.getElementById('overlay').hidden = true;
      const u = g.player, ally = g.units.find(q => q.team === u.team && q !== u), enemies = g.units.filter(q => q.team !== u.team), e = enemies[0], e2 = enemies[1];
      const yes = (v, m) => { if (!v) throw Error(m); checks.push(m); };
      const sync = () => { for (const q of g.units) { q.group.position.copy(q.pos); q.group.rotation.y = q.yaw || 0; q.group.visible = q.alive; } g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true); };
      function reset() {
        g.clearGadgets();
        for (const q of g.units) { q.alive = q === u; q.frozen = true; q.downT = 0; q.vel.set(0, 0, 0); }
        for (const q of g.turrets) q.alive = false;
        g.equip(u, 'support');
        Object.assign(u, { alive: true, weapon: 'main', switchT: 0, repairing: false, transfer: null, jamT: 0, stun: '', yaw: 0, pitch: 0, onGround: false, invulT: 0, planted: false, radarHeading: null });
        u.pos.set(0, 120, 0); g.updateCamera(u, 0); sync();
      }
      function place(key = 'sensor', at = new T.Vector3(0, 120, -10), spec = g.WEAPONS[key].proj) {
        g.placeGadget({ owner: u, team: u.team, spec, vel: new T.Vector3(0, 0, -1), weaponName: g.WEAPONS[key].name }, at, null);
        sync(); return g.gadgets[g.gadgets.length - 1];
      }
      function equipRadar(key = 'radarTool', source = u) {
        g.equip(source, 'raid'); source.slots.aux = g.slotOf(key); source.weapon = 'main'; g.selectWeapon(source, 'aux'); source.switchT = 0;
        g.weaponLook(source, .01); sync(); return source.slots.aux;
      }
      function points() {
        const out = [], matrix = new T.Matrix4(), v = new T.Vector3();
        for (const mesh of g.reconPulseBatches.values()) {
          if (!mesh.visible) continue;
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
            for (let j = 0; j < mesh.geometry.attributes.position.count; j++) out.push(v.fromBufferAttribute(mesh.geometry.attributes.position, j).applyMatrix4(matrix).clone());
          }
        }
        return out;
      }
      const instances = () => [...g.reconPulseBatches.values()].reduce((n, m) => n + (m.visible ? m.count : 0), 0);
      window.reconTest = { g, T, u, e, e2, yes, checks, sync, reset, place, equipRadar, points, instances };
      reset();
      const gd = place(), hitRefs = g.hittables.slice(), random = Math.random;
      Math.random = () => { throw Error('パルスの生成・更新がゲーム用乱数を消費した'); };
      try { g.gadgetUpdate(.01); g.reconPulseUpdate(.25); } finally { Math.random = random; }
      yes(g.reconPulses.length === 1 && g.reconPulses[0].source === gd && g.reconPulses[0].mode === 'radial', '敵がいなくても通常センサーの実走査から全周パルス');
      yes(g.hittables.length === hitRefs.length && hitRefs.every((m, i) => g.hittables[i] === m), 'パルスの生成・更新は乱数と当たり判定を追加しない');
      yes(instances() >= 2 && instances() <= 3, '一回のパルスで短い波が順に広がる');
      for (let i = 0; i < 4; i++) g.gadgetUpdate(.25);
      yes(g.reconPulses.length === 1, '走査ごとにパルスを増やさず間引く');
      g.reconPulseUpdate(.14); sync();
      const radial = points(), delta = radial.map(p => p.clone().sub(gd.mesh.position));
      yes(radial.length > 0 && Math.max(...delta.map(p => Math.hypot(p.x, p.z))) <= 3.01 && Math.max(...delta.map(p => Math.hypot(p.x, p.z))) > 2.5, '全周パルスは約3mまで広がる');
      yes(delta.some(p => p.x > 1) && delta.some(p => p.x < -1) && delta.some(p => p.z > 1) && delta.some(p => p.z < -1), '全周型は前後左右へ広がる');
      g.reconPulseUpdate(.22); yes(!g.reconPulses.length && instances() === 0, '短いパルスは寿命で消える');
      g.reconPulseUpdate(.2); gd.scanT = 0; g.gadgetUpdate(.01); yes(g.reconPulses.length === 1, '次の走査周期で再びパルスを出す');
      g.removeGadget(gd); g.reconPulseUpdate(0); yes(!g.reconPulses.length, 'センサーを壊すと残っているパルスも消える');

      reset(); const fan = place('fansensor');
      e.alive = e2.alive = true; e.pos.copy(fan.pos).z -= 30; e2.pos.copy(fan.pos).z += 30; sync();
      g.gadgetUpdate(.01); g.reconPulseUpdate(.39); sync();
      yes(g.reconPulses[0]?.mode === 'fan' && g.reconPulses[0]?.arc === fan.spec.cone, '扇形センサーは実際の索敵角度を使う');
      const arcPoints = points().map(p => p.clone().sub(fan.mesh.position));
      yes(arcPoints.length > 0 && arcPoints.every(p => -p.z >= -.001 && Math.abs(Math.atan2(p.x, -p.z)) <= fan.spec.cone * Math.PI / 360 + .001), '扇形の波は後ろへ出ず前方の索敵角に収まる');
      yes(g.spotted[u.team].has(e) && !g.spotted[u.team].has(e2), '扇形の敵検出は以前どおり前方だけ');
      fan.dir.set(-1, 0, 0); fan.mesh.rotation.y = Math.PI / 2; g.reconPulseUpdate(0); sync();
      yes(points().every(p => p.x - fan.mesh.position.x <= .001), '向きの変更にパルスの扇形も追従');

      reset(); const col = place('airsensor'); g.gadgetUpdate(.01); g.reconPulseUpdate(.39); sync();
      yes(g.reconPulses[0]?.mode === 'down', '滞空センサーは下向きの波を出す');
      const down = points().map(p => p.clone().sub(col.mesh.position));
      yes(down.length > 0 && down.every(p => p.y <= .1 && p.length() < 3.4) && down.some(p => p.y < -2), '下向きのパルスは機器から約3m以内');

      reset(); const plane = place('planeSensor'); g.planarSensorTick(plane); g.reconPulseUpdate(.3); sync();
      yes(g.reconPulses[0]?.mode === 'plane', '索敵カーテンは円盤面のパルス');
      const planePoints = points().map(p => p.clone().sub(plane.mesh.position));
      yes(planePoints.length > 0 && planePoints.every(p => Math.abs(p.dot(plane.dir)) < .2) && planePoints.some(p => Math.abs(p.y) > 1), 'カーテンの波は進行方向ではなく鉛直索敵面に広がる');

      for (const key of ['radarTool', 'radarToolW', 'radarToolA']) {
        reset(); const sl = equipRadar(key);
        e.alive = e2.alive = true; e.pos.copy(u.pos).z -= 100; e2.pos.copy(u.pos).z += 100; sync();
        g.radarToolTick(u, sl, sl.w.expand + .01, true); g.reconPulseUpdate(.25); sync();
        yes(g.reconPulses.length === 1 && g.reconPulses[0].source === u && g.reconPulses[0].arc === sl.w.arc, key + 'の展開中は装備の角度に合うパルス');
        yes(g.spotted[u.team].has(e) && g.spotted[u.team].has(e2) === (sl.w.arc === 360), key + 'の距離・方向の検出を維持');
        g.radarToolTick(u, sl, .01, false); g.reconPulseUpdate(0); yes(!g.reconPulses.length, key + 'を畳むと演出も止まる');
      }
      reset(); const sl = equipRadar(); g.radarToolTick(u, sl, .2, true); g.reconPulseUpdate(.2); g.selectWeapon(u, 'main'); g.reconPulseUpdate(0);
      yes(!g.reconPulses.length, 'レーダーからの持ち替えでも演出を残さない');

      reset(); e.alive = true; e.pos.copy(u.pos).z -= 30; e.electricT = 0; e.stun = ''; e.repairing = false; e.transfer = null;
      const concealedRadar = equipRadar('radarTool', e); e.cloak = true;
      g.radarToolTick(e, concealedRadar, .2, true); g.reconPulseUpdate(.2);
      yes(!g.reconPulses.length, '未発見の迷彩中の敵が携行するレーダーは位置を漏らさない');
      g.spot(u.team, e, 10, u, '試験'); concealedRadar.scanT = 0; g.radarToolTick(e, concealedRadar, .1, true); g.reconPulseUpdate(.2);
      yes(g.reconPulses.some(p => p.source === e), '発見済みの敵レーダーは迷彩中も表示する');
      g.spotted[u.team].delete(e); g.reconPulseUpdate(0);
      yes(!g.reconPulses.length, '敵が未発見の迷彩に戻れば既存パルスも消す');
      reset(); const ownRadar = equipRadar(); u.cloak = true; g.radarToolTick(u, ownRadar, .2, true); g.reconPulseUpdate(.2);
      yes(g.reconPulses.some(p => p.source === u), '自機は迷彩中もレーダーの作動を確認できる');
      reset(); ally.alive = true; ally.pos.copy(u.pos).x += 15; const allyRadar = equipRadar('radarTool', ally); ally.cloak = true;
      g.radarToolTick(ally, allyRadar, .2, true); g.reconPulseUpdate(.2);
      yes(g.reconPulses.some(p => p.source === ally), '味方のレーダーは未索敵の迷彩中も作動を表示する'); ally.cloak = false;
      reset(); u.cloak = true; const independentSensor = place(); g.gadgetUpdate(.01); g.reconPulseUpdate(.2);
      yes(g.reconPulses.some(p => p.source === independentSensor), '設置センサーは所有者の迷彩に左右されない'); u.cloak = false; e.cloak = false;

      reset(); g.launchDrone(u, g.WEAPONS.drone.drone); const drone = g.drones[0]; u.cloak = true;
      g.gadgetUpdate(.01); g.reconPulseUpdate(.25); sync();
      yes(g.reconPulses[0]?.source === drone && g.reconPulses[0]?.mode === 'down', '偵察機の実走査から所有者の迷彩に左右されず下向きのパルス');
      const before = points(); drone.pos.x += 12; drone.mesh.position.copy(drone.pos); g.reconPulseUpdate(0); sync(); const after = points();
      yes(after.length === before.length && after.every((p, i) => Math.abs(p.x - before[i].x - 12) < .001), '飛ぶ偵察機から波が離れず追従する');
      drone.flown = drone.spec.dist; g.gadgetUpdate(.01); g.reconPulseUpdate(0); yes(!g.reconPulses.length, '偵察機の退場でパルスを片付ける');

      reset(); const spec = { ...g.WEAPONS.sensor.proj, max: 100 };
      for (let i = 0; i < 64; i++) place('sensor', new T.Vector3((i % 8 - 4) * 3, 120, -10 - Math.floor(i / 8) * 3), spec);
      g.gadgetUpdate(.01); g.reconPulseUpdate(.25);
      yes(g.reconPulses.length > 0 && g.reconPulses.length <= 48 && instances() <= 144, '大量の装備でも同時パルスを48個以下に制限');
      yes([...g.reconPulseBatches.values()].every(m => m.isInstancedMesh && m.material.depthTest && !m.material.depthWrite && !g.hittables.includes(m)), 'まとめて描画し、壁の深度を守り、射線を遮らない');
      const batches = [...g.reconPulseBatches.values()].map(m => [m, m.geometry, m.material]); g.clearGadgets();
      yes(!g.reconPulses.length && instances() === 0, '試合リセットの設置物清掃で全演出を消す');
      for (let i = 0; i < 8; i++) { const q = place(); g.gadgetUpdate(.01); g.reconPulseUpdate(.25); g.clearGadgets(); }
      yes(batches.length === g.reconPulseBatches.size && batches.every(([m, geo, mat]) => [...g.reconPulseBatches.values()].includes(m) && m.geometry === geo && m.material === mat), '再配置でも描画資源が増殖しない');
      reset();
    });
    // 実地形上で装備別のパルスを撮る。カメラだけ検査用の見下ろし位置へ置く。
    await page.addStyleTag({ content: '#aimGauge,#cross,#scorePop{display:none!important}' });
    for (const [key, mode] of [['sensor', 'radial'], ['fansensor', 'fan'], ['drone', 'down']]) {
      await page.evaluate(({ key, mode }) => {
        const { g, T, u, reset, place, sync } = reconTest; reset();
        const x = -20, z = 135, y = g.terrainH(x, z);
        u.pos.set(x, y, z + 8); u.yaw = 0;
        if (key === 'drone') {
          g.launchDrone(u, g.WEAPONS.drone.drone); const d = g.drones[0]; d.pos.set(x, y + 5, z); d.y0 = y + 5; d.t = d.spec.hover; d.mesh.position.copy(d.pos); d.dir.set(0, 0, 0);
        } else place(key, new T.Vector3(x, y, z));
        g.gadgetUpdate(.01); g.reconPulseUpdate(.29); sync();
        g.camera.position.set(x + 9, y + 11, z + 12); g.camera.lookAt(x, y + (mode === 'down' ? 3 : .3), z); g.camera.updateMatrixWorld(true);
        g.renderer.render(g.scene, g.camera);
      }, { key, mode });
      await page.screenshot({ path: path.join(out, mode + '.png') });
    }
    assert.deepEqual(errors, []);
    const result = { checks: await page.evaluate(() => reconTest.checks), errors };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ checks: result.checks.length, errors, screenshots: out }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
