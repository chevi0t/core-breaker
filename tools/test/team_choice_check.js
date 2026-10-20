// 出撃陣営の選択を、実際の出撃・再出撃・勝敗・再試合まで通して確かめる。
// python3 tools/test/make_dbg.py dbg && node tools/test/team_choice_check.js
'use strict';
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {openMap} = require('../mapgen_browser');

(async () => {
  const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const {page, errors} = await openMap(browser, 'tidal', null, 20261021, {silent:true});
    try {
      const report = [];
      assert.equal(await page.locator('input[name="team"]:checked').inputValue(), 'B');
      await page.locator('input[name="team"][value="B"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('input[name="team"]:checked').inputValue(), 'R', 'キーボードで陣営を選べない');
      for (const map of ['tidal','mesa','dock']) for (const team of ['B','R']) {
        await page.evaluate(map => __g.selectMap(map), map);
        await page.check(`input[name="team"][value="${team}"]`);
        for (const outcome of ['win','lose','draw','coreWin','coreLose']) {
          await page.evaluate(() => document.getElementById('start').click());
          const result = await page.evaluate(({team,outcome}) => {
            const g = __g, p = g.player, foe = team === 'B' ? 'R' : 'B';
            const check = (ok, text) => { if (!ok) throw new Error(text); };
            g.renderer.render = () => g.scene.updateMatrixWorld();
            for (const u of g.units) u.frozen = true;
            check(p.team === team && p.isPlayer, '選択した陣営で出撃しない');
            check(g.units.filter(u => u.isPlayer).length === 1, 'プレイヤーが複数いる');
            for (const k of ['B','R']) {
              const us = g.units.filter(u => u.team === k);
              check(us.length === g.curMap.team, '陣営ごとの人数が違う');
              check(new Set(us.map(u => u.idx)).size === us.length, '機体番号が重複する');
              check(us.filter(u => !u.isPlayer).every(u => u.name.startsWith(k === team ? '味方' : '敵')), 'Botの敵味方名が逆');
            }
            check(g.TEAM[team].name === '自軍' && g.TEAM[foe].name === '敵軍', 'スコア表の陣営名が逆');
            const suffix = g.curMap.vs ? '戦力' : 'コア';
            check(document.getElementById('core' + team + 'n').textContent === '自軍' + suffix, '自軍ゲージの名前が逆');
            check(document.getElementById('core' + foe + 'n').textContent === '敵軍' + suffix, '敵軍ゲージの名前が逆');
            const base = g.TEAM[team];
            const inBase = () => Math.abs(p.pos.z - base.baseZ) < 26 && Math.abs(p.yaw - (base.dir > 0 ? Math.PI : 0)) < .001;
            check(inBase(), '初期出撃の位置か向きが逆');
            g.spawn(p, 'base');
            check(inBase(), '再出撃の位置か向きが逆');
            if (!g.curMap.vs) {
              p.onGround = true; p.pos.z = base.baseZ;
              check(g.startTransfer(p, 'base'), '自軍基地でエリア移動できない');
              p.transfer.t = 0;
              g.loop(__advanceClock());
              check(!p.transfer && inBase(), 'エリア移動先が自軍基地でない');
            }
            const max = g.curMap.vs ? g.curMap.vs.cost : 9000;
            const own = outcome === 'coreLose' ? 0 : outcome === 'lose' ? .2 : .6;
            const enemy = outcome === 'coreWin' ? 0 : outcome === 'win' ? .2 : .6;
            g.cores[team].hp = max * own; g.cores[foe].hp = max * enemy;
            g.timeLeft = 0; g.loop(__advanceClock());
            const title = document.getElementById('ovTitle').textContent;
            check(title === (outcome === 'draw' ? '引き分け' : /Win|win/.test(outcome) ? '勝利' : '敗北'), '勝敗が逆：' + title);
            const text = document.getElementById('ovText').textContent;
            check(text.startsWith(g.curMap.vs ? `自軍戦力 ${max * own}　敵軍戦力 ${max * enemy}` : `自軍コア ${(own * 100).toFixed(1)}%　敵軍コア ${(enemy * 100).toFixed(1)}%`), '結果の自軍/敵軍残量が逆');
            check(!document.getElementById('overlay').hidden, '結果画面が開かない');
            check(document.querySelector('input[name="team"]:checked').value === team, '再試合で陣営選択が消えた');
            return {map:g.mapId,team,outcome,title};
          }, {team,outcome});
          report.push(result);
        }
      }
      await page.evaluate(() => __g.selectMap('tidal'));
      assert.equal(await page.locator('input[name="team"]:checked').inputValue(), 'R', 'マップ変更で陣営選択が消えた');
      for (const team of ['B','R']) {
        await page.check(`input[name="team"][value="${team}"]`);
        await page.evaluate(() => document.getElementById('start').click());
        const battle = await page.evaluate(() => {
          const g = __g, before = g.timeLeft;
          for (let i = 0; i < 600 && !g.ended; i++) g.loop(__advanceClock());
          const result = {elapsed:before - g.timeLeft,ended:g.ended,finite:g.units.every(u => u.pos.toArray().every(Number.isFinite) && Number.isFinite(u.hp))};
          g.timeLeft = 0; g.loop(__advanceClock());
          return result;
        });
        assert(battle.elapsed >= 29.9 || battle.ended, `${team}側の試合が進まない`);
        assert(battle.finite, `${team}側の試合で機体の状態が壊れた`);
      }
      await page.check('#largeBattleSw');
      await page.evaluate(() => document.getElementById('start').click());
      assert.deepEqual(await page.evaluate(() => ['B','R'].map(k => __g.units.filter(u => u.team === k).length)), [50,50]);
      assert.equal(await page.evaluate(() => __g.player.team), 'R');
      await page.reload();
      assert.equal(await page.locator('input[name="team"]:checked').inputValue(), 'B', '再読み込みで既定の青に戻らない');
      await page.evaluate(() => document.getElementById('start').click());
      assert.equal(await page.evaluate(() => __g.player.team), 'B');
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`${report.length}通りの出撃・再出撃・勝敗、陣営維持、非対称マップ両陣営30秒、橙50対50に成功。ブラウザエラー0`);
    } finally { await page.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
