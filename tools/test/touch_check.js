// スマホ・タブレットのタッチ操作を、タッチの端末の真似（横向き 844×390）と CDP のタッチ入力で確かめる。
// node tools/test/touch_check.js dbg [出力フォルダ]
// メニュー（マップは軽い物だけ、人数は5対5と10対10だけ）、試合中だけボタンを出すこと、移動スティック・ダッシュ・視点・2本指・
// 射撃・リロード・武器・ジャンプ・ロック・アクション・全体マップ・指示・スコア・一時停止、コンソールを試合中だけ標準にすること、
// 再出撃の画面、縦向きの案内、PC（タッチでない端末）は今までどおりなこと、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || '/tmp/touch-check');
const W = 844, H = 390;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
  const open = async opts => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...opts });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => {
      requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined;
      if (!sessionStorage.getItem('__set')) { sessionStorage.setItem('__set', 1); localStorage.setItem('coreBreakerConsole', 'arcade'); }
    });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    return { ctx, page, errors };
  };
  try {
    const { ctx, page, errors } = await open({ hasTouch: true, isMobile: true });
    const ev = (f, a) => page.evaluate(f, a);
    const step = (n = 1) => ev(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    // CDP のタッチ。active に触っている指を持ち、押す・動かすときは全部の指を送る
    const cdp = await ctx.newCDPSession(page), active = new Map();
    const pts = () => [...active].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4 }));
    const down = (id, x, y) => { active.set(id, { x, y }); return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); };
    const move = async (id, x, y, n = 4) => {
      const p0 = active.get(id);
      for (let i = 1; i <= n; i++) { active.set(id, { x: p0.x + (x - p0.x) * i / n, y: p0.y + (y - p0.y) * i / n }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); }
    };
    const up = id => { const p = active.get(id); active.delete(id); return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); }; // 送った指だけを離す
    const at = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const press = async (sel, id = 9) => { const c = await at(sel); await down(id, c.x, c.y); return c; };
    const tapBtn = async (sel, hold = 1) => { await press(sel); await step(hold); await up(9); await step(1); };
    await step(2);
    // メニューに出ているマップ（配置が複数あるマップは1行にまとめてあるので、その行の配置を全部数える）
    const listedMaps = `() => [...document.querySelectorAll('#mapList [data-map], #mapList [data-map-group]')].flatMap(b => b.dataset.map ? [b.dataset.map] : Object.keys(__g.MAPS).filter(k => __g.MAPS[k].group === b.dataset.mapGroup && !__g.MAPS[k].testOnly && __g.mobileOk(__g.MAPS[k])))`;

    // メニュー
    ok(await ev(() => __g.TOUCH && document.body.classList.contains('touch')), 'タッチの端末と見分ける');
    ok(await ev(() => getComputedStyle(document.getElementById('tcPad')).display === 'none' && !__g.touchPlay), 'メニューではボタンを出さない');
    const sizes = await ev(() => [...document.getElementById('teamSize').options].map(o => +o.value));
    ok(JSON.stringify(sizes) === '[5,10]', `人数は5対5と10対10だけ（${sizes}）`);
    const listed = [...new Set(await ev(`(${listedMaps})()`))];
    const all = await ev(() => Object.keys(__g.MAPS).filter(k => !__g.MAPS[k].testOnly));
    const heavy = all.filter(k => !listed.includes(k));
    ok(listed.length > 0 && listed.every(k => ['mesa', 'wide', 'city'].includes(k) || k.startsWith('circulation')), `軽いマップだけ並べる（${listed.join('・')}）`);
    ok(heavy.some(k => k.startsWith('tidal')) && heavy.includes('kanto') && heavy.includes('hoshimichi') && heavy.includes('dock'), `重いマップと5対5・10対10でないマップは出さない（${heavy.join('・')}）`);
    ok(await ev(() => __g.mobileOk(__g.MAPS[__g.mapId])), '選んでいるマップも軽い物');
    ok(await ev(() => getComputedStyle(document.querySelector('#pgOptions .touchOnly')).display !== 'none' && !!document.getElementById('optTouchLook')), 'オプションにタッチ操作の設定がある');
    ok(await ev(() => __g.consoleMode === 'arcade'), '（準備）コンソールをアーケードにしてある');
    await page.screenshot({ path: path.join(out, 'menu.png') });

    // 出撃
    await page.tap('#start'); await step(2);
    ok(await ev(() => __g.running && document.getElementById('overlay').hidden), '出撃ボタンをタップで出撃');
    await ev(() => {
      const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld();
      for (const u of __g.units) if (!u.isPlayer) u.frozen = true;
      __g.player.invulT = 1e6;
    });
    await step(4);
    ok(await ev(() => __g.touchPlay && document.body.classList.contains('touchPlay') && getComputedStyle(document.getElementById('tcPad')).display === 'block'), '試合中はボタンを出す');
    ok(await ev(() => __g.consoleMode === 'standard' && localStorage.getItem('coreBreakerConsole') === 'arcade'), '試合中はコンソールを標準にする（保存した選択は変えない）');
    ok(await ev(() => document.getElementById('center').textContent !== '画面をクリックで操作に戻る'), '「画面をクリック」を出さない');
    // 右上のボタンが敵軍コアの表示と重ならない
    ok(await ev(() => { const a = document.getElementById('tcTop').getBoundingClientRect(), b = document.getElementById('top').getBoundingClientRect(); return a.left >= b.right; }), '右上のボタンがコアの表示と重ならない');
    ok(await ev(() => [...document.querySelectorAll('.tcb, #tcTop button')].every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height < 90)), 'ボタンの名前が折り返さず収まる');
    await page.screenshot({ path: path.join(out, 'battle.png') });

    // 移動スティック：左半分を触って上へ
    const pos = () => ev(() => { const p = __g.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw }; });
    const fwd = (a, b) => (b.x - a.x) * -Math.sin(a.yaw) + (b.z - a.z) * -Math.cos(a.yaw);
    let p0 = await pos();
    await down(1, 160, 260); await step(1);
    ok(await ev(() => !document.getElementById('tcStick').hidden), '左半分を触るとスティックが出る');
    await move(1, 160, 205); await step(12);
    ok(fwd(p0, await pos()) > 2, `スティックを上へで前へ進む（${fwd(p0, await pos()).toFixed(1)}m）`);
    ok(await ev(() => !__g.touch.dash && !__g.player.dashState), '輪の内側ではダッシュしない');
    await move(1, 160, 170); await step(2);
    ok(await ev(() => __g.touch.dash && document.getElementById('tcStick').classList.contains('dash') && !!__g.player.dashState), `外の輪まで倒すとダッシュ（${await ev(() => __g.player.dashState)}）`);
    await up(1); await step(1);
    ok(await ev(() => document.getElementById('tcStick').hidden && __g.touch.fwd === 0 && !__g.touch.dash && !__g.keys.ShiftRight), '離すとスティックが消え、止まる');
    await step(40);
    p0 = await pos();
    await down(1, 160, 260); await move(1, 163, 257); await step(6); await up(1);
    ok(Math.hypot((await pos()).x - p0.x, (await pos()).z - p0.z) < 0.3, '遊びの中では動かない');
    await step(20);

    // 視点：右半分をなぞる
    let y0 = await ev(() => __g.player.yaw);
    await down(2, 520, 180); await move(2, 620, 180); await up(2); await step(1);
    let dYaw = await ev(y0 => __g.player.yaw - y0, y0);
    ok(dYaw < -0.3 && dYaw > -1.2, `右半分を右へなぞると右を向く（${dYaw.toFixed(2)}rad / 100px）`);
    await ev(() => { __g.player.pitch = 0; });
    await down(2, 520, 200); await move(2, 520, 150); await up(2); await step(1);
    ok(await ev(() => __g.player.pitch > 0.1), '上へなぞると上を向く');
    await ev(() => { __g.player.pitch = 0; __g.gameOptions.touchLook = 100; });
    y0 = await ev(() => __g.player.yaw);
    await down(2, 520, 180); await move(2, 620, 180); await up(2); await step(1);
    ok(await ev(([y0, d]) => __g.player.yaw - y0 < d * 1.4, [y0, dYaw]), '視点の速さを上げると速く回る');
    await ev(() => { __g.gameOptions.touchLook = 50; });

    // 2本指：スティックで進みながら視点
    p0 = await pos(); y0 = p0.yaw;
    await down(1, 160, 260); await move(1, 160, 210);
    await down(2, 520, 180); await move(2, 580, 180); await step(10);
    ok(fwd(p0, await pos()) > 1 && await ev(y0 => __g.player.yaw < y0 - 0.15, y0), '2本指で進みながら向きを変える');
    await up(2); await step(1);
    ok(await ev(() => __g.touch.fwd > 0.5), '視点の指を離してもスティックはそのまま');
    await up(1); await step(30);

    // 射撃：押している間撃ち、押したまま動かすと狙いも動く
    await ev(() => __g.selectWeapon(__g.player, 'main')); await step(12);
    const ammo0 = await ev(() => __g.player.slots.main.ammo);
    const fc = await press('[data-tc="fire"]'); await step(8);
    y0 = await ev(() => __g.player.yaw);
    await move(9, fc.x - 40, fc.y); await step(2);
    ok(await ev(y0 => __g.player.yaw > y0 + 0.1, y0), '射撃ボタンを押したまま左へ動かすと左を向く');
    await up(9); await step(1);
    const ammo1 = await ev(() => __g.player.slots.main.ammo);
    ok(ammo1 < ammo0, `射撃ボタンで撃つ（残弾 ${ammo0}→${ammo1}）`);
    ok(await ev(() => !__g.mouseDown && !document.querySelector('[data-tc="fire"]').classList.contains('on')), '離すと撃ち止める');

    // リロード
    await tapBtn('[data-tc="reload"]');
    ok(await ev(() => __g.player.slots.main.reloadT > 0), 'リロードボタン');
    await step(80);

    // 武器：短く押すと次、押したまま上へで主武器
    await tapBtn('[data-tc="weapon"]'); await step(1);
    ok(await ev(() => __g.player.weapon === 'sub'), '武器ボタンを短く押すと次の武器');
    await step(20);
    const wc = await press('[data-tc="weapon"]'); await step(1);
    ok(await ev(() => __g.wsel.open), '武器ボタンを押すと武器の円');
    await move(9, wc.x, wc.y - 40); await step(1);
    ok(await ev(() => __g.wsel.pick === 'main'), '押したまま上へで主武器を指す');
    await up(9); await step(1);
    ok(await ev(() => !__g.wsel.open && __g.player.weapon === 'main'), '離すと主武器に持ち替える');
    await step(20);

    // ジャンプ
    const yb = (await pos()).y;
    await tapBtn('[data-tc="jump"]', 2); await step(3);
    ok((await pos()).y > yb + 0.5, 'ジャンプボタン');
    await step(60);

    // ダッシュボタン
    await down(1, 160, 260); await move(1, 160, 215);
    await tapBtn('[data-tc="dash"]');
    ok(await ev(() => !!__g.player.dashState), 'ダッシュボタン（スティックを倒しながら）');
    await up(1); await step(30);

    // ロック・アクション：押している間
    await press('[data-tc="lock"]'); await step(1);
    ok(await ev(() => __g.rightDown), 'ロックボタンで右クリックと同じ');
    await up(9); await step(1);
    ok(await ev(() => !__g.rightDown), '離すと右クリックも離す');
    await press('[data-tc="act"]'); await step(1);
    ok(await ev(() => __g.keys.KeyE && __g.keys.KeyF), 'アクションボタンで E・F');
    await up(9); await step(1);
    ok(await ev(() => !__g.keys.KeyE && !__g.keys.KeyF), '離すと E・F も離す');

    // 全体マップ：タップで開き、地図をタップで指示、もう一度で閉じる
    await tapBtn('[data-tc="map"]');
    ok(await ev(() => __g.mapOpen && !document.getElementById('bigMap').hidden), 'マップボタンで全体マップ');
    ok((await ev(() => document.querySelector('#bigMap .bmh span:nth-child(2)').textContent)).includes('タップ'), '全体マップの案内がタッチの言葉');
    const feed0 = await ev(() => document.getElementById('feed').textContent);
    const mc = await at('#bigMapC');
    await page.touchscreen.tap(mc.x, mc.y - 30); await step(1);
    ok((await ev(() => document.getElementById('feed').textContent)) !== feed0, '地図をタップで「ここへ向かえ」');
    await page.screenshot({ path: path.join(out, 'map.png') });
    await tapBtn('[data-tc="map"]');
    ok(await ev(() => !__g.mapOpen), 'もう一度マップボタンで閉じる');

    // 指示：押したまま上へ、離すと送る
    const cc = await press('[data-tc="chat"]'); await step(1);
    ok(await ev(() => __g.qc.open), '指示ボタンで指示の円');
    await move(9, cc.x, cc.y - 40); await step(1);
    ok(await ev(() => __g.qc.pick === 0), '押したまま上へで「ここへ向かえ」');
    await up(9); await step(1);
    ok(await ev(() => !__g.qc.open), '離すと送って閉じる');

    // スコア表：押している間
    await press('[data-tc="score"]'); await step(1);
    ok(await ev(() => !document.getElementById('board').hidden), 'スコアボタンを押している間スコア表');
    await up(9); await step(1);
    ok(await ev(() => document.getElementById('board').hidden), '離すと閉じる');

    // 一時停止：オプションの画面へ。ボタンを隠してコンソールを戻し、戻ったらまた出す
    await tapBtn('[data-tc="pause"]');
    ok(await ev(() => !__g.running && !document.getElementById('pgOptions').hidden), 'II で一時停止（オプション）');
    ok(await ev(() => !__g.touchPlay && getComputedStyle(document.getElementById('tcPad')).display === 'none' && __g.consoleMode === 'arcade'), '一時停止中はボタンを隠し、コンソールを元に戻す');
    await page.screenshot({ path: path.join(out, 'options.png') });
    await page.tap('#optionsResume'); await step(2);
    ok(await ev(() => __g.running && __g.touchPlay && __g.consoleMode === 'standard'), '戦闘に戻るとまたボタンを出す');

    // 再出撃の画面：タッチの言葉で、兵装をタップで選べる
    await ev(() => { const p = __g.player; p.invulT = 0; __g.kill(p, __g.units.find(u => u.team !== p.team)); p.downT = 0; });
    await step(2);
    ok(await ev(() => !__g.player.alive && !document.getElementById('respawn').hidden), '撃破されて再出撃の画面');
    ok((await ev(() => document.getElementById('rtCls').textContent)).includes('タップ'), '再出撃の画面の案内がタッチの言葉');
    ok(await ev(() => getComputedStyle(document.getElementById('tcPad')).display === 'none' && getComputedStyle(document.getElementById('tcTop')).display !== 'none'), '再出撃の画面では右下のボタンを隠す（右上は残す）');
    const cls0 = await ev(() => __g.chosenCls);
    const other = await ev(c => { const b = [...document.querySelectorAll('#respawn [data-cls]')].find(b => b.dataset.cls !== c); return b && b.dataset.cls; }, cls0);
    if (other) {
      await page.tap(`#respawn [data-cls="${other}"]`); await step(1);
      ok(await ev(c => __g.chosenCls === c, other), `兵装をタップで選ぶ（${cls0}→${other}）`);
    }
    await page.screenshot({ path: path.join(out, 'respawn.png') });
    await step(Math.ceil(await ev(() => __g.player.respawnT) / 0.05) + 4);
    ok(await ev(() => __g.player.alive && __g.touchPlay && getComputedStyle(document.getElementById('tcPad')).display === 'block'), '数え終わると出撃し、ボタンを出す');

    // 縦向きでは「横向きに」
    await page.setViewportSize({ width: H, height: W }); await step(1);
    ok(await ev(() => getComputedStyle(document.getElementById('touchRotate')).display !== 'none'), '縦向きでは「横向きにしてください」');
    await page.screenshot({ path: path.join(out, 'portrait.png') });
    await page.setViewportSize({ width: W, height: H }); await step(1);
    ok(await ev(() => getComputedStyle(document.getElementById('touchRotate')).display === 'none'), '横向きに戻すと消える');

    ok(errors.length === 0, 'ブラウザのエラーなし（タッチ）' + (errors.length ? '\n' + errors.join('\n') : ''));
    await ctx.close();

    // PC：今までどおり（マップは全部、人数は2〜50、ボタンは出さない）
    const pc = await open({});
    const pev = (f, a) => pc.page.evaluate(f, a);
    await pev(() => { for (let i = 0; i < 2; i++) __g.loop(window.__t = (window.__t || 0) + 50); });
    ok(await pev(() => !__g.TOUCH && !document.body.classList.contains('touch')), 'PC はタッチの端末と見なさない');
    const pcSizes = await pev(() => [...document.getElementById('teamSize').options].map(o => +o.value));
    ok(pcSizes.length === 49 && pcSizes[0] === 2 && pcSizes[48] === 50, 'PC の人数は今までどおり2〜50');
    const pcListed = [...new Set(await pev(`(${listedMaps})()`))];
    ok(all.every(k => pcListed.includes(k)), `PC のマップは全部（${pcListed.length}）`);
    ok(await pev(() => getComputedStyle(document.querySelector('#pgOptions .touchOnly')).display === 'none'), 'PC ではタッチ操作の設定を出さない');
    await pev(() => document.getElementById('start').click());
    await pev(() => { const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); for (let i = 0; i < 4; i++) __g.loop(window.__t = (window.__t || 0) + 50); });
    ok(await pev(() => __g.running && !__g.touchPlay && getComputedStyle(document.getElementById('tcPad')).display === 'none' && __g.consoleMode === 'arcade'), 'PC の試合ではボタンを出さず、コンソールもそのまま');
    ok(pc.errors.length === 0, 'ブラウザのエラーなし（PC）' + (pc.errors.length ? '\n' + pc.errors.join('\n') : ''));
    await pc.ctx.close();

    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`タッチ操作：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
