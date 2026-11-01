// 照準を合わせて指を置き直し、止めて狙う場合の自動射撃を実タッチ入力で確認。
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const page = await context.newPage(), errors = [], checks = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
    await page.route('https://**/*', r => r.fulfill({ body: '' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = undefined; });
    await page.goto(pathToFileURL(path.resolve(process.argv[2] || 'dbg/mobile', 'dbg.html')).href);
    await page.evaluate(() => {
      const g = __g;
      g.selectMap('dock'); document.getElementById('start').click(); g.touchTick();
      const u = g.player, e = g.units.find(v => v.team !== u.team);
      for (const unit of g.units) unit.frozen = true;
      g.selectWeapon(u, 'main'); u.slots.main = g.slotOf('ar');
      Object.assign(u, { switchT: 0, yaw: 0, pitch: 0, recoil: 0, recoilYaw: 0, stun: '', electricT: 0, repairing: false, transfer: null });
      u.pos.set(0, 200, 0); u.group.position.copy(u.pos); u.group.rotation.set(0, 0, 0);
      Object.assign(e, { alive: true, downT: 0, cloak: false });
      e.pos.set(0, 200, -20); e.group.position.copy(e.pos);
      g.weaponLook(u, 0); g.weaponLook(e, 0); g.scene.updateMatrixWorld(true);
      const aim = g.targetPoint(e), from = aim.clone().setZ(5);
      g.camera.position.copy(from); g.camera.lookAt(aim); g.camera.updateMatrixWorld(true);
      window.fireFixture = { e, aim, from, dir: aim.clone().sub(from).normalize() };
    });
    const cdp = await context.newCDPSession(page), contacts = new Map();
    const down = async (id, x = 510, y = 170) => {
      contacts.set(id, { id, x, y });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...contacts.values()] });
    };
    const move = async (id, x, y = 170) => {
      contacts.set(id, { id, x, y });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...contacts.values()] });
    };
    const up = async id => {
      const point = contacts.get(id); contacts.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
    };
    const check = (value, label) => { assert.ok(value, label); checks.push(label); };
    const auto = () => page.evaluate(() => {
      const g = __g, f = fireFixture;
      return g.touchAutoTrigger(g.player, g.castFrom(f.from, f.dir, g.player), f.aim);
    });
    const shoot = () => page.evaluate(() => {
      const g = __g, f = fireFixture, u = g.player, before = u.slots.main.ammo;
      u.slots.main.cd = 0;
      g.weaponsTick(u, 1 / 60, g.touchAutoTrigger(u, g.castFrom(f.from, f.dir, u), f.aim), f.aim, 0);
      return u.slots.main.ammo < before;
    });

    await down(1); await page.waitForTimeout(260);
    check(!await auto(), '初回は長押しだけで自動射撃を開始しない');
    await move(1, 540);
    check(await auto() && await shoot(), '照準ドラッグで実際に発射する');
    await up(1);
    check(await auto(), '照準指を離しても有効な敵への射撃を続ける');

    await down(2);
    check(!await auto(), '置き直し直後はダブルタップ判定のため射撃を待つ');
    await page.waitForTimeout(260);
    check(await auto() && await shoot(), '指を止めた長押しでも判定後に実際に発射する');
    await move(2, 512);
    check(await auto(), '小さな指の揺れでも射撃を続ける');
    await up(2);
    check(await auto(), '長押しを離しても単タップ待ちに戻らない');

    await down(3, 130, 270); await move(3, 130, 220);
    await down(4); await page.waitForTimeout(260);
    check(await auto() && await page.evaluate(() => __g.touch.fwd > 0) && await shoot(), '移動指と止めた照準指の同時操作で発射する');
    await up(4); await up(3);
    await down(5); await down(6, 550); await page.waitForTimeout(260);
    check(!await auto(), '複数の照準指は長押しでも射撃しない');
    await up(5); await up(6);

    await down(7); await up(7);
    check(!await auto(), '単タップ後は2回目のタップを待つ');
    await down(8); check(!await auto(), '2回目のタップ中も射撃しない'); await up(8);
    check(await page.evaluate(() => __g.touch.menu) && !await auto(), 'ダブルタップで武器メニューを開き射撃を止める');
    await page.evaluate(() => __g.touchMenuClose());
    await down(9); await page.waitForTimeout(260);
    check(!await auto(), 'メニュー終了後は長押しだけで自動射撃を再開しない');
    await move(9, 540);
    check(await auto(), 'メニュー終了後は新しい照準ドラッグで再開する');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); contacts.clear();
    check(!await auto() && await page.evaluate(() => !__g.touch.armed && !__g.touch.ptr.size), '接触取消で射撃と保持入力を解除する');
    assert.deepEqual(errors, []);
    console.log(checks.join('\n')); console.log('PASS ' + checks.length + ' / ブラウザエラーなし');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
