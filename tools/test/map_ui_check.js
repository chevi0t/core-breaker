// 全GUIの実寸、Mの3段階、地点指示の置換と砲撃モードを実入力で確認する。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const out = path.resolve(process.argv[3] || 'dbg/map-ui-results'); fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [];
  const yes = (v, s) => { assert(v, s); checks.push(s); };
  try {
    for (const touch of [false, true]) {
      const context = await browser.newContext({ viewport: touch ? { width: 844, height: 390 } : { width: 1600, height: 900 }, hasTouch: touch, isMobile: touch });
      const p = await context.newPage();
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      await p.addInitScript(() => { requestAnimationFrame = () => 0; AudioContext = undefined; localStorage.setItem('coreBreakerOptions', JSON.stringify({ uiFit: 1 })); });
      await p.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg/map-ui', 'dbg.html')).href);
      await p.evaluate(touch => {
        const g = __g; g.selectMap('city'); g.setup(); g.running = true;
        document.getElementById('overlay').hidden = true;
        document.body.classList.toggle('touchPlay', touch);
        for (const u of g.units) { u.frozen = true; u.alive = true; }
        g.hud(); g.drawBigMap();
      }, touch);
      let baseline;
      for (let i = 0; i < (touch ? 1 : 5); i++) {
        await p.evaluate(() => __g.loop(performance.now()));
        const state = await p.evaluate(() => {
          const r = document.getElementById('mini').getBoundingClientRect();
          return { mode: __g.consoleMode, x: r.x, y: r.y, w: r.width, h: r.height, right: innerWidth - r.right };
        });
        yes(state.right >= 15 && state.right <= 17 && state.y >= 15 && state.y <= 17, `${touch ? 'タッチ' : 'PC'} ${state.mode}：右上`);
        if (!baseline) baseline = state;
        yes(Math.abs(state.w - baseline.w) < .1 && Math.abs(state.h - baseline.h) < .1, `${state.mode}：マップの実寸共通`);
        await p.screenshot({ path: path.join(out, `${touch ? 'touch' : 'pc'}-${state.mode}.png`) });
        await p.keyboard.press('F2');
      }
      if (touch) yes(await p.evaluate(() => document.getElementById('ammoBox').getBoundingClientRect().top >= document.getElementById('mini').getBoundingClientRect().bottom + 7), 'スマホの残弾表示がマップに重ならない');
      const cycle = async () => {
        if (touch) await p.locator('[data-tc="map"]').tap();
        else await p.keyboard.press('KeyM');
        await p.evaluate(() => __g.loop(performance.now()));
      };
      const size = async () => p.locator('#bigMapC').boundingBox();
      await cycle(); const maximum = await size();
      yes(await p.evaluate(() => __g.mapOpen && __g.bigMapSize === 'maximum'), '小からMで最大');
      await p.evaluate(() => { __g.mapCur.x = 50; __g.mapCur.z = -50; });
      await cycle(); const large = await size();
      yes(large.width < maximum.width && large.height < maximum.height, '2回目のMで大へ縮小');
      yes(await p.evaluate(() => __g.mapCur.x === 50 && __g.mapCur.z === -50), 'サイズ変更で地点を維持');
      await cycle(); yes(await p.locator('#bigMap').isHidden(), '3回目で小へ戻る');
      await cycle();
      for (let i = 0; i < 3; i++) {
        const position = { x: maximum.width * (.2 + i * .25), y: maximum.height * (.3 + i * .15) };
        if (touch && i !== 1) await p.locator('#bigMapC').tap({ position });
        else await p.locator('#bigMapC').click({ button: i === 1 ? 'right' : 'left', position });
        yes(await p.evaluate(() => __g.pings.filter(q => q.by === __g.player).length === 1), '連続クリックでも地点指示は1件');
        if (i === 0) await p.evaluate(() => { window.oldOrderBots = __g.units.filter(b => b.order?.by === __g.player); window.oldPing = __g.pings.find(q => q.by === __g.player); });
        if (i === 1) {
          yes(await p.evaluate(() => {
            const g = __g, orders = g.units.filter(b => b.order?.by === g.player), at = g.mapCur;
            return orders.length === 2 && orders.every(b => b.order.kind === 'hold' && Math.abs(b.order.pos.x - at.x) < .01 && Math.abs(b.order.pos.z - at.z) < .01)
              && oldOrderBots.every(b => !b.order || b.order.kind === 'hold') && !oldPing.mesh.parent && !oldPing.el.isConnected;
          }), '防衛指示へ置換し、旧Bot指示・光柱・画面マーカーを除去');
        }
      }
      yes(await p.evaluate(() => {
        const g = __g, u = g.player, ally = g.units.find(b => !b.isPlayer && b.team === u.team), at = new g.T.Vector3(0, 0, 0);
        g.qchatSend(ally, 0, at); g.addPing(u.team, at, '行動不能');
        g.qchatSend(u, 6, at); const command = g.pings.find(q => q.by === u);
        g.qchatSend(u, 3);
        return g.pings.includes(command) && g.pings.some(q => q.by === ally) && g.pings.some(q => q.by === null);
      }), '他の発信者・行動不能の印を保持、礼では指示を解除しない');
      await p.locator('[data-map-size="large"]').click();
      await p.evaluate(() => {
        const g = __g, u = g.player; window.beforeArtilleryPings = g.pings.slice();
        u.slots.sp = g.slotOf('artillery'); g.selectWeapon(u, 'sp'); u.switchT = 0; g.drawBigMap();
      });
      const art = await size(); yes(Math.abs(art.width - maximum.width) <= 1, '砲撃マップは直前の大指定によらず最大');
      await p.keyboard.press('KeyM'); yes(await p.evaluate(() => __g.isArtilleryMode(__g.player)), '砲撃中のMで射撃モードを変えない');
      await p.evaluate(() => {
        const g = __g, r = document.getElementById('bigMapC').getBoundingClientRect(), [x, z] = g.curMap.size, u = g.player;
        document.getElementById('bigMapC').dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: r.left + (u.pos.x / x + 1) * r.width / 2, clientY: r.top + (u.pos.z / z + 1) * r.height / 2, bubbles: true }));
      });
      const artillery = await p.evaluate(() => ({ bombard: !!__g.player.bombard, pings: __g.pings.length, before: beforeArtilleryPings.length, repairing: __g.player.repairing, transfer: __g.player.transfer, stun: __g.player.stun, switchT: __g.player.switchT, overheat: __g.player.slots.sp.overheat }));
      yes(artillery.bombard && artillery.pings === artillery.before, '砲撃指定は味方への地点指示を追加しない ' + JSON.stringify({ touch, ...artillery }));
      await p.evaluate(() => __g.stopArtillery(__g.player));
      await p.keyboard.press('KeyM'); await p.locator('[data-map-size="small"]').click();
      yes(await p.locator('#bigMap').isHidden(), '小ボタンでも通常の小マップへ戻る');
      if (!touch) {
        await p.locator('#view').click(); await p.waitForFunction(() => document.pointerLockElement?.id === 'view');
        await cycle(); await p.waitForFunction(() => !document.pointerLockElement);
        await cycle(); yes(await p.evaluate(() => !document.pointerLockElement), '最大から大ではマウスを解放したまま');
        await cycle(); await p.waitForFunction(() => document.pointerLockElement?.id === 'view');
        yes(await p.locator('#bigMap').isHidden(), '小へ戻る時だけ元の視点操作へ復帰');
        await p.evaluate(() => document.exitPointerLock());
        for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }]) {
          await p.setViewportSize(viewport); await cycle();
          const r = await p.locator('#bigMap').boundingBox();
          yes(r.x >= -1 && r.y >= -1 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1, `${viewport.width}×${viewport.height}で最大マップが画面内`);
          await cycle(); await cycle();
        }
      }
      await context.close();
    }
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks: checks.length, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
