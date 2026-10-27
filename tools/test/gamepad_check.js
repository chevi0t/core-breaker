// コントローラー（Gamepad API の標準配置）の操作を、偽のコントローラーで確かめる。
// node tools/test/gamepad_check.js dbg [出力フォルダ]
// メニューの選択・決定・戻る、オプションの値、出撃、移動・視点・射撃・リロード・持ち替え・ダッシュ・ジャンプ・全体マップ・指示出し・
// 一時停止・スコア表・再出撃の画面、振動、キーボードがそのまま使えること、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || '/tmp/gamepad-check');
const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, touch: 17 };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => {
      requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined;
      // 偽のコントローラー：__padState を書き換えると、次に読んだときに反映される
      window.__padState = { connected: false, buttons: Array(18).fill(0), axes: [0, 0, 0, 0] };
      window.__rumbles = [];
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        const s = window.__padState;
        if (!s.connected) return [null, null, null, null];
        return [{ id: 'Test Controller (STANDARD GAMEPAD Vendor: 0000 Product: 0000)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: s.axes.slice(),
          buttons: s.buttons.map(v => ({ pressed: v > .5, touched: v > 0, value: v })),
          vibrationActuator: { playEffect: (type, o) => { window.__rumbles.push({ type, ...o }); return Promise.resolve('complete'); } } }, null, null, null];
      } });
    });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const step = (n = 1) => page.evaluate(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    const setBtn = (b, v) => page.evaluate(([i, v]) => { window.__padState.buttons[i] = v; }, [B[b], v]);
    const setAxes = a => page.evaluate(a => { window.__padState.axes = a; }, a);
    const tap = async (b, hold = 1) => { await setBtn(b, 1); await step(hold); await setBtn(b, 0); await step(1); };
    const ev = (f, a) => page.evaluate(f, a);
    await step(2);

    // つなぐ
    await ev(() => { window.__padState.connected = true; dispatchEvent(new Event('gamepadconnected')); });
    await step(1);
    ok((await ev(() => document.getElementById('padStatus').textContent)).includes('つながっています：Test Controller'), 'オプションの表示：つながっている');

    // メニュー：最初の十字キーで出撃ボタンを選び、上で別の物へ、× で開き、○ で戻る
    await tap('down');
    ok(await ev(() => document.activeElement.id === 'start' && document.body.classList.contains('padNav')), 'メニュー：最初は出撃ボタンを選ぶ');
    await tap('up');
    ok(await ev(() => document.activeElement.id !== 'start' && document.getElementById('overlay').contains(document.activeElement)), 'メニュー：上で別の物へ移る');
    await ev(() => document.querySelector('[data-page="pgOptions"]').focus());
    await tap('cross'); await step(1);
    ok(await ev(() => !document.getElementById('pgOptions').hidden), 'メニュー：× でオプションを開く');
    ok(await ev(() => document.activeElement.id === 'optMaster'), 'オプション：開いたら最初のスライダーを選ぶ（「戻る」でも初期化ボタンでもない）');
    await tap('left');
    ok(await ev(() => __g.gameOptions.master === 95), 'オプション：左でスライダーを5下げる');
    await tap('right');
    ok(await ev(() => __g.gameOptions.master === 100), 'オプション：右で戻す');
    await ev(() => document.getElementById('optPadInvert').focus());
    await tap('cross');
    ok(await ev(() => __g.gameOptions.padInvert === 1 && document.getElementById('optPadInvert').checked), 'オプション：× で上下反転のスイッチを入れる');
    await tap('cross');
    ok(await ev(() => __g.gameOptions.padInvert === 0), 'オプション：もう一度 × で切る');
    await tap('circle'); await step(1);
    ok(await ev(() => !document.getElementById('pgMenu').hidden), 'メニュー：○ で戻る');
    ok(await ev(() => document.activeElement.id === 'start'), 'メニュー：戻ったら出撃ボタンを選ぶ');
    await page.screenshot({ path: path.join(out, 'menu.png') });

    // 出撃
    await tap('cross'); await step(1);
    ok(await ev(() => __g.running && document.getElementById('overlay').hidden), '× で出撃');
    await ev(() => {
      const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld();
      for (const u of __g.units) if (!u.isPlayer) u.frozen = true;
      const p = __g.player; p.invulT = 1e6;
    });
    await step(4);
    ok(await ev(() => document.getElementById('center').textContent !== '画面をクリックで操作に戻る'), 'コントローラーを使っている間は「画面をクリック」を出さない');

    // 移動：左スティックを前へ
    const before = await ev(() => { const p = __g.player; return { x: p.pos.x, z: p.pos.z, yaw: p.yaw, pitch: p.pitch }; });
    await setAxes([0, -1, 0, 0]); await step(12); await setAxes([0, 0, 0, 0]); await step(2);
    const moved = await ev(([x, z, yaw]) => { const p = __g.player; return (p.pos.x - x) * -Math.sin(yaw) + (p.pos.z - z) * -Math.cos(yaw); }, [before.x, before.z, before.yaw]);
    ok(moved > 2, `左スティックで前へ進む（${moved.toFixed(1)}m）`);
    // 遊びの中は動かない
    await step(30); // 止まるまで待つ
    const p0 = await ev(() => __g.player.pos.toArray());
    await setAxes([0.1, -0.1, 0.1, 0]); await step(6); await setAxes([0, 0, 0, 0]);
    const drift = await ev(([x, y, z]) => Math.hypot(__g.player.pos.x - x, __g.player.pos.z - z), p0);
    ok(drift < 0.3, `スティックの遊び（0.15）の中では動かない（${drift.toFixed(2)}m）`);

    // 視点：右スティック
    const y0 = await ev(() => __g.player.yaw);
    await setAxes([0, 0, 1, 0]); await step(6); await setAxes([0, 0, 0, 0]);
    const dYaw = await ev(y0 => __g.player.yaw - y0, y0);
    ok(dYaw < -0.5 && dYaw > -2, `右スティックを右へ倒すと右を向く（${dYaw.toFixed(2)}rad / 0.3秒）`);
    const pt0 = await ev(() => { __g.player.pitch = 0; return 0; });
    await setAxes([0, 0, 0, -1]); await step(3); await setAxes([0, 0, 0, 0]);
    ok(await ev(() => __g.player.pitch > 0.2), '右スティックを上へ倒すと上を向く');
    await ev(() => { __g.gameOptions.padInvert = 1; __g.player.pitch = 0; });
    await setAxes([0, 0, 0, -1]); await step(3); await setAxes([0, 0, 0, 0]);
    ok(await ev(() => __g.player.pitch < -0.2), '上下反転：上へ倒すと下を向く');
    await ev(() => { __g.gameOptions.padInvert = 0; __g.player.pitch = 0; });

    // 射撃・リロード・持ち替え
    await ev(() => __g.selectWeapon(__g.player, 'main')); await step(12);
    const ammo0 = await ev(() => __g.player.slots.main.ammo);
    await setBtn('r2', 1); await step(10); await setBtn('r2', 0); await step(1);
    const ammo1 = await ev(() => __g.player.slots.main.ammo);
    ok(ammo1 < ammo0, `R2 で撃つ（残弾 ${ammo0}→${ammo1}）`);
    await setBtn('r2', 0.3); await step(4);
    ok(await ev(a => __g.player.slots.main.ammo === a, ammo1), 'R2 を浅く押しただけ（0.3）では撃たない');
    await setBtn('r2', 0); await step(1);
    await tap('square'); await step(1);
    ok(await ev(() => __g.player.slots.main.reloadT > 0), '□ でリロード');
    await step(80);
    await tap('right'); await step(1);
    ok(await ev(() => __g.player.weapon === 'sub'), '十字キー右で副武器');
    await step(20); await tap('up'); await step(1);
    ok(await ev(() => __g.player.weapon === 'main'), '十字キー上で主武器');
    await step(20); await tap('r1'); await step(1);
    ok(await ev(() => __g.player.weapon === 'sub'), 'R1 で次の武器');
    await step(20); await tap('up'); await step(20);

    // ダッシュとジャンプ
    await setAxes([0, -1, 0, 0]); await tap('l1');
    ok(await ev(() => !!__g.player.dashState), `L1 の短押しでダッシュ（${await ev(() => __g.player.dashState)}）`);
    await setAxes([0, 0, 0, 0]); await step(30);
    const yBefore = await ev(() => __g.player.pos.y);
    await tap('cross', 2); await step(3);
    ok(await ev(y => __g.player.pos.y > y + 0.5, yBefore), '× でジャンプ');
    await step(60);

    // 全体マップ：クリエイトで開き、右スティックでカーソル、R2 で「ここへ向かえ」
    await tap('create'); await step(1);
    ok(await ev(() => __g.mapOpen && !document.getElementById('bigMap').hidden), 'クリエイトで全体マップ');
    ok((await ev(() => document.querySelector('#bigMap .bmh span:nth-child(2)').textContent)).includes('R2'), '全体マップの案内がコントローラーのボタン');
    const cur0 = await ev(() => __g.player.pos.x);
    await setAxes([0, 0, 1, 0]); await step(6); await setAxes([0, 0, 0, 0]);
    const feedBefore = await ev(() => document.getElementById('feed').textContent);
    await tap('r2'); await step(1);
    ok((await ev(() => document.getElementById('feed').textContent)) !== feedBefore, '全体マップで R2 を押すと指示を送る');
    await tap('create'); await step(1);
    ok(await ev(() => !__g.mapOpen), 'もう一度クリエイトで閉じる');

    // 指示出し：△長押し＋右スティック
    await setBtn('triangle', 1); await step(1);
    ok(await ev(() => __g.qc.open), '△長押しで指示出しの円');
    await setAxes([0, 0, 0, -1]); await step(2);
    ok(await ev(() => __g.qc.pick === 0), '右スティックを上へで「ここへ向かえ」');
    await setAxes([0, 0, 0, 0]); await step(1);
    await setBtn('triangle', 0); await step(1);
    ok(await ev(() => !__g.qc.open), '△を離すと送って閉じる');

    // スコア表：タッチパッドを押している間
    await setBtn('touch', 1); await step(1);
    ok(await ev(() => !document.getElementById('board').hidden), 'タッチパッドを押している間スコア表');
    await setBtn('touch', 0); await step(1);
    ok(await ev(() => document.getElementById('board').hidden), '離すと閉じる');

    // 一時停止：オプションボタン
    await tap('options'); await step(1);
    ok(await ev(() => !__g.running && !document.getElementById('pgOptions').hidden && document.activeElement.id === 'optionsResume'), 'オプションボタンで一時停止し、「戦闘に戻る」を選ぶ');
    await tap('cross'); await step(1);
    ok(await ev(() => __g.running && document.getElementById('overlay').hidden), '× で戦闘に戻る');

    // 振動
    await ev(() => __g.flashDamage(null, 4000));
    ok(await ev(() => window.__rumbles.length === 1 && window.__rumbles[0].type === 'dual-rumble'), '被弾で振動');
    await ev(() => { __g.gameOptions.padRumble = 0; __g.flashDamage(null, 4000); __g.gameOptions.padRumble = 1; });
    ok(await ev(() => window.__rumbles.length === 1), '振動を切ると震えない');

    // 再出撃の画面：十字キーの上下で兵装
    await ev(() => { const p = __g.player; p.invulT = 0; __g.kill(p, __g.units.find(u => u.team !== p.team)); p.downT = 0; });
    await step(2);
    ok(await ev(() => !__g.player.alive && !document.getElementById('respawn').hidden), '撃破されて再出撃の画面');
    ok((await ev(() => document.getElementById('rtCls').textContent)).includes('十字キー'), '再出撃の画面の案内がコントローラーのボタン');
    const cls0 = await ev(() => __g.chosenCls);
    await tap('down'); await step(1);
    const cls1 = await ev(() => __g.chosenCls);
    ok(cls1 !== cls0 && await ev(c => __g.player.nextCls === c, cls1), `十字キー下で次の兵装（${cls0}→${cls1}）`);
    await tap('up'); await step(1);
    ok(await ev(c => __g.chosenCls === c, cls0), '十字キー上で戻す');
    await page.screenshot({ path: path.join(out, 'respawn.png') });
    await step(Math.ceil(await ev(() => __g.player.respawnT) / 0.05) + 4);
    ok(await ev(() => __g.player.alive), '数え終わると出撃');
    await ev(() => { __g.player.invulT = 1e6; });

    // キーボードもそのまま使える（本物のキー入力）
    const k0 = await ev(() => __g.player.pos.toArray());
    await page.keyboard.down('KeyW'); await step(10); await page.keyboard.up('KeyW'); await step(2);
    ok(await ev(([x, y, z]) => Math.hypot(__g.player.pos.x - x, __g.player.pos.z - z) > 2, k0), 'キーボードの W でも進む');

    // 外す
    await ev(() => { window.__padState.connected = false; const e = new Event('gamepaddisconnected'); e.gamepad = { index: 0 }; dispatchEvent(e); });
    await step(2);
    ok(await ev(() => __g.pad.index === -1 && document.getElementById('padStatus').textContent.startsWith('つながっていません')), '外すとオプションの表示も戻る');

    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`コントローラー：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
