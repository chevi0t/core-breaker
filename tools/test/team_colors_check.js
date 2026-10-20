// 南北を切り替えても自軍が青になることを、描画色・実際の弾・HUD・地図で確かめる。
// python3 tools/test/make_dbg.py dbg && node tools/test/team_colors_check.js
'use strict';
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {openMap} = require('../mapgen_browser');

(async () => {
  const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const {page, errors} = await openMap(browser, 'tidal', null, 20261021, {silent:true});
    try {
      for (const team of ['B','R','B']) {
        await page.check(`input[name="team"][value="${team}"]`);
        assert(!/青基地|橙基地/.test(await page.locator('#mapList').innerText()), 'マップ説明が固定の色で場所を指している');
        const preview = await page.evaluate(team => {
          const g = __g, cv = document.querySelector('[data-preview="tidal"] canvas, [data-map="tidal"] canvas');
          const pixel = k => Array.from(cv.getContext('2d').getImageData(Math.floor(cv.width / 2), Math.floor(((k === 'B' ? 1 : -1) * g.curMap.baseZ + g.curMap.size[1]) / (g.curMap.size[1] * 2) * cv.height), 1, 1).data).slice(0,3);
          window.__staticFixture = {core:g.cores.B.group,obstacles:JSON.stringify(g.obstacles),nav:JSON.stringify(g.curMap.nav)};
          return {own:pixel(team),enemy:pixel(team === 'B' ? 'R' : 'B')};
        }, team);
        assert.deepEqual(preview, {own:[62,166,255],enemy:[255,138,42]}, '出撃先の見取り図の色が逆');
        await page.evaluate(() => document.getElementById('start').click());
        await page.evaluate(team => {
          const g = __g, p = g.player, enemy = team === 'B' ? 'R' : 'B';
          const check = (ok, text) => { if (!ok) throw new Error(text); };
          g.renderer.render = () => g.scene.updateMatrixWorld();
          for (const u of g.units) u.frozen = true;
          check(g.cores.B.group === __staticFixture.core && JSON.stringify(g.obstacles) === __staticFixture.obstacles && JSON.stringify(g.curMap.nav) === __staticFixture.nav, '色の切替で地形・施設・経路が作り直された');
          const expected = k => k === team ? 0x3ea6ff : 0xff8a2a;
          let facilities = 0;
          g.cores.B.group.parent.traverse(o => {
            if (o.material?.userData?.team) {
              check(o.material.color.getHex() === expected(o.material.userData.team), '基地・施設の3D表示色が逆'); facilities++;
            }
            if (o.userData.teamSign) {
              const rgba = o.material.map.image.getContext('2d').getImageData(4,20,1,1).data;
              check((rgba[0] << 16 | rgba[1] << 8 | rgba[2]) === expected(o.userData.teamSign), '門の標識の色が逆');
            }
          });
          check(facilities > 10, '基地・施設の色を確認できない');
          for (const u of g.units) {
            let colored = false;
            const c = new g.T.Color(expected(u.team));
            u.group.traverse(o => {
              const a = o.userData.own && o.geometry?.attributes.color;
              if (!a) return;
              for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)-c.r) + Math.abs(a.getY(i)-c.g) + Math.abs(a.getZ(i)-c.b) < 1e-5) { colored = true; break; }
            });
            check(colored, 'プレイヤー/Botのチーム色が機体にない');
            const from = u.pos.clone().setY(50), vel = new g.T.Vector3(0,0,-30);
            g.shoot(u,from,vel,{life:1});
            check(g.shells.at(-1).mesh.material.color.getHex() === expected(u.team), '砲弾の陣営色が逆');
            g.shoot(u,from,vel,{bladeWave:true,width:2,range:30,speed:30});
            check(g.shells.at(-1).mesh.material.color.getHex() === (u.team === team ? 0x9eefff : 0xffc691), '光波の陣営色が逆');
            g.shoot(u,from,vel,g.WEAPONS.grenade.proj);
            const tint = new g.T.Color(expected(u.team)).lerp(new g.T.Color(0xffffff),.5);
            check(g.shells.at(-1).mesh.material.color.equals(tint), '投擲物の陣営色が逆');
            g.tracer(from,from.clone().add(vel),u.team);
            check(g.fx.at(-1).obj.material.color.getHex() === (u.team === team ? 0x8fd8ff : 0xffb35c), '通常弾の軌跡の陣営色が逆');
          }
          for (const pl of g.plants) if (pl.owner) check(pl.disc.material.color.getHex() === expected(pl.owner), 'プラントの3D表示色が逆');
          g.cores[team].hp = 9000 * .73; g.cores[enemy].hp = 9000 * .31;
          p.pos.x = 70; // 地図の基地の中央に自機の白い向きの線が重ならないようにする。
          g.keys.Tab = true;
          for (let i = 0; i < 5; i++) __advanceClock();
          g.hud(g.timeLeft,.05); g.tagsHud(p,.05);
          check(document.getElementById('coreBt').textContent === '73.0%' && document.getElementById('coreRt').textContent === '31.0%', 'ゲージが自軍/敵軍の順になっていない');
          const tables = document.querySelectorAll('#boardBody table');
          check(tables[0].className === team && tables[0].caption.textContent.startsWith('自軍'), 'スコア表で自軍が先頭でない');
          check(getComputedStyle(tables[0].caption).color === 'rgb(62, 166, 255)' && getComputedStyle(tables[1].caption).color === 'rgb(255, 138, 42)', 'スコア表の色が逆');
          for (const pl of g.plants) if (pl.owner) check(getComputedStyle(document.getElementById('pl-' + pl.id)).color === (pl.owner === team ? 'rgb(62, 166, 255)' : 'rgb(255, 138, 42)'), 'プラントHUDの色が逆');
          for (const u of g.units) if (!u.isPlayer) check(u.tagEl.style.getPropertyValue('--c') === g.TEAM[u.team].css, '頭上の名前の色が逆');
          const cv = document.getElementById('mini');
          for (const k of ['B','R']) {
            const pixel = cv.getContext('2d').getImageData(Math.floor(cv.width/2),Math.floor((g.TEAM[k].baseZ + g.curMap.size[1])/(g.curMap.size[1]*2)*cv.height),1,1).data;
            check((pixel[0] << 16 | pixel[1] << 8 | pixel[2]) === expected(k), 'ミニマップの基地色が逆');
          }
          g.keys.Tab = false;
        }, team);
        for (const mode of ['standard','arcade','flight','mechanical']) {
          const colors = await page.evaluate(mode => {
            document.querySelector(`[data-console-choice="${mode}"]`).click();
            __g.hud(__g.timeLeft,.05);
            return ['B','R'].map(k => getComputedStyle(document.querySelector('#core' + k + ' > i')).backgroundColor);
          }, mode);
          assert.deepEqual(colors, [mode === 'arcade' ? 'rgb(62, 200, 255)' : 'rgb(62, 166, 255)', 'rgb(255, 138, 42)'], `${mode}のゲージ色が逆`);
        }
        await page.evaluate(() => { __g.timeLeft = 0; __g.loop(__advanceClock()); });
        assert.equal(await page.locator('#ovTitle').innerText(), '勝利');
        assert.equal(await page.locator('#ovTitle span').evaluate(el => getComputedStyle(el).color), 'rgb(62, 166, 255)');
        assert.equal(await page.locator('#ovBoard table').first().getAttribute('class'), team);
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('南→北→南の切替：基地・施設・機体・プラント・地図・頭上表示・弾・全4HUD・スコア・勝利表示で自軍は青。地形/経路は同一、ブラウザエラー0');
    } finally { await page.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
