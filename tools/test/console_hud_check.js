// コンソールの選択・保存・戦闘中の切り替えと、情報を失わない配置を実ブラウザで確かめる。
// python3 tools/test/make_dbg.py dbg/hud-consoles
// node tools/test/console_hud_check.js dbg/hud-consoles [結果JSON]
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/hud-consoles');
const modes = ['standard', 'arcade', 'flight', 'mechanical', 'retro'];
const checks = [], errors = [], layouts = [];
const yes = (v, label) => { if (!v) throw Error(label); checks.push(label); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    yes(await p.evaluate(() => document.body.dataset.console === 'standard'), '未設定時は標準');
    await p.locator('[data-page="pgOptions"]').click();
    yes(await p.locator('#consoleList button').count() === 5, 'オプションに5種類');
    await p.locator('[data-console-choice="flight"]').focus();
    await p.keyboard.press('Enter');
    yes(await p.evaluate(() => document.body.dataset.console === 'flight' && document.querySelectorAll('#consoleList [aria-pressed="true"]').length === 1), 'キーボードで選択し、選択状態は1つ');
    await p.reload();
    yes(await p.evaluate(() => document.body.dataset.console === 'flight'), '選択を再読み込み後も復元');
    await p.evaluate(() => localStorage.setItem('coreBreakerConsole', 'unknown'));
    await p.reload();
    yes(await p.evaluate(() => document.body.dataset.console === 'standard'), '不正な保存値は標準へ');
    await p.evaluate(() => {
      const g = __g; g.renderer.render = () => {}; g.selectMap('city'); document.getElementById('start').click(); g.running = false;
      for (const u of g.units) u.frozen = true;
      g.player.invulT = 0;
      window.consoleSnapshot = () => JSON.stringify({ hp: g.player.hp, boost: g.player.boost, sp: g.player.slots.sp.heat, weapon: g.player.weapon, units: g.units.length, time: g.timeLeft, loadout: g.loadout, mech: g.mechCfg, cores: Object.values(g.cores).map(c => c.hp) });
      window.consoleBefore = consoleSnapshot();
      window.consoleSaved = Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== 'coreBreakerConsole'));
      g.running = true;
    });
    for (const mode of [...modes.slice(1), 'standard']) {
      await p.keyboard.press('F2');
      yes(await p.evaluate(mode => document.body.dataset.console === mode, mode), 'F2で巡回：' + mode);
    }
    yes(await p.evaluate(() => consoleSnapshot() === consoleBefore && Object.entries(consoleSaved).every(([k, v]) => localStorage.getItem(k) === v)), '切り替えても試合・機体・装備と既存の保存値は変わらない');
    await p.keyboard.press('Control+F2');
    yes(await p.evaluate(() => document.body.dataset.console === 'standard'), '修飾キー付きF2では切り替えない');
    await p.evaluate(() => { __g.running = false; });
    for (const mode of modes) {
      const result = await p.evaluate(mode => {
        const g = __g, u = g.player, $ = id => document.getElementById(id);
        document.querySelector(`[data-console-choice="${mode}"]`).click();
        g.equip(u, 'raid'); u.alive = true; u.invulT = 0; u.hp = 2100; u.boost = u.maxBoost * .4; u.slots.sp.heat = 37; u.slots.sp.overheat = true;
        g.hud(240, .016);
        const values = $('aimSpBar').getAttribute('aria-valuenow') === '37' && $('aimSpBar').firstChild.style.width === '37%' && !$('aimSp').textContent.trim() && $('spT').textContent === (mode === 'flight' ? '37%' : '37') && $('hpT').textContent === '2100' && $('status').classList.contains('low') && $('aimSp').classList.contains('oh')
          && (mode !== 'arcade' || $('timer').textContent === '240' && $('hp').style.getPropertyValue('--fill') === '21%' && $('pilotCls').textContent === '遊撃' && $('w-sp').style.getPropertyValue('--fill') === '37%' && $('w-' + u.weapon).dataset.n === $('ammo').textContent && $('w-sub').dataset.n === String(u.slots.sub.ammo) && $('w-sp').dataset.n === '37%');
        u.slots.sp.overheat = false; g.toggleSp(u); const before = u.slots.sp.heat;
        g.weaponsTick(u, .5, false, u.pos.clone(), 0); g.hud(240, .016);
        const active = u.slots.sp.heat < before && $('aimSp').classList.contains('act') && !$('aimSp').classList.contains('oh');
        u.slots.sp.cd = 0; g.toggleSp(u); const used = u.slots.sp.heat;
        g.weaponsTick(u, .5, false, u.pos.clone(), 0); g.hud(240, .016);
        const recovery = u.slots.sp.heat > used && $('aimSpBar').firstChild.style.width === $('sp').firstChild.style.width;
        u.weapon = 'sub'; u.scoped = true; g.hud(240, .016);
        const scope = !$('aimSp').hidden && $('consoleTelemetry').hidden && !$('scope').hidden;
        u.scoped = false; u.alive = false; u.downT = 3; g.hud(240, .016);
        const down = $('aimSp').hidden && $('consoleTelemetry').hidden;
        g.spawn(u); g.hud(240, .016);
        return { values, active, recovery, scope, down, respawn: !$('aimSp').hidden };
      }, mode);
      for (const [name, ok] of Object.entries(result)) yes(ok, mode + '：' + name);
    }
    const telemetry = await p.evaluate(() => {
      const g = __g, u = g.player;
      document.querySelector('[data-console-choice="flight"]').click();
      u.pos.set(0, 250, 0); u.vel.set(3, 4, 12); u.yaw = -Math.PI / 2; g.hud(240, .016);
      const $ = id => document.getElementById(id);
      return !$('consoleTelemetry').hidden && $('consoleSpeedT').textContent === '13.0' && +$('consoleAltitudeT').textContent > 0 && $('consoleHeadingT').textContent === '090°';
    });
    yes(telemetry, 'フライトの速度・高度・方位は実際の状態を表示');
    for (const map of ['city', 'dock']) {
      await p.evaluate(map => { __g.selectMap(map); document.getElementById('start').click(); __g.running = false; for (const u of __g.units) u.frozen = true; }, map);
      for (const [width, height] of [[640, 480], [800, 600], [1280, 720], [1920, 1080]]) {
        await p.setViewportSize({ width, height });
        for (const mode of modes) {
          await p.evaluate(mode => {
            const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team);
            document.querySelector(`[data-console-choice="${mode}"]`).click();
            g.equip(u, 'heavy'); u.slots.aux = g.slotOf('pike'); u.weapon = 'aux'; u.slots.aux.chargeT = 1.4; u.switchT = 0;
            e.slots.main = g.slotOf('ar'); e.target = u; e.weapon = 'main'; e.locked = true; g.running = true;
            const radar = g.radars.find(r => r.team === u.team); if (radar) radar.intruders = [e];
            g.hud(240, .016); g.running = false;
            // 被索敵の長い警告を配置検査の条件に加える。
            document.getElementById('spotAlert').hidden = false; document.getElementById('spotAlertInfo').textContent = '索敵センサー・偵察機 残り15秒';
          }, mode);
          await p.waitForTimeout(50); // ResizeObserver の武器情報の高さを反映
          const box = await p.evaluate(mode => { const boxes = Object.fromEntries(['mini', 'spotAlert', 'status', 'ammoBox', 'aimSp', 'top', 'wpn', 'consoleHeading', 'plantBar', 'baseAlert'].map(id => {
            const r = document.getElementById(id === 'aimSp' && mode === 'flight' ? 'sp' : id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height }];
          })); boxes.lockMarkers = [...document.querySelectorAll('#lockDirections:not([hidden]) .lockSector:not([hidden]) i')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); return boxes; }, mode);
          const inside = r => r.x >= -.5 && r.y >= -.5 && r.x + r.w <= width + .5 && r.y + r.h <= height + .5;
          const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
          const label = `${map}/${width}x${height}/${mode}`;
          // 標準は元の配置。追加3種類でSPと周辺パネルを重ねない（フライトは下中央）。
          if (mode !== 'standard') {
            for (const id of ['mini', 'spotAlert', 'status', 'ammoBox', 'aimSp', 'top', 'wpn']) yes(inside(box[id]), label + '/' + id + 'が画面内');
            for (const id of ['mini', 'status', 'ammoBox', 'wpn']) yes(!overlap(box.aimSp, box[id]), label + '/SPと' + id + 'が重ならない');
            yes(!overlap(box.spotAlert, box.ammoBox), label + '/被索敵と武器情報が重ならない');
            yes(box.lockMarkers.every(r => !overlap(r, box.plantBar) && !overlap(r, box.baseAlert)), label + '/方向の三角とプラント・基地警告が重ならない');
            if (mode === 'mechanical') yes(!overlap(box.consoleHeading, box.aimSp) && !overlap(box.consoleHeading, box.status) && !overlap(box.consoleHeading, box.ammoBox), label + '/方位計が重ならない');
          }
          layouts.push({ map, width, height, mode, box });
        }
      }
    }
    // 保存APIが使えなくても、初期表示と選択操作は使える。
    await p.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('storage denied'); }; });
    await p.reload();
    yes(await p.evaluate(() => document.body.dataset.console === 'standard'), '保存不可の環境でも起動');
    await p.locator('[data-page="pgOptions"]').click();
    await p.locator('[data-console-choice="mechanical"]').click();
    yes(await p.evaluate(() => document.body.dataset.console === 'mechanical'), '保存不可でもコンソールは選べる');
    yes(!errors.length, 'ブラウザのエラーなし：' + errors.join('\n'));
    const result = { passed: checks.length, checks, layouts, errors };
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n');
    console.log(`コンソール：${checks.length}項目・${layouts.length}通りの配置、成功。ブラウザのエラーなし`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
