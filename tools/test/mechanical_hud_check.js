// メカニカルの4枠の弧・武器状態・ブースト・対象情報を実際の装備処理と照合する。
// node tools/test/mechanical_hud_check.js dbg/ac6-hud [結果JSON]
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = path.resolve(process.argv[2] || 'dbg/ac6-hud');
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
      const yes = (ok, text) => { if (!ok) throw Error(text); checks.push(text); };
      const fill = id => parseFloat($(id).getAttribute('stroke-dasharray'));
      const hud = () => g.hud(240, .016);
      g.renderer.render = () => {}; g.selectMap('city'); $('start').click(); g.running = false;
      const u = g.player, e = g.units.find(q => q.team !== u.team), aim = new g.T.Vector3(0, 252, -80);
      for (const q of g.units) q.frozen = true;
      const reset = cls => {
        g.equip(u, cls); Object.assign(u, { alive: true, invulT: 0, repairing: false, stun: '', electricT: 0, transfer: null, switchT: 0 });
        u.pos.set(0, 250, 0); u.group.position.copy(u.pos); u.vel.set(0, 0, 0); u.yaw = 0; g.weaponLook(u, 0); u.group.updateMatrixWorld(true);
      };
      reset('assault'); document.querySelector('[data-console-choice="mechanical"]').click(); hud();
      yes(!$('mechanicalHud').hidden && getComputedStyle($('aimGauge')).display === 'none', 'メカニカルだけ専用の武器メーターを使う');
      for (const k of g.SLOTS) yes(Number.isFinite(fill('mech-' + k)), k + 'の弧が有限');
      const ammo = u.slots.main.ammo; g.weaponsTick(u, .01, true, aim, 0); hud();
      yes(u.slots.main.ammo < ammo && $('w-main').querySelector('.mechCount').textContent.startsWith(u.slots.main.ammo + ' / '), '実射で主武器の残弾が減る');
      yes(Math.abs(fill('mech-main') - u.slots.main.ammo / u.slots.main.w.mag * 100) < .11, '実射後の弧が残弾に一致');
      u.slots.main.ammo = 0; u.reloadMul = 1.5; g.weaponsTick(u, .01, false, aim, 0); const reload = u.slots.main.reloadT;
      g.weaponsTick(u, reload / 2, false, aim, 0); hud();
      yes(/再装填/.test($('w-main').textContent) && Math.abs(fill('mech-main') - 50) < .2, '腕の倍率を含めた再装填の中間点');
      g.weaponsTick(u, reload, false, aim, 0); hud();
      yes(u.slots.main.ammo > 0 && !/再装填/.test($('w-main').textContent), '再装填が完了すると残弾表示に戻る');
      g.loadout.assault.aux = 'waveSword'; reset('assault'); u.weapon = 'aux';
      g.weaponsTick(u, u.slots.aux.w.chargeTime * .65, true, aim, 0); hud();
      yes(/充填 65%/.test($('w-aux').textContent) && Math.abs(fill('mechHeat') - 65) < .2, '実際の溜めで光波剣の充填を表示');
      reset('heavy'); u.slots.aux = g.slotOf('pike'); u.weapon = 'aux';
      g.weaponsTick(u, u.slots.aux.w.chargeTime, true, aim, 0);
      g.weaponsTick(u, u.slots.aux.w.chargeHold + .1, true, aim, 0); hud();
      yes(u.slots.aux.overheat && /冷却/.test($('w-aux').textContent) && $('mech-aux').classList.contains('warn'), '保持しすぎた杭の冷却を表示');
      reset('raid'); g.toggleSp(u); g.weaponsTick(u, 1, false, aim, 0); hud();
      yes(u.cloak && /作動中/.test($('w-sp').textContent) && Math.abs(fill('mech-sp') - u.slots.sp.heat) < .11, '迷彩の実消費をSPの弧に反映');
      g.weaponsTick(u, u.slots.sp.w.use * 2, false, aim, 0); g.weaponsTick(u, .01, false, aim, 0); hud();
      yes(u.slots.sp.overheat && /再充填中/.test($('w-sp').textContent), '使い切ったSPの再充填を表示');
      g.weaponsTick(u, u.slots.sp.w.charge / u.slots.sp.supply, false, aim, 0); hud();
      yes(!u.slots.sp.overheat && Math.abs(fill('mech-sp') - 100) < .1, '満充填でSPの弧が戻る');
      u.boost = u.maxBoost * .37; u.overheat = true; u.yaw = -Math.PI / 2; u.vel.set(3, 4, 12); hud();
      yes($('mechBoostBar').getAttribute('aria-valuenow') === '37' && $('mechBoost').classList.contains('oh'), 'ブーストの割合と回復待ちを下中央に表示');
      yes($('consoleSpeedT').textContent === '13.0' && $('consoleHeadingT').textContent === '090°', '速度と方位は機体の実際の状態');
      yes($('mechCompass').querySelector('[data-bearing="90"]').style.left === '50%', '東を向くと方位目盛りのEが中央');
      e.pos.set(0, 250, -40); e.hp = 6200; e.maxHp = 10000; e.alive = true; e.name = '確認用の敵';
      Object.assign(g.lock, { target: e, visible: true }); hud();
      yes(fill('mechTargetHp') === 62 && $('mechRange').textContent === '40m' && $('mechTargetName').textContent === e.name, '見えているロック対象の耐久・距離・名前');
      g.lock.visible = false; hud(); yes($('mechTarget').style.display === 'none', '見失った相手の対象情報は隠す');
      u.weapon = 'sub'; u.scoped = true; hud();
      yes($('mechAim').style.visibility === 'hidden' && !$('mechanicalHud').hidden && !$('aimSp').hidden, 'スコープ中は弧を隠し、SPとブーストを残す');
      u.alive = false; hud(); yes($('mechanicalHud').hidden, '撃破・行動不能中は専用計器を隠す');
      g.spawn(u); hud(); yes(!$('mechanicalHud').hidden, '実際の再出撃で専用計器が戻る');
      for (const mode of ['standard', 'arcade', 'flight']) {
        document.querySelector(`[data-console-choice="${mode}"]`).click(); hud();
        yes($('mechanicalHud').hidden && !$('w-main').querySelector('.mechCount') && getComputedStyle($('aimGauge')).display !== 'none', mode + 'に戻すと専用の表示を片づける');
      }
      return { passed: checks.length, checks };
    });
    const layouts = [];
    for (const [width, height] of [[640, 480], [800, 600], [1280, 720], [1920, 1080]]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(() => {
        const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team);
        document.querySelector('[data-console-choice="mechanical"]').click();
        g.equip(u, 'heavy'); u.slots.aux = g.slotOf('pike'); u.weapon = 'aux'; u.switchT = 0; u.slots.aux.chargeT = 1.4;
        e.target = u; e.weapon = 'main'; e.locked = true; e.alive = true; Object.assign(g.lock, { target: e, visible: true });
        g.radars.find(r => r.team === u.team).intruders = [e]; g.running = true; g.hud(240, .016); g.running = false;
      });
      await p.waitForTimeout(50);
      const boxes = await p.evaluate(() => Object.fromEntries(['mechBoost', 'consoleHeading', 'status', 'ammoBox', 'aimSp', 'baseAlert', 'mechTargetName', 'mechTargetBg', 'mech-main-bg', 'mech-sub-bg', 'mech-aux-bg', 'mech-sp-bg'].map(id => {
        const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height }];
      })));
      const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
      for (const [a, b] of [['mechBoost', 'status'], ['mechBoost', 'ammoBox'], ['consoleHeading', 'status'], ['consoleHeading', 'ammoBox'], ['aimSp', 'mechBoost'], ['baseAlert', 'mechTargetName'], ['baseAlert', 'mechTargetBg']]) {
        if (overlap(boxes[a], boxes[b])) throw Error(`${width}x${height}：${a}と${b}が重なる`);
      }
      for (const k of ['main', 'sub', 'aux', 'sp']) if (boxes['mech-' + k + '-bg'].y + boxes['mech-' + k + '-bg'].h >= boxes.aimSp.y - 2) throw Error('武器の弧がSPに重なる');
      layouts.push({ width, height, boxes });
    }
    if (errors.length) throw Error(errors.join('\n'));
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify({ ...result, layouts, errors }, null, 2) + '\n');
    console.log(`メカニカルHUD：${result.passed}項目・${layouts.length}解像度の配置、成功。ブラウザのエラーなし`);
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
