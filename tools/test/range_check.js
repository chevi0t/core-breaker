// 射撃場（カスタマイズ画面から入る試し撃ちの場所）を確かめる。
// node tools/test/range_check.js dbg [出力フォルダ]
// 入口・選んだ兵装で出ること・標的の位置・命中の表示・撃破からの復帰・動く標的・コアと時間が減らないこと・一時停止・
// 弾と耐久を戻す・カスタマイズへ戻ると元のマップと兵装に戻ること、メニューからも入れること、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || '/tmp/range-check');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const ev = (f, a) => page.evaluate(f, a);
    const step = (n = 1) => ev(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    const key = code => ev(code => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true })), code);
    await step(2);
    const before = await ev(() => ({ mapId: __g.mapId, cls: __g.chosenCls }));

    // カスタマイズ画面で支援を選んで入る
    await ev(() => { document.querySelector('[data-page="pgCustom"]').click(); document.querySelector('#cuTabs [data-cu="support"]').click(); });
    ok(await ev(() => !document.getElementById('pgCustom').hidden && !!document.getElementById('rangeStart').getClientRects().length), 'カスタマイズ画面に「射撃場で試す」がある');
    await page.screenshot({ path: path.join(out, 'custom.png') });
    await ev(() => document.getElementById('rangeStart').click());
    await ev(() => { const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); });
    await step(2);
    ok(await ev(() => __g.range && __g.running && __g.mapId === '__range' && document.getElementById('overlay').hidden), '射撃場に入る');
    ok(await ev(() => __g.player.cls === 'support'), 'カスタマイズで選んでいた兵装（支援）で出る');
    const tg = await ev(() => __g.range.targets.map(t => ({ alive: t.alive, z: t.pos.z, x: t.pos.x, name: t.name, team: t.team })));
    ok(tg.length === 8 && tg.every(t => t.alive && t.team !== 'B'), '標的が8機（敵側）');
    ok(await ev(() => __g.units.length === 9), '自機と標的のほかに機体はいない');
    ok(tg.map(t => Math.round(170 - t.z)).join() === '15,30,40,50,80,90,120,200', `標的の距離 ${tg.map(t => Math.round(170 - t.z)).join('・')}m`);
    ok(await ev(() => !document.getElementById('rangeHud').hidden), '左上に射撃場の表示');

    // 15m の標的を主武器で撃つ
    const hitT = async (i, frames) => {
      await ev(i => {
        const p = __g.player, t = __g.range.targets[i];
        __g.selectWeapon(p, 'main');
        const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.02;
      }, i);
      await step(14);
      await ev(() => document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })));
      await step(frames);
      await ev(() => dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
      await step(1);
    };
    const hp0 = await ev(() => __g.range.targets[0].hp);
    await hitT(0, 16);
    const hp1 = await ev(() => __g.range.targets[0].hp);
    ok(hp1 < hp0, `15m の標的に当たる（耐久 ${hp0}→${hp1}）`);
    const hud = await ev(() => ({ last: document.getElementById('rangeLast').textContent, sum: document.getElementById('rangeSum').textContent, dps: document.getElementById('rangeDps').textContent }));
    ok(hud.last !== '—' && hud.sum.includes(Math.round(hp0 - hp1).toLocaleString('ja-JP')), `命中の表示（最後 ${hud.last}、合計 ${hud.sum}、毎秒 ${hud.dps}）`);
    await page.screenshot({ path: path.join(out, 'range.png') });
    // 4秒当てないと耐久が戻る
    await step(90);
    ok(await ev(() => __g.range.targets[0].hp === __g.range.targets[0].maxHp), '4秒当てないと耐久が戻る');

    // 撃破と復帰
    await ev(() => { const t = __g.range.targets[1]; t.hp = t.rangeHp = 50; t.hitT = __g.range.t; }); // 当てたばかりにして、耐久が戻らないように
    await hitT(1, 8);
    ok(await ev(() => !__g.range.targets[1].alive), '撃破できる');
    ok((await ev(() => document.getElementById('rangeKill').textContent)) !== '—', '撃破までの秒を出す');
    ok(await ev(() => __g.cores.R.hp === __g.cores.B.hp && __g.cores.R.hp > 0 && __g.timeLeft === __g.MATCH), 'コアも残り時間も減らない');
    await step(45);
    ok(await ev(() => { const t = __g.range.targets[1]; return t.alive && t.hp === t.maxHp && Math.abs(170 - t.pos.z - 30) < .01 && t.group.visible; }), '2秒で同じ所に起き上がる');

    // 動く標的
    const x0 = await ev(() => __g.range.targets[2].pos.x);
    await step(20);
    ok(await ev(x => Math.abs(__g.range.targets[2].pos.x - x) > 1, x0), '動く標的は左右に動く');

    // 一時停止・弾と耐久を戻す
    await ev(() => { __g.player.slots.main.ammo = 0; __g.player.pos.z -= 30; });
    await key('Escape'); await step(1);
    ok(await ev(() => !__g.running && !document.getElementById('pgRangePause').hidden && document.getElementById('rangeHud').hidden), 'Esc で一時停止');
    await ev(() => document.getElementById('rangeRefill').click()); await step(1);
    ok(await ev(() => __g.running && __g.player.slots.main.ammo === __g.player.slots.main.w.mag && Math.abs(__g.player.pos.z - 170) < .01), '「弾と耐久を戻して最初の位置へ」');
    await key('Escape'); await step(1);
    await key('Escape'); await step(1);
    ok(await ev(() => __g.running && document.getElementById('overlay').hidden), '一時停止中にもう一度 Esc で戻る');
    // F3 のオプションから戻っても射撃場のまま
    await key('F3'); await step(1);
    ok(await ev(() => !__g.running && !document.getElementById('pgOptions').hidden), 'F3 でオプション');
    await key('F3'); await step(1);
    ok(await ev(() => __g.running && __g.range && document.getElementById('overlay').hidden), 'もう一度 F3 で射撃場に戻る');

    // 自爆で倒れたら最初の位置へ
    await ev(() => { const p = __g.player; __g.kill(p, p); });
    await step(2);
    ok(await ev(() => __g.player.alive && Math.abs(__g.player.pos.z - 170) < .01), '自分の爆風で倒れても最初の位置からやり直す');

    // カスタマイズへ戻る
    await key('Escape'); await step(1);
    await ev(() => document.getElementById('rangeToCustom').click()); await step(1);
    const after = await ev(() => ({ range: __g.range, mapId: __g.mapId, cls: __g.chosenCls, custom: !document.getElementById('pgCustom').hidden, tab: document.querySelector('#cuTabs [aria-selected="true"], #cuTabs .sel')?.dataset.cu, hud: document.getElementById('rangeHud').hidden }));
    ok(after.range === null && after.custom && after.hud, 'カスタマイズ画面へ戻る');
    ok(after.mapId === before.mapId && after.cls === before.cls, `入る前のマップと兵装に戻る（${after.mapId}・${after.cls}）`);

    // 戻った後の通常の試合はいつもどおり
    await ev(() => { document.querySelector('#pgCustom .back').click(); document.getElementById('start').click(); });
    await step(3);
    ok(await ev(m => __g.running && !__g.range && __g.units.length > 9 && __g.mapId === m, before.mapId), '戻った後の出撃はいつもの対戦');
    await step(20);
    ok(await ev(m => __g.timeLeft < m, await ev(() => __g.MATCH)), '対戦では残り時間が減る');

    // メニューの「射撃場」からは、出撃に選んでいる兵装で入り、「メニューへ」で戻る
    await ev(() => { __g.running = false; document.exitPointerLock?.(); document.getElementById('overlay').hidden = false; __g.showPage('pgMenu'); __g.pickClass('heavy'); });
    const menuBefore = await ev(() => ({ mapId: __g.mapId, cls: __g.chosenCls }));
    await ev(() => document.getElementById('menuRange').click()); await step(2);
    ok(await ev(() => __g.range && __g.running && __g.player.cls === 'heavy'), 'メニューの「射撃場」から、出撃に選んでいる兵装（重火力）で入る');
    await key('Escape'); await step(1);
    await ev(() => document.getElementById('rangeToMenu').click()); await step(1);
    ok(await ev(m => !__g.range && !document.getElementById('pgMenu').hidden && __g.mapId === m.mapId && __g.chosenCls === m.cls && document.activeElement.id === 'menuRange', menuBefore), '「メニューへ」でメニューに戻り、マップと兵装も元のまま');

    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`射撃場：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
