// 光学迷彩の見た目（v0.21）：止まって消えた敵は、機体の所の背景が歪むだけで、機体そのものはほぼ見えない
// node tools/test/camo_check.js dbg [画像を書き出すフォルダ]  （python3 tools/test/make_dbg.py dbg で作った dbg/dbg.html を開く）
// 機体の写る四角の中で、機体がいない画面との色の差の平均を比べる：
// 1. 迷彩なし ＞＞ 迷彩で止まっている（歪みだけ） ＞ 0。歪みを描かないと差はほぼ0（機体の色は残らない）
// 2. ダッシュ中は止まっている時より見える。四角の外は迷彩の有無で変わらない
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
(async () => {
  const out = process.argv[3];
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } }), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await p.route('**fonts.g*/**', r => r.abort());
  await p.goto('file://' + path.resolve(process.argv[2] || 'dbg', 'dbg.html'));
  await p.evaluate(() => { __g.selectMap('mesa'); document.getElementById('start').click(); __g.running = false; });
  const r = await p.evaluate(() => {
    const g = __g, T = g.T, u = g.player, e = g.units.find(q => q.team !== u.team), cam = g.camera, R = g.renderer;
    for (const q of g.units) { q.frozen = true; if (q !== e) { q.group.visible = false; q.pos.set(10000, 0, 10000); } }
    const base = new T.Vector3(-40, 0, 60); base.y = g.terrainH(base.x, base.z);
    e.pos.copy(base); e.yaw = 0.5; e.vel.set(0, 0, 0); e.group.position.copy(e.pos); e.group.rotation.y = e.yaw;
    cam.position.copy(base).add(new T.Vector3(2, 4, 12)); cam.lookAt(base.clone().add(new T.Vector3(0, 2.5, 0))); cam.updateMatrixWorld();
    const scene = e.group.parent;
    R.render = R.render.bind(R); const draw = R.render; R.render = () => {}; // ゲームのループに上書きさせない
    const c2 = document.createElement('canvas'), x2 = c2.getContext('2d');
    const shot = (pass = true) => {
      scene.updateMatrixWorld(true); draw(scene, cam); if (pass) { R.render = draw; g.cloakPass(); R.render = () => {}; }
      const cv = R.domElement; c2.width = cv.width; c2.height = cv.height; x2.drawImage(cv, 0, 0);
      return { px: x2.getImageData(0, 0, cv.width, cv.height).data, url: c2.toDataURL('image/png') };
    };
    // 機体の写る四角（画面の画素）
    const box = new T.Box3().setFromObject(e.group), W = R.domElement.width, H = R.domElement.height;
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (const xi of [box.min.x, box.max.x]) for (const yi of [box.min.y, box.max.y]) for (const zi of [box.min.z, box.max.z]) {
      const v = new T.Vector3(xi, yi, zi).project(cam), sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
    const diff = (a, b2, inside) => {
      let s = 0, n = 0;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        if (inBox !== inside) continue;
        const i = (y * W + x) * 4; s += Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]); n++;
      }
      return +(s / n / 3).toFixed(2);
    };
    const state = (cloak, vis) => { Object.assign(e, { alive: true, cloak, vis, shimmer: 0 }); e.group.visible = true; g.cloakLook(e, 1); };
    e.group.visible = false; const none = shot();
    state(false, 1); const plain = shot();
    state(true, 0.04); const still = shot(), ghost = shot(false);
    state(true, 0.55); const dash = shot();
    state(false, 1); g.cloakLook(e, 1);
    return {
      box: [x0, y0, x1, y1],
      plain: diff(plain.px, none.px, true), still: diff(still.px, none.px, true), ghostOnly: diff(ghost.px, none.px, true), dash: diff(dash.px, none.px, true),
      outsideStill: diff(still.px, none.px, false), layersBack: (() => { let ok = true; e.group.traverse(o => { if (o.isMesh && (o.layers.mask & (1 << 5))) ok = false; }); return ok; })(),
      urls: { none: none.url, plain: plain.url, still: still.url, dash: dash.url },
    };
  });
  await b.close();
  if (out) for (const [k, v] of Object.entries(r.urls)) fs.writeFileSync(path.join(out, `camo-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  delete r.urls;
  const bad = [];
  if (!(r.plain > 8)) bad.push('迷彩なしの機体が写っていない');
  if (!(r.still > 0.3)) bad.push('止まって消えた時に背景が歪まない');
  if (!(r.still < r.plain * 0.5)) bad.push('止まって消えた時に見えすぎる');
  if (!(r.ghostOnly < 0.5)) bad.push('止まって消えた時に機体の色が残る');
  if (!(r.dash > r.still)) bad.push('ダッシュ中が止まっている時より見えにくい');
  if (!(r.outsideStill < 0.2)) bad.push('機体の外まで画面が変わる');
  if (!r.layersBack) bad.push('迷彩を解いても歪みの描き直しの対象に残る');
  console.log(JSON.stringify(r, null, 1));
  if (bad.length || errs.length) { console.log('失敗', JSON.stringify(bad), JSON.stringify(errs)); process.exit(1); }
  console.log('光学迷彩の見た目：成功。エラーなし');
})();
