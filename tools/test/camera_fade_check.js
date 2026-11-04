// 視界をふさぐ建物を薄くする（cameraFade、2026-11-04）を確かめる。node tools/test/camera_fade_check.js dbg [出力フォルダ]
// 自機とカメラの間に箱を置くと、その箱だけが CAM_FADE.opacity まで薄くなり（共有の材質は変えない）、ふさがなくなると元の材質に戻ること。
// 自機の横の箱は薄くならないこと、キルカメラ・マップの作り直しで元に戻ること、ブラウザのエラーが無いことを見る。
const path = require('node:path'), { check } = require('./lib');
check('視界をふさぐ建物を薄くする', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('mesa', { render: true });
  ok(await ev(() => __g.running && !__g.cityMap), '台地で出撃');
  // 自機を広い所に止め、北（-z）を向かせる。カメラは自機の後ろ（+z）8m
  const setup = await ev(() => {
    const p = __g.player, x = 0, z = 0;
    p.pos.set(x, __g.terrainH(x, z), z); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0; p.invulT = 1e9; p.hp = p.maxHp;
    for (const u of __g.units) if (u !== p) { u.alive = false; u.pos.set(9999, -999, 9999); }
    __g.updateCamera(p, 1);
    const c = __g.camera.position;
    // 自機とカメラの中ほどの箱（ふさぐ）と、自機の横の箱（ふさがない）
    const mid = __g.addBox(c.x * 0.5 + p.pos.x * 0.5, c.z * 0.5 + p.pos.z * 0.5, 6, 1.5, 12);
    const side = __g.addBox(p.pos.x - 14, p.pos.z, 4, 4, 12);
    window.__box = { mid: mid.m, side: side.m, shared: mid.m.material };
    return { cz: c.z - p.pos.z };
  });
  ok(setup.cz > 6, `カメラは自機の後ろ（${setup.cz.toFixed(1)}m）`);
  await step(10);
  const a = await ev(() => { const b = window.__box; return { mid: b.mid.material.opacity, midT: b.mid.material.transparent, cloned: b.mid.material !== b.shared, side: b.side.material === b.shared, shared: b.shared.opacity, sharedT: b.shared.transparent }; });
  ok(a.cloned && a.midT && a.mid < 0.2, `ふさぐ箱は薄くなる（不透明度 ${a.mid.toFixed(2)}）`);
  ok(a.side, '自機の横の箱はそのまま');
  ok(a.shared === 1 && !a.sharedT, '共有の材質（ほかの建物）は変わらない');
  await page.screenshot({ path: path.join(out, 'faded.png') });
  // 箱をどけると戻る
  await ev(() => { window.__box.mid.position.x += 40; window.__box.mid.updateMatrixWorld(); });
  await step(10);
  const back = await ev(() => ({ mid: window.__box.mid.material === window.__box.shared, n: __g.camFade.faded.size, names: [...__g.camFade.faded.keys()].map(o => [o.name, o.parent && o.parent.type, o.material[0]?.type || o.material.type, o.geometry.boundingSphere.center.toArray().map(v => v.toFixed(1)), o.geometry.boundingSphere.radius.toFixed(1), JSON.stringify(o.userData), o.geometry.attributes.position.count]) }));
  ok(back.mid && back.n === 0, 'ふさがなくなると元の材質に戻る' + (back.n ? JSON.stringify(back) : ''));
  // ふさいだまま、キルカメラとマップの作り直しで戻る
  await ev(() => { window.__box.mid.position.x -= 40; window.__box.mid.updateMatrixWorld(); });
  await step(6);
  ok(await ev(() => __g.camFade.faded.has(window.__box.mid)), 'もう一度ふさぐと薄くなる');
  await ev(() => { __g.selectMap('wide'); document.getElementById('start').click(); });
  await step(2);
  ok(await ev(() => window.__box.mid.material === window.__box.shared && !__g.camFade.faded.has(window.__box.mid)), 'マップを作り直すと元に戻る');
  // 外周の壁（大きな箱）も薄くなる。敵コアの奥で外周の壁を背にすると、カメラが壁の外に出て画面が灰色で埋まっていた（オーナーの報告 2026-11-04、広域演習場）
  await step(2);
  const wall = await ev(() => {
    const p = __g.player, c = __g.cores.R, x = c.pos.x + 12, z = -297;
    for (const u of __g.units) if (u !== p) { u.alive = false; u.pos.set(9999, -999, 9999); }
    const place = () => { p.pos.set(x, __g.terrainH(x, z), z); p.vel.set(0, 0, 0); p.yaw = Math.atan2(-(c.pos.x - x), -(c.pos.z - z)); p.pitch = .35; p.invulT = 1e9; };
    for (let i = 0; i < 8; i++) { place(); __g.loop(window.__t = (window.__t || 0) + 50); }
    const o = [...__g.camFade.faded.keys()].find(o => o.geometry.parameters && o.geometry.parameters.width > 300);
    return { camZ: __g.camera.position.z, a: o ? o.material.opacity : null };
  });
  ok(wall.camZ < -302 && wall.a !== null && wall.a < 0.2, `敵コアの奥で外周の壁の外に出たカメラでも、外周の壁が薄くなる（カメラ z ${wall.camZ.toFixed(1)}、不透明度 ${wall.a}）`);
});
