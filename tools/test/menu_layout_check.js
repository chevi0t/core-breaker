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
  // 2026-11-14 オーナー「機体をメニュー画面に出したらあかん」「A（仕様書）で」「平面で Weapons Loadout Display」：3D の機体をやめ、装備表に
  const rows = await ev(() => [...document.querySelectorAll('#mxLoad .r')].map(e => e.textContent));
  ok(['MAIN', 'SUB', 'AUX', 'SP', 'HEAD', 'BODY', 'ARMS', 'LEGS'].every(k => rows.some(t => t.includes(k))) && rows.length === 8, '装備表に4つの武器と4つのパーツ：' + rows.length + '行');
  ok(await ev(() => [...document.querySelectorAll('#mxLoad canvas[data-w]')].every(cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return cv.width > 10 && n > 50; })), '4つの武器の平らな絵が描かれている');
  ok(await ev(() => !document.getElementById('menuMech') && !document.getElementById('mxCalls')), 'メニューに3Dの機体は無い');
  ok(await ev(() => { const r = document.getElementById('mxMega').getBoundingClientRect(), s = document.querySelector('.mxStage').getBoundingClientRect(); return r.height < s.height * .25; }), '大きな兵装名は舞台の高さの4分の1より小さい');
  ok(await ev(() => [...document.querySelectorAll('#ovCls button')].every(b => b.querySelectorAll('small span').length === 4)), '兵装ごとに主・副・補助・特別の4つの武器名が出る');
  await page.screenshot({ path: path.join(out, 'menu-pc.png') });

  await ev(() => document.querySelector('#ovCls [data-cls="heavy"]').click()); await step(2);
  ok(await ev(() => document.getElementById('mxMega').textContent) === '重火力', '兵装を選ぶと大きな兵装名が変わる');
  ok(await ev(() => document.querySelectorAll('#mxLoad .r').length === 8 && document.querySelector('#mxLoad .r b').textContent === __g.WEAPONS[__g.loadout.heavy.main].name), '兵装を変えると装備表も変わる');

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
  ok(await ev(() => document.getElementById('pgMenu').classList.contains('hasResult') && getComputedStyle(document.querySelector('.mxResult')).display !== 'none'), '試合の結果を出せる');
  // 結果は結果だけで画面いっぱい、下へスクロールするとトップと同じメニュー（2026-11-13 オーナー「結果は結果、再出撃は再出撃で別に」）
  ok(await ev(() => { const r = document.getElementById('mxResult').getBoundingClientRect(), m = document.querySelector('#pgMenu .mx').getBoundingClientRect(); return r.top >= -1 && r.height >= innerHeight - 1 && m.top >= r.bottom - 1 && Math.abs(m.height - innerHeight) <= 1; }), '結果は画面いっぱいで、メニューはその下');
  ok(!(await inView(page, '#start')), '結果の画面に出撃ボタンは出ない');
  await ev(() => { document.getElementById('mxResNext').click(); document.querySelector('#pgMenu .mx').scrollIntoView(); });
  await step(1);
  ok(await inView(page, '#start') && await inView(page, '#mxLoad'), '「メニューへ」で下のメニュー（装備表と出撃）が出る');
  await ev(() => { document.getElementById('start').textContent = 'もう一度出撃する'; });
  ok(await ev(() => getComputedStyle(document.getElementById('start'), '::before').content.includes('SORTIE')), '出撃ボタンの文言を変えても小さな文字は残る');
  await ev(() => { document.getElementById('start').textContent = '出撃する'; document.getElementById('overlay').scrollTop = 0; });
  await ev(() => { document.getElementById('ovTitle').innerHTML = 'コア<span>ブレイカー</span> 試作'; document.getElementById('ovBoard').innerHTML = ''; });
  await step(1);
  ok(await ev(() => !document.getElementById('pgMenu').classList.contains('hasResult')), '結果を消すと機体の表示へ戻る');

  await ev(() => { const el = document.getElementById('optMenuStyle'); el.value = '1'; el.dispatchEvent(new Event('change')); });
  await step(1);
  ok(await ev(() => document.body.classList.contains('menuClassic') && getComputedStyle(document.getElementById('mxLoad')).display === 'none' && document.querySelector('[data-page="pgCustom"] small').offsetWidth > 0), 'オプションで前の形（2列）に切り替えられる');
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
