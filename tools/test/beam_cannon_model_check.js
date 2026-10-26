// LI-5の小型格納・二つ折りアーム・羽根展開と、発光部/射線・資源再利用を確認する。
// node tools/test/beam_cannon_model_check.js dbg/li5 /tmp/li5-model dbg/li5-before-model
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/li5'), out = path.resolve(process.argv[3] || '/tmp/li5-model');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } }), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**fonts.g*/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    const catalog = () => page.evaluate(() => JSON.stringify({ weapons: __g.WEAPONS, parts: __g.PARTS, armory: __g.ARMORY }));
    let before;
    if (process.argv[4]) {
      await page.goto('file://' + path.join(path.resolve(process.argv[4]), 'dbg.html'));
      before = await catalog();
    }
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    if (before) assert.equal(await catalog(), before, 'モデル変更前の302武器・全パーツ・装備一覧と完全同値');
    const result = await page.evaluate(() => {
      const g = __g, T = g.T, checks = [], bounds = [];
      const yes = (value, message) => { if (!value) throw Error(message); checks.push(message); };
      g.selectMap('dock'); g.setup(); g.running = false;
      for (const unit of g.units) { unit.frozen = true; unit.alive = false; unit.group.visible = false; }
      const u = g.player;
      Object.assign(u, { alive: true, yaw: 0, pitch: 0, stun: '', repairing: false, onGround: true, transfer: null, flying: false, dashT: 0, longDash: false, lungeT: 0 });
      u.group.visible = true; u.pos.set(0, 200, 0); u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0); u.vel.set(0, 0, 0);
      const box = () => {
        u.group.updateMatrixWorld(true);
        const inverse = u.pack.matrixWorld.clone().invert(), total = new T.Box3();
        u.pack.traverse(mesh => {
          if (!mesh.isMesh || !mesh.visible) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const matrix = new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
          total.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix));
        });
        return total.getSize(new T.Vector3()).toArray();
      };
      const keys = ['beamCannon', 'beamCannonD', 'beamCannonG', 'beamCannonQ'];
      let rig;
      for (const key of keys) {
        g.loadout.heavy.sp = key; g.equip(u, 'heavy'); g.selectWeapon(u, 'main');
        for (let i = 0; i < 90; i++) g.weaponLook(u, 1 / 60);
        rig = u.pack.userData.beamRig;
        const folded = box();
        yes(folded[0] < 1.7 && folded[1] < 1.9 && folded[2] < 1.1, key + 'の収納が背中幅1.7m・高さ1.9m・奥行1.1m以内: ' + folded.join('/'));
        yes(rig.arms.length === 2 && rig.meshes.length === 16, key + 'の左右二関節と四枚羽根');
        yes(rig.arms.every(arm => arm.vanes.every(hinge => Math.abs(hinge.rotation.x - Math.PI / 2) < 1e-8)), key + 'の羽根を折り畳む');
        g.selectWeapon(u, 'sp');
        for (let i = 0; i < 90; i++) g.weaponLook(u, 1 / 60);
        const opened = box();
        yes(opened[0] < 3.9 && opened[2] < 2.2 && opened[0] > folded[0] * 2, key + 'の細いアームを左右に展開');
        yes(rig.arms.every(arm => arm.vanes.every(hinge => Math.abs(hinge.rotation.x) < 1e-8)), key + 'の照射部の羽根を展開: ' + JSON.stringify({weapon:u.weapon,deploy:u.cannonDeploy,angles:rig.arms[0].vanes.map(hinge=>hinge.rotation.x)}));
        yes(rig.arms.every(arm => arm.upper.scale.y === .88 && arm.lower.scale.y === 1.25), key + 'のリンク長を変えずに折り畳む');
        yes(rig.meshes.every(mesh => mesh.userData.ref === u && mesh.userData.armorSlot === 'body' && g.hittables.filter(hit => hit === mesh).length === 1), key + 'の部品は胴の被弾面として一度だけ登録');
        for (const [side, arm] of [[-1, rig.arms[0]], [1, rig.arms[1]]]) {
          arm.hub.geometry.computeBoundingBox();
          const actual = new T.Vector3(0, 0, arm.hub.geometry.boundingBox.min.z).applyMatrix4(arm.emitter.matrixWorld);
          yes(actual.distanceTo(g.beamCannonMuzzle(u, side).point) < 1e-6, key + '/' + side + 'のビーム始点が発光レンズと一致');
        }
        const wall = new T.Mesh(new T.BoxGeometry(.24, .24, .24), new T.MeshBasicMaterial());
        wall.position.copy(u.pos).add(new T.Vector3(0, 2.7, 0)).lerp(g.beamCannonMuzzle(u, -1).point, .5);
        g.scene.add(wall); g.hittables.push(wall); wall.updateMatrixWorld(true);
        yes(g.beamCannonMuzzle(u, -1).blocked && !g.beamCannonMuzzle(u, 1).blocked, key + 'の片側のレンズが壁で塞がれた時だけ射線を止める');
        g.hittables.splice(g.hittables.indexOf(wall), 1); g.scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
        bounds.push({ key, folded, opened });
      }
      const identity = rig, meshes = rig.meshes.slice(), geometries = meshes.map(mesh => mesh.geometry), hits = g.hittables.length, bank = g.weaponGeoBank.size;
      for (let i = 0; i < 120; i++) { g.selectWeapon(u, i % 2 ? 'main' : 'sp'); g.weaponLook(u, 1 / 60); }
      yes(u.pack.userData.beamRig === identity && rig.meshes.every((mesh, i) => mesh === meshes[i] && mesh.geometry === geometries[i]) && g.hittables.length === hits && g.weaponGeoBank.size === bank, '繰り返し開閉してもメッシュ・共有形状・被弾面を増やさない');
      u.slots.sp = g.slotOf('barrier'); g.weaponLook(u, 1 / 60);
      yes(!rig.root.visible && rig.meshes.every(mesh => !mesh.visible), '別SPへ変更すると子部品の描画と射撃判定も消す');
      u.slots.sp = g.slotOf('beamCannonQ'); g.selectWeapon(u, 'main');
      const saved = Math.random; let randomCalls = 0; Math.random = () => { randomCalls++; return .5; };
      try { g.weaponLook(u, 1 / 60); } finally { Math.random = saved; }
      yes(randomCalls === 0, '再表示と関節更新で戦闘用乱数を使わない');
      const model = g.buildMech(g.TEAM.B.color, g.MECH_DEFAULT);
      const fixture = { ...model, slots: Object.fromEntries(g.SLOTS.map(slot => [slot, g.slotOf(slot === 'sp' ? 'beamCannon' : g.loadout.heavy[slot])])), weapon: 'main', cannonDeploy: 0, isPlayer: false, recoil: 0, swing: null };
      randomCalls = 0; Math.random = () => { randomCalls++; return .5; };
      try { g.weaponLook(fixture, 0); } finally { Math.random = saved; }
      yes(randomCalls === 0, '初回の関節モデル生成も戦闘用乱数から分ける');
      g.disposeMech(model.g);
      u.slots.sp = g.slotOf('beamCannon'); g.selectWeapon(u, 'main');
      for (let i = 0; i < 90; i++) g.weaponLook(u, 1 / 60);
      const fog = g.scene.fog;
      g.scene.background = new T.Color(0x18242e); g.scene.fog = null;
      const floor = new T.Mesh(new T.CircleGeometry(5, 48), new T.MeshLambertMaterial({ color: 0x293b48 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 199.9, 0); g.scene.add(floor);
      g.camera.fov = 43; g.camera.updateProjectionMatrix(); g.camera.position.set(6, 204.8, 8); g.camera.lookAt(0, 202, 0);
      window.foldingFixture = { g, u, rig, checks, fog };
      return { checks, bounds };
    });
    await page.addStyleTag({ content: 'body * { visibility: hidden !important; } #foldingPreview { visibility: visible !important; }' });
    await page.evaluate(() => __g.renderer.domElement.id = 'foldingPreview');
    const snapshots = [];
    for (const [name, phase] of [['folded', 0], ['unfolding', .5], ['deployed', 1]]) {
      await page.evaluate(phase => {
        const { g, u } = foldingFixture;
        g.selectWeapon(u, phase ? 'sp' : 'main'); u.cannonDeploy = phase;
        g.weaponLook(u, 0); g.scene.updateMatrixWorld(true); g.renderer.render(g.scene, g.camera);
      }, phase);
      const png = await page.locator('#foldingPreview').screenshot({ path: path.join(out, name + '.png') });
      snapshots.push({ name, image: png.toString('base64') });
    }
    await page.evaluate(() => {
      const { g, u, rig, fog } = foldingFixture, shared = rig.meshes[0].geometry;
      let disposed = 0; shared.addEventListener('dispose', () => disposed++);
      const old = u.group, pieces = rig.meshes.slice(); g.scene.fog = fog; g.selectMap('city');
      if (old.parent || pieces.some(mesh => g.hittables.includes(mesh)) || disposed) throw Error('マップ変更時の関節モデルの後片付け');
    });
    result.checks.push('マップ変更で子部品の被弾面を外し、共有形状を保持');
    const preview = await browser.newPage({ viewport: { width: 1200, height: 460 }, deviceScaleFactor: 1 });
    await preview.setContent('<style>body{margin:0;background:#111c25;color:#dce9ef;font:17px sans-serif}main{display:flex;gap:8px;padding:16px}figure{margin:0;width:384px}img{display:block;width:384px;height:320px;object-fit:cover}figcaption{padding:15px;text-align:center}h1{font-size:20px;margin:20px 30px 0}</style><h1>LI-5 折り畳み式照射装置</h1><main>' + snapshots.map((snapshot, i) => '<figure><img src="data:image/png;base64,' + snapshot.image + '"><figcaption>' + ['背中に格納', 'アームを展開', '照射装置が開く'][i] + '</figcaption></figure>').join('') + '</main>');
    await preview.screenshot({ path: path.join(out, 'preview.png') }); await preview.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ ...result, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ checks: result.checks.length, bounds: result.bounds, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
