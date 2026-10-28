// 全頭部型：旧版と改修版の実際のraycast、被弾頂点、表示との差を比較する。
// node tools/test/mech_head_collision_check.js before after report.json
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('playwright');
(async () => {
  const [before, after, output] = process.argv.slice(2), results = [];
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    for (const dir of [before, after]) {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = undefined; });
      await page.route('https://**/*', r => r.fulfill({ body: '' }));
      await page.goto('file://' + path.resolve(dir, 'dbg.html'));
      results.push(await page.evaluate(async () => {
        const g = __g, T = g.T, rows = [], step = .025;
        const hash = async values => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Int32Array.from(values, v => Math.round(v * 1e5)))), x => x.toString(16).padStart(2, '0')).join('');
        const bounds = geo => { geo.computeBoundingBox(); return { min: geo.boundingBox.min.toArray(), max: geo.boundingBox.max.toArray(), size: geo.boundingBox.getSize(new T.Vector3()).toArray() }; };
        let rays = 0;
        for (const key of Object.keys(g.PARTS.head)) {
          const cfg = { head: key, body: 'standard', arms: 'standard', legs: 'standard' };
          const m = g.buildMech(g.TEAM.B.color, cfg), u = { ...m, group: m.g, pos: new T.Vector3(), vel: new T.Vector3(), alive: true, onGround: true, yaw: 0, pitch: 0, isPlayer: true, recoil: 0, cannonDeploy: 0, slots: Object.fromEntries(g.SLOTS.map(s => [s, g.slotOf(g.loadout.assault[s])])), weapon: 'main', mech: cfg, boost: 100 };
          const head = m.rig.meshes.find(e => e.mesh.userData.armorSlot === 'head').mesh;
          const collision = head.userData.hitGeometry || head.geometry, display = head.geometry;
          const row = { key, series: g.PARTS.head[key].series, armor: g.PARTS.head[key].armor, collisionBounds: bounds(collision), visibleBounds: bounds(display), collisionHash: await hash(collision.attributes.position.array), projections: {}, poses: [] };
          // 直立の正面・側面・上面を同じ2.5cm格子で投影。表示用メッシュへの直接raycastも併記。
          head.matrix.identity(); m.g.updateMatrixWorld(true);
          const caster = new T.Raycaster(), hits = [];
          for (const view of ['front', 'side', 'top']) {
            let hitCount = 0, visibleCount = 0, collisionOnly = 0, visibleOnly = 0;
            for (let a = -1.3 + step / 2; a < 1.3; a += step) for (let b = (view === 'top' ? -1.3 : 3.0) + step / 2; b < (view === 'top' ? 1.3 : 4.2); b += step) {
              if (view === 'front') caster.set(new T.Vector3(a, b, -10), new T.Vector3(0, 0, 1));
              else if (view === 'side') caster.set(new T.Vector3(-10, b, a), new T.Vector3(1, 0, 0));
              else caster.set(new T.Vector3(a, 10, b), new T.Vector3(0, -1, 0));
              hits.length = 0; head.raycast(caster, hits); const hit = hits.length > 0;
              hits.length = 0; T.Mesh.prototype.raycast.call(head, caster, hits); const shown = hits.length > 0;
              hitCount += hit; visibleCount += shown; collisionOnly += hit && !shown; visibleOnly += shown && !hit; rays += 2;
            }
            row.projections[view] = { collisionArea: hitCount * step * step, visibleArea: visibleCount * step * step, collisionOnlyArea: collisionOnly * step * step, visibleOnlyArea: visibleOnly * step * step };
          }
          for (const pose of ['idle', 'walk', 'crouch', 'air', 'dash', 'aim']) {
            Object.assign(u, { onGround: pose !== 'air', planted: pose === 'crouch', dashState: pose === 'dash' ? 'long' : '', pitch: pose === 'aim' ? .6 : 0 }); u.vel.set(0, 0, pose === 'walk' ? -5 : 0);
            for (let i = 0; i < 20; i++) { u.pos.z += u.vel.z / 60; g.weaponLook(u, 1/60); }
            m.g.position.set(7, 2, -4); m.g.rotation.y = .61; m.g.updateMatrixWorld(true);
            const values = [];
            for (const side of [false, true]) for (let a = -1.3 + step / 2; a < 1.3; a += step) for (let y = 2.5 + step / 2; y < 4.2; y += step) {
              const origin = side ? new T.Vector3(-10, y, a) : new T.Vector3(a, y, -10), direction = side ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
              caster.set(origin.applyMatrix4(m.g.matrixWorld), direction.transformDirection(m.g.matrixWorld)); hits.length = 0; head.raycast(caster, hits); hits.sort((a,b) => a.distance-b.distance);
              values.push(hits.length ? hits[0].distance : -1); rays++;
            }
            row.poses.push({ pose, rays: await hash(values), matrix: await hash(head.matrix.elements) });
          }
          rows.push(row); g.disposeMech(m.g);
        }
        return { step, rays, rows };
      }));
      assert.deepEqual(errors, []); await page.close();
    }
    const [old, current] = results;
    assert.equal(current.rows.length, old.rows.length);
    for (let i = 0; i < old.rows.length; i++) {
      const a = old.rows[i], b = current.rows[i];
      for (const key of ['key', 'series', 'armor', 'collisionBounds', 'collisionHash', 'poses']) assert.deepEqual(b[key], a[key], a.key + '/' + key);
      for (const view of ['front', 'side', 'top']) assert.equal(b.projections[view].collisionArea, a.projections[view].collisionArea, a.key + '/' + view);
    }
    const report = { passed: true, variants: current.rows.length, raysPerVersion: current.rays, gridStep: current.step, before: old.rows, after: current.rows };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, variants: report.variants, raysPerVersion: current.rays, series: current.rows.filter((r, i, all) => all.findIndex(a => a.series === r.series) === i).map(r => ({ series: r.series, collision: r.collisionBounds.size, visible: r.visibleBounds.size, front: r.projections.front })) }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
