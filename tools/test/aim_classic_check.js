// 旧い照準（オプションの照準の形 aimStyle=2、中では aimClassic）を確かめる。node tools/test/aim_classic_check.js dbg
// OFF（既定）は三角ゲージで旧い中央計器を隠す。ON は4つのコンソールで三角ゲージを隠し、旧い中央計器（標準・アーケード・フライトは照準円の弧と捕捉円、
// メカニカルは照準の4枠）を出す。設定は保存され、読み直しても残る。ブラウザのエラーが無いこと。
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
    const shown = id => ev(id => { const e = document.getElementById(id); if (!e) return false; const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && !e.closest('[hidden]'); }, id);
    await step(2);
    ok(await ev(() => document.getElementById('optAimStyle').value === '0' && !document.body.classList.contains('aimClassic')), '既定はOFF（三角ゲージ）');
    await ev(() => { __g.selectMap('city'); document.getElementById('start').click(); const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); });
    await step(4);
    for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
      await ev(m => document.querySelector(`[data-console-choice="${m}"]`).click(), mode); await step(2);
      ok(await shown('triangleAim') && !(await shown('aimGauge')) && !(await shown('mechAim')) && !(await shown('lockRing')), `OFF・${mode}：三角ゲージだけ`);
    }
    await ev(() => { const sel = document.getElementById('optAimStyle'); sel.value = '2'; sel.dispatchEvent(new Event('change')); });
    ok(await ev(() => document.body.classList.contains('aimClassic') && JSON.parse(localStorage.getItem('coreBreakerOptions')).aimClassic === 1), '照準の形で「旧い照準」を選ぶと保存される');
    for (const mode of ['standard', 'arcade', 'flight', 'mechanical']) {
      await ev(m => document.querySelector(`[data-console-choice="${m}"]`).click(), mode); await step(2);
      const tri = await shown('triangleAim'), gauge = await shown('aimGauge'), mech = await shown('mechAim'), ring = await shown('lockRing');
      ok(!tri && ring && (mode === 'mechanical' ? mech && !gauge : gauge && !mech), `ON・${mode}：三角ゲージを隠し、${mode === 'mechanical' ? '照準の4枠' : '照準円の弧'}と捕捉円を出す`);
    }
    const offs = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--aim-sp-offset').trim() === getComputedStyle(document.documentElement).getPropertyValue('--aim-sp-classic').trim());
    ok(offs, 'ONではSPの棒が照準円のすぐ下（旧い位置）');
    const corner = await ev(() => { const br = document.querySelector('#lockMark .br'); const s = getComputedStyle(br); return s.backgroundImage.includes('gradient') && (!br.querySelector('svg') || getComputedStyle(br.querySelector('svg')).display === 'none'); });
    ok(corner, 'ONではロックの印が四隅の形');
    await page.reload(); await step(2);
    ok(await ev(() => document.getElementById('optAimStyle').value === '2' && document.body.classList.contains('aimClassic')), '読み直してもONのまま');
    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`旧い照準：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
