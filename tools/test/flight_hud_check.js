// フライトの2本のゲージと右側4枠を、実際の消費・装填処理および画面配置と照合する。
// python3 tools/test/make_dbg.py dbg/flight-hud
// node tools/test/flight_hud_check.js dbg/flight-hud [結果JSON]
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/flight-hud');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await p.goto('file://' + path.join(dir, 'dbg.html'));
    const result = await p.evaluate(() => {
      const g = __g, $ = id => document.getElementById(id), checks = [];
      const yes = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      const hud = () => g.hud(240, .016), shown = id => getComputedStyle($(id)).display !== 'none';
      g.renderer.render = () => {}; g.selectMap('city'); $('start').click(); g.running = false;
      for (const u of g.units) u.frozen = true;
      const u = g.player, aim = new g.T.Vector3(0, 252, -80), zero = new g.T.Vector3();
      const reset = cls => {
        g.equip(u, cls); Object.assign(u, { alive: true, invulT: 0, repairing: false, stun: '', electricT: 0, transfer: null, switchT: 0, ctrlLockT: 0, recoverT: 0, dashT: 0, overheat: false });
        u.pos.set(0, 250, 0); u.group.position.copy(u.pos); u.vel.set(0, 0, 0);
      };
      reset('assault'); document.querySelector('[data-console-choice="flight"]').click(); hud();
      yes(!shown('aimSp') && shown('sp') && shown('boost'), 'フライトはSPとブーストを下中央に表示');
      u.maxBoost = 160; u.boost = u.maxBoost * .6;
      yes(g.shortDash(u, new g.T.Vector3(0, 0, -1)), '実際にショートダッシュする'); hud();
      yes(Math.abs(parseFloat($('boost').firstChild.style.width) - u.boost / u.maxBoost * 100) < .01 && $('boostT').textContent === Math.round(u.boost / u.maxBoost * 100) + '%', '最大量が異なる機体でも実際の消費割合を表示');
      u.boost = 1; u.dashT = 0; g.shortDash(u, new g.T.Vector3(0, 0, -1)); hud();
      yes(u.overheat && $('boost').classList.contains('oh') && parseFloat($('boost').firstChild.style.width) === 0, '使い切ったブーストの過熱を表示');
      for (let i = 0; i < 140; i++) g.physics(u, zero, false, false, .05);
      hud(); yes(!u.overheat && !$('boost').classList.contains('oh') && parseFloat($('boost').firstChild.style.width) === 100, '実際の回復で満タンに戻る');
      reset('assault'); const ammo = u.slots.main.ammo; g.weaponsTick(u, .01, true, aim, 0); hud();
      yes(u.slots.main.ammo < ammo && $('w-main').querySelector('.flightCount').textContent === String(u.slots.main.ammo), '実射で主武器の数字が減る');
      yes(Math.abs(parseFloat($('w-main').style.getPropertyValue('--fill')) - u.slots.main.ammo / u.slots.main.w.mag * 100) < .11, '実射で主武器の棒も減る');
      u.slots.main.ammo = 0; u.reloadMul = 1.5; g.weaponsTick(u, .01, false, aim, 0);
      const reload = u.slots.main.reloadT; g.weaponsTick(u, reload / 2, false, aim, 0); hud();
      yes(/再装填/.test($('w-main').textContent) && Math.abs(parseFloat($('w-main').style.getPropertyValue('--fill')) - 50) < .2, '腕の倍率を含む再装填の進み具合');
      g.weaponsTick(u, reload, false, aim, 0); hud();
      yes(u.slots.main.ammo > 0 && !/再装填/.test($('w-main').textContent), '再装填後は予備弾表示に戻る');
      g.loadout.assault.aux = 'waveSword'; reset('assault'); u.weapon = 'aux';
      g.weaponsTick(u, u.slots.aux.w.chargeTime * .65, true, aim, 0); hud();
      yes(/充填 65%/.test($('w-aux').textContent) && $('w-aux').querySelector('.flightCount').textContent === '∞', '光波剣の実際の充填と弾数制限なしを表示');
      reset('heavy'); u.slots.aux = g.slotOf('pike'); u.weapon = 'aux';
      g.weaponsTick(u, u.slots.aux.w.chargeTime, true, aim, 0); g.weaponsTick(u, u.slots.aux.w.chargeHold + .1, true, aim, 0); hud();
      yes(u.slots.aux.overheat && /冷却/.test($('w-aux').textContent) && $('w-aux').classList.contains('warn'), '杭の保持超過で冷却状態を表示');
      reset('raid'); g.toggleSp(u); g.weaponsTick(u, 1, false, aim, 0); hud();
      yes(u.cloak && $('sp').classList.contains('act') && /作動中/.test($('w-sp').textContent) && $('w-sp').querySelector('.flightCount').textContent === Math.round(u.slots.sp.heat) + '%', '迷彩の実消費を下のSPと特別装備に表示');
      yes(Math.abs(parseFloat($('sp').firstChild.style.width) - parseFloat($('w-sp').style.getPropertyValue('--fill'))) < .11, '下のSPと特別装備の残量が一致');
      g.weaponsTick(u, u.slots.sp.w.use * 2, false, aim, 0); hud();
      yes(u.slots.sp.overheat && /SP回復中/.test($('w-sp').textContent) && $('sp').classList.contains('oh'), 'SP枯渇の回復待ちを両方に表示');
      g.weaponsTick(u, u.slots.sp.w.charge / u.slots.sp.supply, false, aim, 0); hud();
      yes(!u.slots.sp.overheat && $('w-sp').querySelector('.flightCount').textContent === '100%', '実際のSP回復で満タンに戻る');
      u.weapon = 'sub'; u.scoped = true; hud();
      yes(!$('scope').hidden && shown('boost') && shown('sp') && $('consoleTelemetry').hidden, 'スコープ中も2本のゲージを表示');
      u.alive = false; hud(); g.spawn(u); hud();
      yes(document.querySelectorAll('#wpn .flightCount').length === 4 && shown('boost') && shown('sp'), '再出撃後も4枠と2本のゲージを表示');
      for (const mode of ['standard', 'arcade', 'mechanical']) {
        document.querySelector(`[data-console-choice="${mode}"]`).click(); hud();
        yes(shown('aimSp') && !$('w-main').querySelector('.flightCount') && $('boostT').textContent === String(Math.round(u.boost)), mode + 'に戻すと元のSP・装備・ブースト表示');
      }
      return { passed: checks.length, checks };
    });
    const layouts = [];
    for (const map of ['city', 'dock']) {
      for (const [width, height] of [[640, 480], [800, 600], [1000, 600], [1280, 720], [1440, 900], [1920, 1080]]) {
        await p.setViewportSize({ width, height });
        await p.evaluate(map => {
          const g = __g, $ = id => document.getElementById(id);
          g.selectMap(map); $('start').click(); g.running = false;
          for (const u of g.units) u.frozen = true;
          document.querySelector('[data-console-choice="flight"]').click();
          const u = g.player, e = g.units.find(q => q.team !== u.team);
          g.equip(u, 'heavy'); u.slots.aux = g.slotOf('pike'); u.weapon = 'aux'; u.slots.aux.chargeT = 1.4; u.switchT = 0;
          e.target = u; e.weapon = 'main'; e.locked = true; const radar = g.radars.find(r => r.team === u.team); if (radar) radar.intruders = [e];
          g.running = true; g.hud(240, .016); g.running = false;
          $('spotAlert').hidden = false; $('spotAlertInfo').textContent = '索敵センサー・偵察機 残り15秒';
        }, map);
        await p.waitForTimeout(60);
        const boxes = await p.evaluate(() => Object.fromEntries(['boostRow', 'spRow', 'boost', 'sp', 'status', 'ammoBox', 'mapHud', 'w-main', 'w-sub', 'w-aux', 'w-sp', 'consoleSpeed', 'consoleAltitude', 'lockRing'].map(id => {
          const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height }];
        })));
        const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
        const label = `${map}/${width}x${height}`;
        for (const [id, r] of Object.entries(boxes)) if (r.x < 0 || r.y < 0 || r.x + r.w > width + .5 || r.y + r.h > height + .5) throw Error(label + '/' + id + 'が画面外');
        if (boxes.boost.w < width * .3 || boxes.boost.h < 12 || Math.abs(boxes.boost.w - boxes.sp.w) > 1 || boxes.boost.y >= boxes.sp.y) throw Error(label + '/大きな同幅の2本になっていない');
        for (const a of ['boostRow', 'spRow']) for (const z of ['status', 'ammoBox', 'mapHud', 'lockRing']) if (overlap(boxes[a], boxes[z])) throw Error(label + '/' + a + 'と' + z + 'が重なる');
        for (const z of ['mapHud', 'consoleSpeed', 'consoleAltitude', 'lockRing']) if (overlap(boxes.ammoBox, boxes[z])) throw Error(label + '/装備欄と' + z + 'が重なる');
        const rows = ['main', 'sub', 'aux', 'sp'].map(k => boxes['w-' + k]);
        if (rows.some((r, i) => Math.abs(r.x - rows[0].x) > 1 || i && r.y < rows[i - 1].y + rows[i - 1].h)) throw Error(label + '/4枠が縦に並ばない');
        layouts.push({ map, width, height, boxes });
      }
    }
    if (errors.length) throw Error(errors.join('\n'));
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify({ ...result, layouts, errors }, null, 2) + '\n');
    console.log(`フライトHUD：${result.passed}項目・${layouts.length}通りの配置、成功。ブラウザのエラーなし`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
