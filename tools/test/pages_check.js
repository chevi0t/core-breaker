// GitHub Pages に出す物（tools/build_pages.py で作った gh-pages のフォルダ）を、スマホと PC の大きさで開いて確かめる。
// node tools/test/pages_check.js <gh-pages のフォルダ>
// 同梱の three.js だけで動くこと（cdnjs へは取りに行かせない）、出撃できること、スマホではタッチのボタン・PC では無し、
// 出典のページへのリンクと出典のページ、build-info.json のハッシュが中身と合うこと、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || '../core-breaker-pages');
(async () => {
  const checks = [];
  const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'));
    const bad = Object.entries(info.files).filter(([n, f]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, n))).digest('hex') !== f.sha256);
    ok(bad.length === 0, `build-info.json のハッシュが中身と合う（main ${info.sourceCommit.slice(0, 7)}）` + (bad.length ? '：' + bad.map(b => b[0]).join('・') : ''));
    for (const [name, opts, touch] of [['スマホ', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, true], ['PC', { viewport: { width: 1280, height: 720 } }, false]]) {
      const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
      await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await page.route('**cdnjs.cloudflare.com/**', r => r.abort()); // 同梱の three.js だけで動くこと
      await page.goto('file://' + path.join(dir, 'index.html'));
      await page.waitForTimeout(800);
      ok(await page.evaluate(() => document.compatMode === 'CSS1Compat'), `${name}：標準モードで表示（doctype あり）`);
      ok(await page.evaluate(() => typeof THREE !== 'undefined' && THREE.REVISION === '128'), `${name}：同梱の three.js r128 を読む`);
      ok(await page.evaluate(() => !!document.querySelector('#pgMap a[href="credits/"]')), `${name}：マップ選択の画面に出典のリンク`);
      await page.click('#start');
      await page.waitForTimeout(2500);
      const st = await page.evaluate(() => ({ overlay: document.getElementById('overlay').hidden, touchPlay: document.body.classList.contains('touchPlay') }));
      ok(st.overlay, `${name}：出撃できる`);
      ok(st.touchPlay === touch, `${name}：タッチのボタンは${touch ? '出す' : '出さない'}`);
      ok(errors.length === 0, `${name}：ブラウザのエラーなし` + (errors.length ? '\n' + errors.join('\n') : ''));
      await ctx.close();
    }
    const cp = await browser.newPage();
    await cp.goto('file://' + path.join(dir, 'credits', 'index.html'));
    const sec = await cp.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent));
    ok(sec.includes('sounds/CREDITS.md') && sec.some(s => s.startsWith('Three.js')), `出典のページ（${sec.length}節）`);
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`GitHub Pages：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
