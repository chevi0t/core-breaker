// UIの大きさのオプション（uiFit・uiSize）を実ブラウザで確かめる。
// 1280×720 で配置した端の表示が、16:9 のほかの大きさでも同じ比率の位置・大きさになり、画面からはみ出さないこと。OFFでは画面によらず同じ大きさ。
// python3 tools/test/make_dbg.py dbg && node tools/test/ui_scale_check.js dbg [スクリーンショットの接頭辞]
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg'), shot = process.argv[3];
const modes = ['standard', 'arcade', 'flight', 'mechanical', 'retro'];
const IDS = ['top', 'plantBar', 'mapHud', 'status', 'pilot', 'ammoBox', 'mechBoost', 'consoleTelemetry'];
const sizes = [[1280, 720], [1920, 1080], [2560, 1440], [960, 540]];
const checks = [], errors = [];
const yes = (v, label) => { if (!v) throw Error(label); checks.push(label); };
async function layout(p, mode) {
  return p.evaluate(({ mode, IDS }) => {
    const g = __g; localStorage.setItem('coreBreakerConsole', mode); document.body.dataset.console = mode; g.hud(240, .016);
    const out = {};
    for (const id of IDS) {
      const el = document.getElementById(id); if (!el || el.closest('[hidden]') || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      out[id] = [r.left / innerWidth, r.top / innerHeight, r.width / innerWidth, r.height / innerHeight];
    }
    return out;
  }, { mode, IDS });
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    await p.locator('[data-page="pgOptions"]').click();
    yes(await p.evaluate(() => document.getElementById('optUiFit').checked && document.getElementById('optUiSizeValue').textContent === '100%'), '標準は「画面に合わせる」ON・大きさ100%');
    await p.evaluate(() => { const g = __g; g.renderer.render = () => {}; g.selectMap('city'); document.getElementById('start').click(); g.running = false; for (const u of g.units) u.frozen = true; });
    const base = {};
    for (const m of modes) base[m] = await layout(p, m);
    for (const [w, h] of sizes.slice(1)) {
      await p.setViewportSize({ width: w, height: h }); await p.evaluate(() => dispatchEvent(new Event('resize')));
      const zoom = await p.evaluate(() => +getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom'));
      yes(Math.abs(zoom - w / 1280) < .002, `${w}×${h} で倍率 ${zoom}`);
      for (const m of modes) {
        const now = await layout(p, m), keys = Object.keys(base[m]);
        yes(keys.length && keys.every(k => now[k]), `${w}×${h} ${m}：同じ表示が出る`);
        let worst = 0, worstId = '';
        for (const k of keys) for (let i = 0; i < 4; i++) { const d = Math.abs(now[k][i] - base[m][k][i]); if (d > worst) { worst = d; worstId = k; } }
                // 1280×720 より小さい画面では小さい画面向けの配置（@media）に切り替わるので、比率は比べない
        if (w >= 1280) yes(worst < .03, `${w}×${h} ${m}：1280×720 とほぼ同じ比率（最大のずれ ${(worst * 100).toFixed(2)}%：${worstId}）`);
        const inside = Object.entries(now).every(([, [x, y, ww, hh]]) => x > -.002 && y > -.002 && x + ww < 1.002 && y + hh < 1.002);
        yes(inside, `${w}×${h} ${m}：画面からはみ出さない`);
        if (shot) await p.screenshot({ path: `${shot}-${m}-${w}.png` });
      }
    }
    // OFF：画面の大きさによらず等倍。大きさの目盛りは倍率を変える
    await p.evaluate(() => { const g = __g; g.gameOptions.uiFit = 0; g.gameOptions.uiSize = 100; g.saveOptions(); });
    const off = await p.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom'), document.getElementById('status').getBoundingClientRect().width]);
    yes(+off[0] === 1.3, 'OFF で大きさ最大は 1.3倍（画面の大きさは効かない）');
    await p.evaluate(() => { const g = __g; g.gameOptions.uiFit = 1; g.gameOptions.uiSize = 50; g.saveOptions(); });
    yes(errors.length === 0, 'ブラウザのエラーなし ' + errors.join(' / '));
    console.log(checks.join('\n')); console.log(`UIの大きさ：${checks.length}項目 成功`);
  } catch (e) { console.log(checks.join('\n')); console.error('失敗：' + e.message); process.exitCode = 1; } finally { await browser.close(); }
})();
