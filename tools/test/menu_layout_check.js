// メニューの作り直し（2026-11-12）：1画面に収まる、兵装名と機体の注釈、人数の 5・10・自由入力、結果の表示。
// node tools/test/menu_layout_check.js [dbg] [出力フォルダ]
const path = require('node:path');
const { check } = require('./lib');

check('メニューの画面', async ({ page, ev, step, ok, out, open }) => {
  const inView = async (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5; }, sel);
  await step(3);
  ok(await inView(page, '#start'), 'PC（1280×720）で「出撃する」がスクロールなしに見える');
  ok(await inView(page, '#ovCls'), 'PC で兵装の4つが見える');
  ok(await ev(() => document.getElementById('mxMega').textContent) === '強襲', '大きな兵装名が出る');
  const labels = await ev(() => [...document.querySelectorAll('#mxCalls .lb')].map(e => e.textContent));
  ok(['HEAD', 'BODY', 'ARMS', 'MAIN', 'LEGS'].every(k => labels.some(t => t.startsWith(k))), '頭・胴・腕・主武器・脚の注釈が出る：' + labels.length + '個');
  ok(await ev(() => [...document.querySelectorAll('#ovCls button')].every(b => b.querySelectorAll('small span').length === 4)), '兵装ごとに主・副・補助・特別の4つの武器名が出る');
  await page.screenshot({ path: path.join(out, 'menu-pc.png') });

  await ev(() => document.querySelector('#ovCls [data-cls="heavy"]').click()); await step(2);
  ok(await ev(() => document.getElementById('mxMega').textContent) === '重火力', '兵装を選ぶと大きな兵装名が変わる');
  ok(await ev(() => document.querySelectorAll('#mxCalls .lb').length) === 5, '兵装を変えても注釈は5つ');

  await ev(() => document.querySelector('#battleSizeControl [data-size="10"]').click());
  ok(await ev(() => __g.battleTeamSize() === 10 && document.getElementById('teamSize').value === '10'), '人数の「10」で10対10');
  ok(!(await ev(() => !!document.querySelector('#battleSizeControl [data-size="2"]'))), '人数に「2」のボタンは無い');
  await page.fill('#teamSize', '37'); await page.dispatchEvent('#teamSize', 'change');
  ok(await ev(() => __g.battleTeamSize() === 37 && document.querySelector('.mxFree').classList.contains('on')), '自由入力で37対37');
  await page.fill('#teamSize', '99'); await page.dispatchEvent('#teamSize', 'change');
  ok(await ev(() => __g.battleTeamSize() === 37), '範囲外（99）は受け付けない');
  await ev(() => document.querySelector('#battleSizeControl [data-size="5"]').click());

  await ev(() => document.querySelector('#teamChoice input[value="R"]').click());
  ok(await ev(() => __g.chosenTeam === 'R'), '出撃側の「北」を選べる');
  await ev(() => document.querySelector('#teamChoice input[value="B"]').click());

  await ev(() => { document.getElementById('ovTitle').textContent = '勝利'; document.getElementById('ovBoard').innerHTML = '<p>表</p>'; });
  await step(1);
  ok(await ev(() => document.getElementById('pgMenu').classList.contains('hasResult') && getComputedStyle(document.querySelector('.mxResult')).display !== 'none'), '試合の結果は真ん中に出る');
  await ev(() => { document.getElementById('ovTitle').innerHTML = 'コア<span>ブレイカー</span> 試作'; document.getElementById('ovBoard').innerHTML = ''; });
  await step(1);
  ok(await ev(() => !document.getElementById('pgMenu').classList.contains('hasResult')), '結果を消すと機体の表示へ戻る');

  await ev(() => { const el = document.getElementById('optMenuStyle'); el.value = '1'; el.dispatchEvent(new Event('change')); });
  await step(1);
  ok(await ev(() => document.body.classList.contains('menuClassic') && getComputedStyle(document.getElementById('menuMech')).display === 'none' && document.querySelector('[data-page="pgCustom"] small').offsetWidth > 0), 'オプションで前の形（2列）に切り替えられる');
  ok(await inView(page, '#start') || await ev(() => { document.getElementById('start').scrollIntoView(); return true; }), '前の形でも「出撃する」へ行ける');
  await page.screenshot({ path: path.join(out, 'menu-classic.png') });
  await ev(() => { const el = document.getElementById('optMenuStyle'); el.value = '0'; el.dispatchEvent(new Event('change')); });
  ok(await ev(() => !document.body.classList.contains('menuClassic')), '新しい形へ戻せる');

  const phone = await open({ viewport: { width: 844, height: 390 } });
  await phone.evaluate(() => { for (let i = 0; i < 3; i++) __g.loop(window.__t = (window.__t || 0) + 50); });
  ok(await inView(phone, '#start'), 'スマホ横（844×390）でも「出撃する」が見える');
  ok(await inView(phone, '#ovCls'), 'スマホ横でも兵装の4つが見える');
  await phone.screenshot({ path: path.join(out, 'menu-phone.png') });
}, { errorsOk: /ERR_TUNNEL_CONNECTION_FAILED/ });
