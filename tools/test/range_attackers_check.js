// 射撃場の撃ってくる標的4機（RANGE_ATTACKERS、2026-11-04）を確かめる。
// node tools/test/range_attackers_check.js dbg [出力フォルダ]
// 一方向のガトリングが撃ち続けること・掃射が30度を往復すること・ロックオン射撃が60m以内だけ撃つこと・近接が25m以内で斬りかかり、
// 離れると戻ること・最初の位置には弾が届かないこと・倒されたら最初の位置へ戻ること、ブラウザのエラーが無いことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || 'dbg'), out = path.resolve(process.argv[3] || '/tmp/range-attackers-check');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    await page.route('**fonts.g*/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.addInitScript(() => { requestAnimationFrame = () => 0; window.AudioContext = window.webkitAudioContext = undefined; });
    await page.goto('file://' + path.join(dir, 'dbg.html'));
    const ok = (v, m) => { assert.ok(v, m); checks.push(m); };
    const ev = (f, a) => page.evaluate(f, a);
    const step = (n = 1) => ev(n => { for (let i = 0; i < n; i++) __g.loop(window.__t = (window.__t || 0) + 50); }, n);
    await step(2);
    await ev(() => document.getElementById('menuRange').click());
    await step(2);
    ok(await ev(() => __g.range && __g.running), '射撃場に入る');
    const A = await ev(() => __g.range.targets.filter(t => t.rangeA).map(t => ({ kind: t.rangeA.kind, cls: t.cls, main: t.slots.main.w.name, aux: t.slots.aux.w.name, name: t.name, hp: t.maxHp })));
    ok(A.map(a => a.kind).join() === 'stream,sweep,lock,melee', `撃ってくる標的4機（${A.map(a => a.name).join('・')}）`);
    ok(A[0].cls === 'heavy' && A[1].cls === 'heavy' && A[0].hp === 14000, `ガトリングの2機は重火力（${A[0].main}）`);
    ok(A[2].cls === 'assault' && A[3].cls === 'assault', `ロックオン射撃と近接は強襲（${A[2].main}・${A[3].aux}）`);
    // 自機を置いて数フレーム進め、その間に受けたダメージ
    const at = (x, z) => ev(([x, z]) => { const p = __g.player; p.pos.set(x, __g.terrainH(x, z), z); p.vel.set(0, 0, 0); p.hp = p.maxHp; p.invulT = 0; }, [x, z]);
    const dmg = async n => { const h0 = await ev(() => __g.player.hp); await step(n); return h0 - await ev(() => __g.player.hp); };
    const byKind = k => `__g.range.targets.find(t => t.rangeA && t.rangeA.kind === '${k}')`;

    // 最初の位置では何も当たらない
    ok(await dmg(80) === 0 && await ev(() => __g.player.alive), '最初の位置（4秒）では撃たれない');
    ok(await ev(() => __g.range.targets.filter(t => t.rangeA && t.rangeA.kind !== 'sweep').every(t => Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z) < 1.5)), '撃ってくる標的は元の位置にいる');

    // 一方向：通路を横切る線（z=110）に入ると当たる
    const dStream = await (async () => { await at(0, 110); return dmg(30); })();
    ok(dStream > 0, `一方向のガトリングの線に入ると当たる（1.5秒で ${dStream}）`);
    const streamAmmo = await ev(new Function(`const t = ${byKind('stream')}; return { a: t.slots.main.ammo, mag: t.slots.main.w.mag, oh: t.slots.main.overheat, yaw: t.yaw };`));
    ok(!streamAmmo.oh && streamAmmo.a > 0 && Math.abs(streamAmmo.yaw + Math.PI / 2) < 1e-6, '一方向のガトリングは弾切れも過熱もせず、向きも変わらない');
    await at(0, 170); await step(2);

    // 掃射：±15度を往復する
    const yaws = [];
    for (let i = 0; i < 20; i++) { await step(4); yaws.push(await ev(new Function(`return ${byKind('sweep')}.yaw;`))); }
    const span = (Math.max(...yaws) - Math.min(...yaws)) * 180 / Math.PI;
    ok(span > 25 && span <= 30.5, `掃射は約30度を往復する（${span.toFixed(1)}度）`);
    await at(0, 30);
    const dSweep = await dmg(80);
    ok(dSweep > 0, `掃射の範囲に入ると当たる（4秒で ${dSweep}）`);

    // ロックオン射撃：70m では撃たず、50m で狙って撃つ（被ロックオンの警告に出る）
    const lk = await ev(new Function(`const t = ${byKind('lock')}; return { x: t.home.x, z: t.home.z };`));
    await at(lk.x, lk.z + 70);
    ok(await dmg(40) === 0 && await ev(new Function(`return !${byKind('lock')}.target;`)), 'ロックオン射撃は70mでは撃たない');
    await at(lk.x, lk.z + 50);
    let lockSeen = false, dLock = 0;
    for (let i = 0; i < 8; i++) { dLock += await dmg(10); lockSeen ||= await ev(new Function(`const t = ${byKind('lock')}; return t.target === __g.player && t.locked;`)); }
    ok(lockSeen, 'ロックオン射撃は50mで自機をロックする');
    ok(dLock > 0, `ロックオン射撃は50mで撃ってくる（4秒で ${dLock}）`);

    // 近接：40m では動かず、20m で斬りかかる。離れると元の位置へ戻る
    const ml = await ev(new Function(`const t = ${byKind('melee')}; return { x: t.home.x, z: t.home.z };`));
    await at(ml.x, ml.z + 40);
    ok(await dmg(20) === 0 && await ev(new Function(`const t = ${byKind('melee')}; return Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z) < 1.5;`)), '近接は40mでは動かない');
    await at(ml.x, ml.z + 20);
    let swung = false, dMelee = 0;
    for (let i = 0; i < 12; i++) {
      dMelee += await dmg(5); swung ||= await ev(new Function(`return !!${byKind('melee')}.swing;`));
      if (await ev(() => Math.abs(__g.player.pos.z - 170) < .01)) { dMelee = '撃破されて最初の位置へ'; break; } // 踏み込み斬りは1撃で倒れることがある
    }
    await page.screenshot({ path: path.join(out, 'melee.png') });
    ok(swung, '近接は20mで斬りかかる');
    ok(dMelee !== 0, `近接の斬りが当たる（${dMelee}）`);
    await at(0, 170);
    await step(200);
    ok(await ev(new Function(`const t = ${byKind('melee')}; return t.alive && Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z) < 2;`)), '自機が離れると近接は元の位置へ戻る');

    // 倒されたら最初の位置へ
    await at(0, 110); await ev(() => { __g.player.hp = 30; });
    await step(20);
    ok(await ev(() => __g.player.alive && Math.abs(__g.player.pos.z - 170) < .01 && __g.player.hp === __g.player.maxHp), '撃ってくる標的に倒されても最初の位置からやり直す');
    // 撃ってくる標的も撃破でき、2秒で戻る
    await ev(new Function(`const t = ${byKind('lock')}; __g.kill(t, __g.player);`));
    await step(45);
    ok(await ev(new Function(`const t = ${byKind('lock')}; return t.alive && t.slots.main.w === __g.WEAPONS.ar && t.name.includes('ロックオン');`)), '撃ってくる標的も撃破から2秒で同じ武器のまま起き上がる');

    ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '\n' + errors.join('\n') : ''));
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.log(`射撃場の撃ってくる標的：${checks.length}項目 成功`);
  } catch (e) {
    console.log(checks.map(c => '  ' + c).join('\n'));
    console.error('失敗：', e.message);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
