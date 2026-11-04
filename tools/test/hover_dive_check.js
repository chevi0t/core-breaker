// ホバーの急降下（2026-11-04）を確かめる。node tools/test/hover_dive_check.js dbg
// ホバー脚は空中でしゃがみ（C）を押している間、毎秒6mの降下上限を外して二脚と同じ重力で落ちる。離せば元の降下に戻る。
// ブーストは使わない。滞空（Space）より急降下が優先。二脚の空中は変わらない。ブラウザのエラーが無いこと。
const path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const ev = (f, a) => page.evaluate(f, a);
    const step = (n = 1) => ev(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    await step(2);
    await ev(() => { __g.selectMap('mesa'); document.getElementById('start').click(); const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); });
    await step(4);
    const legs = async l => { await ev(l => { const u = __g.player; u.mech = { ...__g.MECH_DEFAULT, legs: l }; __g.equip(u, 'assault'); __g.spawn(u); }, l); await step(1); };
    const drop = async (keys, frames = 20) => {
      await ev(k => { const p = __g.player; for (const u of __g.units) if (u !== p) { u.alive = false; u.pos.set(9999, -999, 9999); }
        Object.assign(p, { onGround: false, boost: p.maxBoost, overheat: false, dashT: 0, longDash: false, invulT: 1e9 }); p.pos.set(0, 80, 0); p.vel.set(0, 0, 0);
        for (const key of k) __g.keys[key] = true; }, keys);
      await step(frames);
      const r = await ev(() => ({ v: __g.player.vel.y, y: __g.player.pos.y, boost: __g.player.boost, max: __g.player.maxBoost }));
      await ev(k => { for (const key of k) __g.keys[key] = false; }, keys);
      return r;
    };
    await legs('skimmer');
    ok(await ev(() => __g.hoverLegs(__g.player)), 'ホバー脚に替えた');
    const slow = await drop([]);
    ok(Math.abs(slow.v + 6) < .01, `何も押さないと毎秒6mでゆっくり降りる（${slow.v.toFixed(1)}）`);
    const dive = await drop(['KeyC']);
    ok(dive.v < -25 && dive.y < 80 - 12, `空中でCを押すと重力で急降下する（1秒で ${dive.v.toFixed(1)}m/s、${(80 - dive.y).toFixed(1)}m）`);
    ok(dive.boost === dive.max, '急降下はブーストを使わない');
    const ctrl = await drop(['ControlLeft']);
    ok(Math.abs(ctrl.v + 6) < .01, `左Ctrlでは急降下しない（しゃがみはCだけ。${ctrl.v.toFixed(1)}）`);
    const both = await drop(['KeyC', 'Space']);
    ok(both.v < -25, `滞空（Space）と一緒に押しても急降下が優先（${both.v.toFixed(1)}）`);
    await drop(['KeyC'], 10); await step(4);
    ok(await ev(() => Math.abs(__g.player.vel.y + 6) < .01), 'Cを離すと元のゆっくり降下に戻る');
    await legs('standard');
    const biped = await ev(() => !__g.hoverLegs(__g.player));
    if (biped) {
      const a = await drop([]), b = await drop(['KeyC']);
      ok(Math.abs(a.v - b.v) < .01, `二脚の空中はCを押しても変わらない（${a.v.toFixed(1)} と ${b.v.toFixed(1)}）`);
    }
    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`ホバーの急降下：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
