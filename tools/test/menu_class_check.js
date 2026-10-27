// メニューの兵装を押すと、その兵装を選んでカスタマイズを開くことを確かめる。
// node tools/test/menu_class_check.js dbg [出力フォルダ]
// 兵装ごとに開くタブ、部位を選んでいたときは主武器の枠、戻ると選んだ兵装のまま、再出撃の画面の兵装は選ぶだけ、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || '/tmp/menu-class-check');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ev = (f, a) => page.evaluate(f, a);
    const visible = id => ev(id => !document.getElementById(id).hidden, id);
    const tab = () => ev(() => document.querySelector('#cuTabs [aria-selected="true"]')?.dataset.cu);

    ok((await ev(() => [...document.querySelectorAll('#ovCls .toCu')].length)) === 4, 'メニューの兵装に「カスタマイズ ›」の印');
    await page.screenshot({ path: path.join(out, 'menu.png') });
    for (const k of ['heavy', 'raid', 'support', 'assault']) {
      await page.click(`#ovCls [data-cls="${k}"]`);
      ok(await visible('pgCustom') && await tab() === k && await ev(k => __g.chosenCls === k, k), `${k} を押すと、選んで ${k} のカスタマイズを開く`);
      if (k === 'heavy') await page.screenshot({ path: path.join(out, 'custom-heavy.png') });
      await page.click('#pgCustom .pgh .back');
      ok(await visible('pgMenu') && await ev(k => document.querySelector(`#ovCls [data-cls="${k}"]`).classList.contains('sel'), k), `戻るとメニューで ${k} が選ばれたまま`);
    }
    // 部位を選んでいたら、武器の枠（主武器）を出す
    await page.click('[data-page="pgCustom"]');
    await page.click('#cuSlotList [data-cslot="head"]');
    ok(await ev(() => !!document.querySelector('#cuSlotList [data-cslot="head"][aria-pressed="true"], #cuSlotList [data-cslot="head"].sel')), '（準備）カスタマイズで頭を選ぶ');
    await page.click('#pgCustom .pgh .back');
    await page.click('#ovCls [data-cls="heavy"]');
    ok(await ev(() => !!document.querySelector('#cuSlotList [data-cslot="main"][aria-pressed="true"], #cuSlotList [data-cslot="main"].sel')), '部位を選んでいたときは主武器の枠を出す');
    await page.click('#pgCustom .pgh .back');
    // 武器の枠を選んでいたら、その枠のまま
    await page.click('[data-page="pgCustom"]');
    await page.click('#cuSlotList [data-cslot="sub"]');
    await page.click('#pgCustom .pgh .back');
    await page.click('#ovCls [data-cls="raid"]');
    ok(await ev(() => !!document.querySelector('#cuSlotList [data-cslot="sub"][aria-pressed="true"], #cuSlotList [data-cslot="sub"].sel')), '武器の枠を選んでいたときはその枠のまま');
    await page.click('#pgCustom .pgh .back');

    // 再出撃の画面の兵装は選ぶだけ（カスタマイズを開かない）
    await page.click('#start');
    await ev(() => { const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); for (let i = 0; i < 4; i++) __g.loop(window.__t = (window.__t || 0) + 50); });
    await ev(() => { const p = __g.player; p.invulT = 0; __g.kill(p, __g.units.find(u => u.team !== p.team)); p.downT = 0; for (let i = 0; i < 2; i++) __g.loop(window.__t += 50); });
    ok(await visible('respawn'), '（準備）撃破されて再出撃の画面');
    await ev(() => document.querySelector('#rcls [data-cls="support"]').click()); // 再出撃の画面はマウスを固定したまま（キーで選ぶ）なので、ボタンを直接押す
    ok(await ev(() => __g.chosenCls === 'support' && __g.player.nextCls === 'support' && document.getElementById('overlay').hidden), '再出撃の画面の兵装は選ぶだけ');
    ok(await ev(() => !document.querySelector('#rcls .toCu')), '再出撃の画面には「カスタマイズ ›」を出さない');

    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`メニューの兵装：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
