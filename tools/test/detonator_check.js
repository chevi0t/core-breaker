// 遠隔ボムランチャー（detonator と型）を確かめる。node tools/test/detonator_check.js dbg
// 高く撃っても着地して設置されること、弾と設置物が爆弾の形（ランチャーの形ではない）こと、準備後に右クリックで全部起爆することを見る。
const path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const ev = (f, a) => page.evaluate(f, a);
    const step = (n = 1) => ev(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    await step(2);
    await ev(() => { document.getElementById('menuRange').click(); const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); });
    await step(2);
    const keys = await ev(() => Object.keys(__g.WEAPONS).filter(k => k.startsWith('detonator')));
    ok(keys.length >= 4, `遠隔ボムランチャーと型 ${keys.join('・')}`);
    for (const k of keys) {
      const r = await ev(k => {
        const p = __g.player, w = __g.WEAPONS[k];
        for (const g of [...__g.gadgets]) if (g.owner === p) __g.gadgets.splice(__g.gadgets.indexOf(g), 1);
        p.slots.sub = { w, ammo: w.mag, reserve: 99, resMax: 99, reloadT: 0, cd: 0, spin: 0, temp: 0, ohT: 0, conv: 0, heat: 100, overheat: false, bn: 0, held: false, chargeT: 0, holdT: 0, cap: 100, supply: 1 };
        p.weapon = 'sub'; p.switchT = 0; p.invulT = 0;
        const eye = p.pos.clone().setY(p.pos.y + 3), aim = eye.clone().add(new __g.T.Vector3(0, 1, -1).normalize().multiplyScalar(100)); // 45度上へ
        const before = __g.shells.length;
        __g.weaponsTick(p, .05, true, aim, 0);
        const sh = __g.shells.slice(before)[0];
        return { fired: __g.shells.length > before, model: w.proj.model, geoSame: !!sh && sh.mesh.geometry === __g.weaponGeo(k) };
      }, k);
      ok(r.fired && r.model === 'remote' && !r.geoSame, `${k}：弾はランチャーの形ではなく爆弾の形（${r.model}）`);
      let placed = 0;
      for (let i = 0; i < 300 && !placed; i++) { await ev(() => { for (let j = 0; j < 4; j++) __g.loop(window.__t = (window.__t || 0) + 50); }); placed = await ev(() => __g.gadgets.filter(g => g.owner === __g.player && g.kind === 'remote').length); }
      ok(placed === 1, `${k}：45度上へ撃っても着地して設置される`);
      await step(12); // 0.5秒の準備
      const det = await ev(() => {
        const p = __g.player, n0 = __g.gadgets.filter(g => g.owner === p && g.kind === 'remote').length;
        __g.weaponsTick(p, .05, false, p.pos.clone().setY(p.pos.y + 3).add(new __g.T.Vector3(0, 0, -50)), 0, true); p.altHeld = false;
        return { n0, n1: __g.gadgets.filter(g => g.owner === p && g.kind === 'remote').length };
      });
      ok(det.n0 === 1 && det.n1 === 0, `${k}：右クリックで起爆する`);
    }
    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`遠隔ボムランチャー：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
