// プラズマ砲と蓄圧砲の色・視認性・砲口の輪と、弾道/狙撃銃の継承を実射で確認する。
// node tools/test/plasma_visual_check.js dbg/projectile-visibility-after dbg/projectile-visibility-before media/plasma-visual
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const after = path.resolve(process.argv[2]), before = path.resolve(process.argv[3]), out = path.resolve(process.argv[4] || 'media/plasma-visual');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const errors = [], checks = [];
  const yes = (ok, label) => { assert.ok(ok, label); checks.push(label); };
  try {
    fs.mkdirSync(out, { recursive: true });
    async function sample(dir, version) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await p.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
      await p.goto('file://' + path.join(dir, 'dbg.html'));
      const data = await p.evaluate(() => {
        const g = __g, T = g.T, u = (g.selectMap('dock'), document.getElementById('start').click(), g.player);
        g.running = false;
        const clear = () => { for (const s of g.shells) s.mesh.parent?.remove(s.mesh); g.shells.length = 0; g.fxUpdate(10); };
        function reset(key = 'plasma', team = 'B') {
          clear(); for (const v of g.units) { v.frozen = true; v.alive = false; v.group.visible = false; }
          Object.assign(u.mech, g.MECH_DEFAULT); g.equip(u, 'heavy'); u.slots.sub = g.slotOf(key);
          Object.assign(u, { team, isPlayer: true, alive: true, weapon: 'sub', switchT: 0, yaw: 0, pitch: 0, invulT: 0, stun: '', recoil: 0, cameraRecoil: 0, recoilYaw: 0, cameraRecoilYaw: 0 });
          u.pos.set(0, 200, 0); u.vel.set(0, 0, 0); u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); u.group.visible = true;
          Object.assign(g.lock, { target: null, cand: null, visible: false });
          g.weaponLook(u, 0); g.scene.updateMatrixWorld(true); g.updateCamera(u, .016);
          return g.muzzle(u);
        }
        const keys = Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].series === 'lp'), cases = [];
        for (const team of ['B', 'R']) for (const key of keys) {
          const from = reset(key, team); g.shot(u, u.slots.sub, from.clone().add(new T.Vector3(0, 0, -300)), 0);
          const sh = g.shells[0], ring = g.fx.find(f => f.kind === 'plasmaRing');
          const start = { from: sh.pos.toArray(), velocity: sh.vel.toArray(), life: sh.life, spec: sh.spec };
          g.shellUpdate(.1); g.fxUpdate(.04); g.scene.updateMatrixWorld(true);
          const trail = sh.mesh.getObjectByName('plasmaTrail') || sh.mesh, head = sh.mesh.getObjectByName('plasmaHead');
          const visual = { pink: trail.material.color.getHex(), headRadius: head?.scale.x || 0, headAt: head ? head.getWorldPosition(new T.Vector3()).toArray() : null, width: trail.scale.x, tailLength: trail.scale.y, shapeShared: head?.geometry === sh.mesh.getObjectByName('plasmaHalo')?.geometry };
          const first = ring && { origin: ring.origin.toArray(), position: ring.obj.position.toArray(), radius: ring.obj.scale.x, opacity: ring.obj.material.opacity, color: ring.obj.material.color.getHex(), normalDot: new T.Vector3(0, 0, 1).applyQuaternion(ring.obj.quaternion).dot(sh.vel.clone().normalize()) };
          g.fxUpdate(.06); const later = ring && { radius: ring.obj.scale.x, opacity: ring.obj.material.opacity };
          g.fxUpdate(.3);
          cases.push({ key, team, start, position: sh.pos.toArray(), velocity: sh.vel.toArray(), life: sh.life, visual, ring: first || null, later: later || null, ringGone: ring ? !g.fx.includes(ring) && !ring.obj.parent : true });
        }
        const charges = [];
        for (const team of ['B','R']) for (const [key,w] of Object.entries(g.WEAPONS).filter(([,w]) => w.series === 'lq')) for (const fraction of [.1,.55,1]) {
          const from = reset(key,team), aim = from.clone().add(new T.Vector3(0,0,-300));
          for (let t = 0; t < w.chargeTime * fraction - 1e-8;) {
            const dt = Math.min(.01,w.chargeTime * fraction-t); g.weaponsTick(u,dt,true,aim,0); t += dt;
          }
          if (g.shells.length) throw new Error('蓄圧中に発射された');
          g.weaponsTick(u,.001,false,aim,0);
          const sh = g.shells[0];
          const start = {from:sh.pos.toArray(),velocity:sh.vel.toArray(),life:sh.life,spec:sh.spec,ammo:u.slots.sub.ammo};
          g.shellUpdate(.1); g.scene.updateMatrixWorld(true);
          const trail = sh.mesh.getObjectByName('chargeTrail') || sh.mesh, head = sh.mesh.getObjectByName('chargeHead');
          charges.push({key,team,fraction,start,position:sh.pos.toArray(),velocity:sh.vel.toArray(),life:sh.life,visual:{color:trail.material.color.getHex(),headRadius:head?.scale.x||0,width:trail.scale.x,headAt:head?.getWorldPosition(new T.Vector3()).toArray()}});
        }
        // 光弾狙撃ライフル以外は元の表示を維持する。スコープ武器の煙を前後比較する。
        const sniper = [];
        for (const [key, w] of Object.entries(g.WEAPONS).filter(([, w]) => w.scope && w.series !== 'ln')) {
          reset(); const from = new T.Vector3(0, 202.5, 0); g.fire(u, new T.Vector3(0, 202.5, -180), 0, w, from); g.fxUpdate(.12);
          sniper.push({ key, smoke: g.fx.filter(f => f.kind === 'smoke').map(f => ({ life: f.life, scale: f.obj.scale.toArray(), opacity: f.obj.material.opacity, color: f.obj.material.color.getHex(), side: f.obj.material.side })) });
        }
        // 壁への接触と消滅も同じ本体の処理で確認する。
        const from = reset(), wall = new T.Mesh(new T.BoxGeometry(10, 10, .5), new T.MeshBasicMaterial());
        wall.position.set(from.x, from.y, -20); g.scene.add(wall); g.hittables.push(wall); wall.updateMatrixWorld(true);
        g.shot(u, u.slots.sub, from.clone().add(new T.Vector3(0, 0, -300)), 0); const mesh = g.shells[0].mesh;
        for (let i = 0; i < 5; i++) g.shellUpdate(.03);
        const wallGone = !g.shells.length && !mesh.parent;
        g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose(); clear();
        window.__plasmaVisualFixture = { reset };
        return { catalog: { weapons: g.WEAPONS, parts: g.PARTS, armory: g.ARMORY }, cases, charges, sniper, wallGone };
      });
      // 本体の実描画を、射手のカメラから撮る。前後で同じ位置・時間を使う。
      for (const [key,name,seconds] of [['plasma','ring',.07],['plasma','distant',.4],['plasma','far',1.2],['charge','charge-distant',.9],['charge','charge-far',2.4]]) {
        const capture = await p.evaluate(({key,seconds}) => {
          const g = __g, from = __plasmaVisualFixture.reset(key);
          g.shot(g.player, g.player.slots.sub, from.clone().add(new g.T.Vector3(0, 0, -300)), 0);
          g.shellUpdate(seconds); g.fxUpdate(seconds); g.scene.updateMatrixWorld(true); g.renderer.render(g.scene, g.camera);
          const sh = g.shells[0], at = sh.pos.clone().project(g.camera), gl = g.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const pixels = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const cx = Math.round((at.x + 1) * w / 2), cy = Math.round((at.y + 1) * h / 2); let pinkPixels = 0, greenPixels = 0;
          for (let y = Math.max(0, cy - 14); y <= Math.min(h - 1, cy + 14); y++) for (let x = Math.max(0, cx - 14); x <= Math.min(w - 1, cx + 14); x++) {
            const i = (y * w + x) * 4, [r, green, b] = pixels.subarray(i, i + 3);
            if (r > 130 && r > green * 1.25 && b > green * 1.1) pinkPixels++;
            if (green > 180 && green > r * 1.15 && green > b * 1.2) greenPixels++;
          }
          return { png: g.renderer.domElement.toDataURL('image/png'), pinkPixels, greenPixels, distance: sh.pos.distanceTo(g.camera.position) };
        }, {key,seconds});
        fs.writeFileSync(path.join(out, `${version}-${name}.png`), Buffer.from(capture.png.split(',')[1], 'base64'));
        data[name] = { pinkPixels: capture.pinkPixels, greenPixels: capture.greenPixels, distance: capture.distance };
      }
      await p.close(); return data;
    }
    const old = await sample(before, 'before'), now = await sample(after, 'after');
    assert.deepEqual(now.catalog, old.catalog); yes(true, '全武器・パーツの数値と装備順を維持');
    assert.deepEqual(now.sniper, old.sniper); yes(true, `狙撃銃${now.sniper.length}種の軌跡・色・太さ・残存時間を維持`);
    yes(now.cases.length === 8, 'プラズマ砲4型を敵味方で確認');
    for (const row of now.cases) {
      const prev = old.cases.find(s => s.key === row.key && s.team === row.team), label = row.team + '/' + row.key;
      assert.deepEqual(row.start, prev.start); assert.deepEqual(row.position, prev.position); assert.deepEqual(row.velocity, prev.velocity); assert.equal(row.life, prev.life);
      yes(true, label + ' 発射点・弾道・速度・寿命・威力・爆風を維持');
      yes(row.visual.pink === 0xff63cc && row.visual.headRadius >= 1.08 && row.visual.width >= .36, label + ' ピンクの大きな砲弾');
      yes(row.visual.headRadius >= prev.visual.headRadius * 2.99 && row.visual.width >= prev.visual.width * 2.99, label + ' 先端と尾の太さが従来の約3倍');
      yes(row.visual.headAt.every((n, i) => Math.abs(n - row.position[i]) < 1e-6), label + ' 先端は実際の弾の位置');
      yes(row.visual.shapeShared && row.visual.tailLength <= 10.00001, label + ' 形を共有し、尾を長く伸ばしすぎない');
      assert.deepEqual(row.ring.origin, row.start.from);
      yes(row.ring.color === 0xff63cc && row.ring.normalDot > .99999, label + ' 砲口から発射方向に直交するピンクの輪');
      yes(row.later.radius > row.ring.radius && row.later.opacity < row.ring.opacity && row.ringGone, label + ' 輪は広がり、薄れて消える');
    }
    yes(now.charges.length === 18, '蓄圧砲3型・両陣営・3充填段階を確認');
    for (const row of now.charges) {
      const prev = old.charges.find(s => s.key === row.key && s.team === row.team && s.fraction === row.fraction), label = row.team + '/' + row.key + '/' + row.fraction;
      assert.deepEqual(row.start,prev.start); assert.deepEqual(row.position,prev.position); assert.deepEqual(row.velocity,prev.velocity); assert.equal(row.life,prev.life);
      yes(true,label + ' 充填段階の威力・発射点・弾道・速度・寿命・弾数を維持');
      yes(row.visual.color === 0xb8ff32 && row.visual.headRadius >= 1.08 && row.visual.width >= .36,label + ' 大きな緑の先端と太い尾');
      yes(row.visual.headAt.every((n,i) => Math.abs(n-row.position[i]) < 1e-6),label + ' 先端は実際の弾の位置');
    }
    yes(now.wallGone && old.wallGone, '壁へ接触した砲弾と見た目を片付ける');
    yes(now.distant.pinkPixels >= 12, '約100m先でも射手からピンクの砲弾が見える');
    yes(now.distant.pinkPixels >= old.distant.pinkPixels * 4, '約100m先の実描画でピンクの面積が従来の4倍以上');
    yes(now.far.pinkPixels >= 80 && now.far.pinkPixels >= old.far.pinkPixels * 4, '約270m先でもピンクの面積が80px以上・従来の4倍以上');
    for (const name of ['charge-distant','charge-far']) yes(now[name].greenPixels >= 80 && now[name].greenPixels >= old[name].greenPixels * 4,name + ' 実描画の緑の面積が80px以上・従来の4倍以上');
    yes(errors.length === 0, 'ブラウザエラーなし');
    delete old.catalog; delete now.catalog;
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, before: old, after: now, errors }, null, 2) + '\n');
    console.log(`プラズマ砲・蓄圧砲の描画：${checks.length}項目成功。遠方のピンク${now.distant.pinkPixels}px、緑${now['charge-distant'].greenPixels}px、ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
