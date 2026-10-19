// 使い方: node tools/test/arcade_weapons_check.js dbg [画像の出力先] [変更前の数値JSON]
// ACの転記表と実際の型の数値を照合し、機体カスタマイズの選択・比較・見本を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg');
const output = path.resolve(process.argv[3] || path.join(dir, 'arcade-weapons'));
const source = require('../../research/weapons/types/arcade.json');
const letters = { 大容量型: 'X', 連射型: 'R', 強装型: 'H', 精密型: 'P', 持続型: 'D' };
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const data = await page.evaluate(() => {
      __g.renderer.render = () => {};
      return { weapons: __g.WEAPONS, armory: __g.ARMORY, parts: __g.PARTS, loadout: __g.loadout };
    });
    let count = 0;
    for (const family of source) for (const [i, row] of [family.baseRow, ...family.types].entries()) {
      const key = family.base + (i ? letters[row.label] : ''), w = data.weapons[key];
      assert.ok(w, key);
      for (const field of ['dmg','rpm','mag','mags','reload']) assert.equal(w[field], row[field], key + ':' + field);
      assert.equal(w.kg, row.kg, key + ':kg');
      assert.ok(Math.abs(w.recoil * 180 / Math.PI - row.recoilV) < 1e-12, key + ':縦反動');
      assert.ok(Number.isFinite(w.spread) && w.spread > 0 && w.spread < 0.01);
      assert.equal(w.range, family.base === 'rail' ? 350 : 300);
      assert.equal(w.burst || 0, family.base === 'pulse' ? 3 : 0);
      if (w.burst) assert.equal(w.gap, 0, '3発の周期は3×60/rpm、追加間隔なし');
      assert.equal(w.heat, undefined, '熱制限を加えない');
      assert.ok(w.sfx && w.model && w.maker);
      assert.ok(!/電磁加速|VOLT|グローム|タルナダ/.test(w.name));
      const cls = family.base === 'coil' ? 'heavy' : 'assault';
      assert.ok(data.armory[cls].main.includes(key), key + ':プレイヤーとBotの装備候補');
      count++;
    }
    assert.equal(count, 10);
    assert.equal(Object.keys(data.weapons).length, 204);
    if (process.argv[4]) {
      const old = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
      for (const [key, w] of Object.entries(old.weapons)) assert.deepEqual(data.weapons[key], w, key + ':既存の値');
      assert.deepEqual(data.parts, old.parts, '機体の値');
      for (const [cls, slots] of Object.entries(old.armory)) for (const [slot, keys] of Object.entries(slots)) {
        assert.equal(data.armory[cls][slot][0], keys[0], '初期装備');
        assert.deepEqual(data.armory[cls][slot].filter(k => keys.includes(k)), keys, '既存装備の順序');
      }
      console.log('既存194武器・12パーツ・初期装備: 変更なし');
    }
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.evaluate(() => { __g.renderCustom(); __g.showPage('pgCustom'); document.getElementById('overlay').hidden = false; });
    for (const [series, cls, last] of [['lr','assault','railR'], ['lb','assault','pulseH'], ['lx','heavy','coilD']]) {
      await page.click(`[data-cu="${cls}"]`);
      await page.click('[data-cslot="main"]');
      const heading = page.locator(`[data-series="${series}"]`);
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
      await page.locator(`[data-pick="${last}"]`).hover();
      await page.waitForFunction(() => !!__g.mechRig?.m);
      await page.evaluate(() => { __g.mechRig.drag = 0; __g.mechRig.yaw = -0.45; });
      assert.match(await page.locator('#cuDiff').innerText(), /[▲▼]/);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, series + '.png') });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'stats.json'), JSON.stringify(data, null, 2));
    console.log('ACの新武器10種: 数値一致。全204種。カスタマイズの比較・画像: 成功。エラーなし');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
