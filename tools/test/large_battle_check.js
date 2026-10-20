// 潮路搬送区の50対50を、出撃画面・100機のスコア・本体のBot戦で確認する。
// node tools/test/large_battle_check.js dbg/large-battle [出力フォルダ] [Bot戦の秒=120]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg/large-battle');
const out = path.resolve(process.argv[3] || 'dbg/large-battle/results');
const seconds = Number(process.argv[4] || 120);
assert.ok(Number.isFinite(seconds) && seconds >= 30 && seconds <= 600, 'Bot戦は30〜600秒');
const checks = [], errors = [], battles = [];
const yes = (ok, name) => { assert.ok(ok, name); checks.push(name); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  async function page(allBots = false) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(allBots => {
      window.$ = id => document.getElementById(id);
      window.requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined;
      window.__allBotBattle = allBots;
      let seed = 20261020;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const context = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, options) {
        return context.call(this, kind, /^webgl/.test(kind) ? { ...options, preserveDrawingBuffer: true } : options);
      };
    }, allBots);
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    await p.evaluate(() => {
      window.largeBattleRender = __g.renderer.render.bind(__g.renderer);
      __g.renderer.render = () => __g.scene.updateMatrixWorld();
    });
    return p;
  }
  try {
    const p = await page(), sw = p.getByRole('switch', { name: '50対50（実験）', exact: true });
    yes(await p.locator('#largeBattleControl').isHidden(), '通常マップでは実験スイッチを出さない');
    await p.locator('[data-page="pgMap"]').click();
    await p.locator('[data-map-group="tidal"]').click();
    await p.locator('[data-map="tidal"]').click();
    yes(await sw.isVisible() && !await sw.isChecked() && (await p.locator('#mapNow').textContent()).includes('10対10'), 'マップ選択から新マップへ移り、既定は10対10');
    await sw.check();
    yes((await p.locator('#mapNow').textContent()).includes('50対50（実験）'), '出撃前に実際の50対50を表示');
    await p.screenshot({ path: path.join(out, 'menu.png') });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#largeBattleControl').scrollIntoViewIfNeeded();
    const box = await p.locator('#largeBattleControl').boundingBox();
    yes(box.x >= 0 && box.x + box.width <= 391 && await sw.isChecked(), '小さい画面でも実験スイッチを操作できる');
    await p.setViewportSize({ width: 1280, height: 720 });
    await p.locator('#start').click();
    const roster = await p.evaluate(() => {
      const g = __g; g.running = false;
      return { count: g.units.length, blue: g.units.filter(u => u.team === 'B').length, red: g.units.filter(u => u.team === 'R').length,
        players: g.units.filter(u => u.isPlayer).length, indices: ['B', 'R'].every(t => new Set(g.units.filter(u => u.team === t).map(u => u.idx)).size === 50),
        defined: g.units.every(u => ['attack', 'plant', 'defend'].includes(u.role) && g.CLASSES[u.cls] && g.SLOTS.every(k => u.slots[k]?.w)), mapTeam: g.curMap.team };
    });
    yes(roster.count === 100 && roster.blue === 50 && roster.red === 50 && roster.players === 1, 'プレイヤー1機・味方49機・敵50機で出撃');
    yes(roster.indices && roster.defined && roster.mapTeam === 10, '100機の番号・兵装・役割が有効で、元のマップ定義は10のまま');
    await p.evaluate(() => { const g = __g; g.keys.Tab = true; g.running = true; g.hud(240, .016); });
    await p.waitForTimeout(80);
    yes(await p.locator('#board tbody tr').count() === 100 && (await p.locator('#board caption').allTextContents()).every(t => t.includes('50機')), 'スコア表にも50機ずつ全100機を表示');
    await p.screenshot({ path: path.join(out, 'scoreboard-top.png') });
    await p.mouse.wheel(0, 1100);
    await p.waitForTimeout(80);
    yes(await p.evaluate(() => $('board').scrollTop > 0), 'Tabを押しながらホイールで下位のスコアを読める');
    await p.evaluate(() => { __g.keys.Tab = false; __g.playerUpdate(__g.player, .016); });
    yes(await p.evaluate(() => __g.player.weapon === 'main'), 'スコア表のスクロールで武器が変わらない');
    await p.evaluate(() => { const g = __g; g.keys.Tab = true; $('board').scrollTop = $('board').scrollHeight; });
    await p.screenshot({ path: path.join(out, 'scoreboard-bottom.png') });
    await p.evaluate(() => { const g = __g; g.keys.Tab = false; g.timeLeft = 0; g.loop(performance.now()); g.running = false; });
    yes(await p.locator('#ovBoard tbody tr').count() === 100, '結果画面でも全100機を表示');
    await sw.uncheck(); await p.locator('#start').click();
    yes(await p.evaluate(() => __g.units.length === 20 && __g.units.every(u => u.idx < 10)), 'OFFにして次の試合を始めると10対10に戻る');
    yes(await p.evaluate(() => __g.hittables.filter(m => m.userData.ref?.kind === 'unit').every(m => __g.units.includes(m.userData.ref))), '前の100機の被弾対象を残さない');
    await p.evaluate(() => { __g.running = false; __g.selectMap('tidal-v2'); });
    await p.evaluate(() => { $('largeBattleSw').checked = true; $('largeBattleSw').dispatchEvent(new Event('change')); __g.setup(); });
    yes(await p.evaluate(() => __g.units.length === 100), '上層干渉でも50対50で生成');
    await p.evaluate(() => { __g.selectMap('tidal-v3'); __g.setup(); });
    yes(await p.evaluate(() => __g.units.length === 100), '新マップの配置を変えても人数選択を維持');
    await p.evaluate(() => { __g.selectMap('city'); __g.setup(); });
    yes(await p.evaluate(() => __g.units.length === 20 && !$('largeBattleSw').checked && $('largeBattleControl').hidden), 'ほかのマップへ移ると実験を解除して通常人数に戻る');
    await p.evaluate(() => { __g.selectMap('dock'); __g.setup(); });
    yes(await p.evaluate(() => __g.units.length === __g.curMap.team * 2), '小さいコスト制マップの人数は維持');
    await p.evaluate(() => { __g.selectMap('tidal'); $('largeBattleSw').checked = true; $('largeBattleSw').dispatchEvent(new Event('change')); });
    await p.reload();
    yes(await p.evaluate(() => !$('largeBattleSw').checked && $('mapNow').textContent.includes('10対10')), '再読み込みでは通常人数に戻り、実験を自動再開しない');
    await p.close();

    // 同じシードで通常人数と100機を比べる。本体のAI・物理・射撃・拠点・出撃をそのまま進める。
    for (const [id, large] of [['tidal', false], ['tidal', true], ['tidal-v2', true], ['tidal-v3', true]]) {
      const q = await page(true);
      await q.setViewportSize({ width: 1280, height: 720 });
      const initial = await q.evaluate(({ id, large }) => {
        const g = __g; g.selectMap(id); $('largeBattleSw').checked = large; $('largeBattleSw').dispatchEvent(new Event('change'));
        const began = performance.now(); $('start').click();
        window.battleTimes = []; window.battlePrev = new Map(); window.battleStats = { deaths: 0, respawns: 0, spawns: g.units.length };
        window.battlePositions = new Map(g.units.map(u => [u, u.pos.clone()]));
        return { units: g.units.length, players: g.units.filter(u => u.isPlayer).length, setupMs: performance.now() - began };
      }, { id, large });
      yes(initial.units === (large ? 100 : 20) && initial.players === 0, `${id}/${large ? '50' : '10'}対の実試合は全機Bot`);
      const began = Date.now(); let state, next = 30;
      do {
        state = await q.evaluate(() => {
          const g = __g;
          // 1回の評価を短く区切り、進行を観測できるようにする。
          for (let i = 0; i < 20 && !g.ended; i++) {
            const before = performance.now(); g.loop(performance.now()); battleTimes.push(performance.now() - before);
            for (const u of g.units) {
              const prev = battlePrev.get(u);
              if (prev?.alive && !u.alive) battleStats.deaths++;
              if (prev && u.alive && !prev.alive) battleStats.respawns++;
              battlePrev.set(u, { alive: u.alive });
              if (!u.pos.toArray().every(Number.isFinite) || !Number.isFinite(u.hp)) throw Error('機体の状態が数値ではない');
            }
          }
          return { elapsed: g.MATCH - g.timeLeft, ended: g.ended };
        });
        if (state.elapsed >= next) { console.log(`${id}/${large ? '50対50' : '10対10'}：${Math.round(state.elapsed)}秒まで進行`); next += 30; }
        if (Date.now() - began > 600000) throw Error(`${id}: 10分の実時間で指定時間まで進まない`);
      } while (state.elapsed + 1e-6 < seconds && !state.ended);
      const result = await q.evaluate(() => {
        const g = __g, sorted = battleTimes.slice().sort((a, b) => a - b), pct = f => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
        return { elapsed: g.MATCH - g.timeLeft, ended: g.ended, units: g.units.length, alive: g.units.filter(u => u.alive).length, core: [g.cores.B.hp, g.cores.R.hp],
          kills: g.units.reduce((s, u) => s + u.sc.kills, 0), moved: g.units.filter(u => u.pos.distanceTo(battlePositions.get(u)) > 10).length,
          stats: battleStats, plants: g.plants.map(p => ({ id: p.id, owner: p.owner, gauge: p.gauge })),
          cpuLoopMs: { mean: battleTimes.reduce((a, b) => a + b, 0) / sorted.length, median: pct(.5), p95: pct(.95), max: sorted.at(-1), samples: sorted.length } };
      });
      yes(result.units === initial.units && result.moved >= initial.units / 2 && (result.elapsed + .01 >= seconds || result.ended), `${id}/${large ? '50' : '10'}対で指定時間を進め、半数以上が出撃位置から移動`);
      battles.push({ id, team: large ? 50 : 10, seed: 20261020, ...initial, ...result, wallMs: Date.now() - began });
      fs.writeFileSync(path.join(out, 'battles.json'), JSON.stringify({ seconds, battles, errors }, null, 2) + '\n');
      if (id === 'tidal' && large) {
        await q.evaluate(async () => {
          const g = __g; g.running = false; g.keys.Tab = false; g.hud(240, .016); $('announce').replaceChildren();
          // 最初の陣営の生存Botの視点で、戦っている本体の3D画面を撮影する。
          const u = g.units.find(u => u.team === 'B' && u.alive && Math.abs(u.pos.z) < 230) || g.units.find(u => u.team === 'B' && u.alive);
          if (u) g.updateCamera(u, 1);
          largeBattleRender(g.scene, g.camera); g.renderer.getContext().finish();
          const frame = new Image(); frame.src = g.renderer.domElement.toDataURL(); await frame.decode();
          frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; $('game').appendChild(frame); g.renderer.domElement.style.visibility = 'hidden';
        });
        await q.screenshot({ path: path.join(out, 'battlefield.png') });
      }
      console.log(`${id}/${large ? '50対50' : '10対10'}：撃破${result.kills}、CPU中央値${result.cpuLoopMs.median.toFixed(1)}ms・95%点${result.cpuLoopMs.p95.toFixed(1)}ms`);
      await q.close();
    }
    yes(errors.length === 0, 'ブラウザのエラーなし');
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ passed: checks.length, checks, seconds, battles, errors }, null, 2) + '\n');
    console.log(`大人数実験：${checks.length}項目・${battles.length}試合、成功。ブラウザエラー0`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
