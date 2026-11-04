// 出撃し直すときに前の命の一時的な状態が残らないこと（resetLifeState、2026-11-04 リファクタ）を確かめる。node tools/test/life_reset_check.js dbg
// プレイヤーと Bot に、行動不能・感電・よろけ・格闘の途中・特別装備の作動・カタパルト飛行などを入れたまま spawn し、全部消えていること。
// 行動不能の呼びかけの印（ping）も消えること。ブラウザのエラーが無いこと。
const path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const ev = (f, a) => page.evaluate(f, a);
    await ev(() => { __g.loop(50); __g.selectMap('mesa'); document.getElementById('start').click(); const sc = __g.scene; __g.renderer.render = () => sc.updateMatrixWorld(); for (let i = 0; i < 4; i++) __g.loop(window.__t = (window.__t || 0) + 50); });
    const DIRTY = { downT: 7, downBy: {}, reviveAcc: 900, deathWeapon: 'x', actionHeld: true, crouching: true, actionBlockBoost: true, kneeSlideT: .3,
      stun: 'down', stunT: 1, tilt: .4, electricT: 2, jamT: 3, recoverT: 1, dashT: .2, longDash: true, dashState: 'long', slideT: .5, lungeT: .4, charging: true,
      swing: { t: 0 }, meleeRecovery: { t: 0 }, scoped: true, planted: true, repairing: true, healing: true, healTarget: {}, bombard: {},
      cloak: true, chargerOn: true, fieldOn: true, barrierOn: true, escortOn: true, mirageLock: {},
      flying: true, catMomentum: {}, catLaunch: {}, ctrlLockT: 2, catCd: 2, jumpPad: {}, mobilityRoute: {}, lift: {}, zip: {}, transfer: {},
      waypoint: {}, order: {}, target: {}, aimTarget: {}, navPath: [], navW: 1, navVia: {}, navRc: 3, raidRoute: {} };
    for (const who of ['player', 'bot']) {
      const left = await ev(([who, D]) => {
        const u = who === 'player' ? __g.player : __g.units.find(x => !x.isPlayer);
        __g.addPing(u.team, u.pos.clone(), 'テスト'); u.downPing = __g.pings[__g.pings.length - 1];
        Object.assign(u, D, { alive: false, hp: 0 });
        __g.spawn(u);
        const clean = { downT: 0, reviveAcc: 0, kneeSlideT: 0, stun: '', stunT: 0, tilt: 0, electricT: 0, jamT: 0, recoverT: 0, dashT: 0, dashState: '', slideT: 0, lungeT: 0, ctrlLockT: 0, catCd: 0, navRc: 0 };
        const bad = Object.keys(D).filter(k => k in clean ? u[k] !== clean[k] : !!u[k]);
        if (!u.alive || u.hp !== u.maxHp) bad.push('alive/hp');
        if (u.downPing || __g.pings.some(p => p.label === 'テスト' || p.text === 'テスト')) bad.push('downPing');
        return bad;
      }, [who, DIRTY]);
      ok(left.length === 0, `${who === 'player' ? 'プレイヤー' : 'Bot'}：出撃で前の命の状態が全部消える（${Object.keys(DIRTY).length}項目）` + (left.length ? ' 残った：' + left.join(',') : ''));
    }
    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`出撃時の状態リセット：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
