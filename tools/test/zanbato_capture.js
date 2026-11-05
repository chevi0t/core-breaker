// 斬馬刀（日本刀）の動きを据え置きで撮る（2026-11-06）。押すたびの連続技・ダッシュの4段・納刀からの居合・背負った形。
// node tools/test/zanbato_capture.js dbg /tmp/zanbato [combo,dash,iai,back] [sabre]
// 出力：<出力>/<場面>/0000.png… と、場面ごとの一覧 <出力>/<場面>.png
const fs = require('node:fs'), path = require('node:path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage({ viewport: { width: 720, height: 600 } }), errors = [], out = path.resolve(process.argv[3] || '/tmp/zanbato'); fs.mkdirSync(out, { recursive: true });
    p.on('pageerror', e => errors.push(e.message));
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' })); await p.addInitScript(() => requestAnimationFrame = () => 0);
    await p.goto('file://' + path.resolve(process.argv[2] || 'dbg', 'dbg.html'));
    await p.evaluate(() => {
      const g = __g, T = g.T; g.selectMap('dock'); document.getElementById('start').click(); g.running = false; g.renderer.render = () => {};
      for (const q of g.units) { q.alive = false; q.frozen = true; q.pos.set(10000, 0, 10000); } for (const t of g.turrets) t.alive = false;
      const sc = new T.Scene(); sc.background = new T.Color(0x182b3b); sc.add(new T.HemisphereLight(0xf0f8ff, 0x394455, 1.2)); const li = new T.DirectionalLight(0xffffff, 1.1); li.position.set(-4, 9, -6); sc.add(li); sc.add(new T.GridHelper(24, 24, 0x63798a, 0x263f52));
      const cam = new T.PerspectiveCamera(50, 720 / 600, .1, 80); cam.position.set(11, 7, -15); cam.lookAt(0, 3, -1);
      document.body.insertAdjacentHTML('beforeend', '<canvas id="motion" style="position:fixed;inset:0;z-index:10000"></canvas><div id="caption" style="position:fixed;z-index:10001;left:18px;top:18px;color:white;font:18px sans-serif"></div>');
      const ren = new T.WebGLRenderer({ canvas: document.getElementById('motion'), antialias: true, preserveDrawingBuffer: true }); ren.setSize(720, 600); sc.add(g.player.group);
      window.__motion = { sc, cam, ren, base: new T.Vector3(-50, g.terrainH(-50, -48), -48) };
    });
    const key = process.argv[5] || 'sabre';
    const scenes = { combo: [9, 17, 25, 33], dash: [9], iai: [], back: [] };
    for (const scene of (process.argv[4] || 'combo,dash,iai,back').split(',')) {
      const dir = path.join(out, scene); fs.mkdirSync(dir, { recursive: true });
      await p.evaluate(([key, scene]) => { const g = __g, u = g.player; g.loadout.assault.aux = key; g.equip(u, 'assault'); g.selectWeapon(u, scene === 'back' ? 'main' : 'aux');
        Object.assign(u, { alive: true, switchT: 0, invulT: 0, swing: null, stun: '', stunT: 0, ctrlLockT: 0, repairing: false, flying: false, recoverT: 0, lungeT: 0, dashT: 0, longDash: false, onGround: true, yaw: 0, pitch: 0 });
        u.slots.aux.sheathed = scene === 'iai'; u.slots.aux.chargeT = 0; u.pos.copy(__motion.base); u.vel.set(0, 0, 0); g.lock.target = null; g.resetMechPose(u); }, [key, scene]);
      const frames = scene === 'back' ? 12 : 75;
      for (let frame = 0; frame < frames; frame++) {
        await p.evaluate(([frame, scene, presses]) => {
          const g = __g, T = g.T, u = g.player, r = __motion, dt = 1 / 30, aim = u.pos.clone().add(new T.Vector3(0, 2.4, -100));
          let trig = presses.includes(frame);
          if (scene === 'dash' && frame === 9) u.dashT = .2;
          if (scene === 'iai') trig = frame >= 6 && frame < 36; // 1秒溜めて離す
          if (scene !== 'back') g.swordTick(u, u.slots.aux, dt, trig, aim);
          g.physics(u, new T.Vector3(), false, false, dt); u.pos.x = r.base.x; u.pos.z = r.base.z; u.vel.x = u.vel.z = 0;
          u.group.position.set(0, u.pos.y - r.base.y, 0); u.group.rotation.set(0, u.yaw, 0); g.weaponLook(u, dt); g.fxUpdate(dt); u.group.updateMatrixWorld(true); r.ren.render(r.sc, r.cam);
          const s = u.swing, stage = s?.a.strikes?.filter(x => s.t >= s.a.windup + x.at).pop();
          const labels = { kesa: '袈裟斬り', reverse: '逆袈裟', horizontal: '横薙ぎ', men: '面打ち', iai: '居合・抜刀一閃' };
          const sl = u.slots.aux, what = scene === 'back' ? '背負った形' : s ? (s.a.combo != null ? (s.a.combo + 1) + '段目 ' : '') + (labels[stage?.motion] || '構え') : sl.sheathed ? '納刀・溜め ' + Math.round((sl.chargeT || 0) * 100) + '%' : '待機';
          document.getElementById('caption').textContent = u.slots.aux.w.name + '　' + what + '　' + frame;
        }, [frame, scene, scenes[scene]]);
        await p.screenshot({ path: path.join(dir, String(frame).padStart(4, '0') + '.png') });
      }
      console.log(scene + ': ' + frames + ' frames');
    }
    if (errors.length) throw Error(errors.join('\n'));
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
