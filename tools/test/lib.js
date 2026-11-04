// 試験の共通部品（2026-11-04 リファクタ）。新しい *_check.js はこれで書くと、毎回の決まった準備を書かなくてよい。
//
//   const { check } = require('./lib');
//   check('ホバーの急降下', async ({ ev, step, ok, sortie }) => {
//     await sortie('mesa');                       // マップを選んで出撃（描画は止める）
//     ok(await ev(() => __g.running), '出撃した');
//   });
//
// node tools/test/<名前>_check.js [dbg のフォルダ=dbg] [出力フォルダ]
// してくれること：
//   - Chromium を swiftshader（ヘッドレスの WebGL）で開き、dbg.html を読む。Google Fonts は空で返す。
//   - requestAnimationFrame を止め（`step` で1コマずつ進める）、音（AudioContext）を切る。
//   - ブラウザのエラー（pageerror と console.error。読み込み失敗とフォントは除く）を集め、最後に「ブラウザのエラーなし」を自動で確かめる。
//   - 成功した項目を並べて「<題>：N項目 成功」と出す。失敗したら、そこまでの項目と理由を出して終了コード 1。
// 渡す物：page、ev(関数, 引数)、step(コマ数, ミリ秒=50)、ok(条件, 文)、sortie(マップID, { render })、errors（配列）、
//   dir（dbg のフォルダ）、out（出力フォルダ。作ってある）、browser、checks（成功した項目）。
// 設定（check の3つ目）：viewport（既定 1280x720）、frozen（既定 true。false なら requestAnimationFrame を止めない）、
//   audio（既定 false）、page（false ならページを開かない。自分で browser.newPage する試験向け）、errorsOk（正規表現。無視するエラー）。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const LAUNCH_ARGS = ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const IGNORE = /ERR_FAILED|ERR_FILE_NOT_FOUND|fonts/;

async function openPage(browser, dir, opts = {}, errors = []) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 720 } });
  const skip = opts.errorsOk;
  const keep = t => !IGNORE.test(t) && !(skip && skip.test(t));
  page.on('pageerror', e => { if (keep(e.stack || e.message)) errors.push(e.stack || e.message); });
  page.on('console', m => { if (m.type() === 'error' && keep(m.text())) errors.push(m.text()); });
  await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  const frozen = opts.frozen !== false, audio = !!opts.audio;
  await page.addInitScript(([frozen, audio]) => {
    if (frozen) requestAnimationFrame = () => 0;
    if (!audio) window.AudioContext = window.webkitAudioContext = undefined;
  }, [frozen, audio]);
  await page.goto('file://' + path.join(dir, opts.file || 'dbg.html'));
  return page;
}

// ページの中の操作。ev は page.evaluate の短い名前、step は __g.loop を n コマ進める（時刻は window.__t に足していく）
function helpers(page) {
  const ev = (f, a) => page.evaluate(f, a);
  const step = (n = 1, ms = 50) => ev(([n, ms]) => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + ms); }, [n, ms]);
  // マップを選んで出撃。render: false（既定）なら描画を止めて行列の更新だけにする（速い）
  const sortie = async (map, o = {}) => {
    await step(2);
    await ev(([map, render]) => {
      if (map) __g.selectMap(map);
      document.getElementById('start').click();
      if (!render) { const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); }
    }, [map, !!o.render]);
    await step(o.frames ?? 4);
  };
  return { ev, step, sortie };
}

function check(title, body, opts = {}) {
  const name = path.basename(require.main ? require.main.filename : 'check', '.js');
  const dir = path.resolve(process.argv[2] || 'dbg');
  const out = path.resolve(process.argv[3] || path.join(os.tmpdir(), name));
  const checks = [], errors = [];
  const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
  (async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    try {
      const page = opts.page === false ? null : await openPage(browser, dir, opts, errors);
      const h = page ? helpers(page) : {};
      await body({ page, browser, dir, out, ok, checks, errors, ...h, open: o => openPage(browser, dir, { ...opts, ...o }, errors) });
      ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
      console.log(checks.map(c => '  ' + c).join('\n'));
      console.log(`${title}：${checks.length}項目 成功`);
    } catch (e) {
      console.log(checks.map(c => '  ' + c).join('\n'));
      console.error('失敗：', e.message);
      process.exitCode = 1;
    } finally { await browser.close(); }
  })();
}

module.exports = { check, openPage, helpers, chromium, LAUNCH_ARGS };
