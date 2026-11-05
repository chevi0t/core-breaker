// X字の照準（2026-11-05、オーナーのスケッチ「三角は狭苦しい」）：照準の形のプルダウンで選ぶ、円と斜めの4本の位置、値の表示、スコアは残弾の棒の下、戻すと三角、旧い照準が優先、保存
// node tools/test/x_aim_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('X字の照準', async ({ page, ev, step, ok, sortie, out }) => {
  await sortie('mesa', { render: true });
  const style = v => ev(v => { const el = document.getElementById('optAimStyle'); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const box = id => ev(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height }; }, id);
  ok(await ev(() => __g.gameOptions.aimStyle === 0 && document.getElementById('optAimStyle').value === '0' && !document.body.classList.contains('aimX')), '最初は三角の照準（X字は選んだ時だけ）');
  await style(1); await step(2);
  ok(await ev(() => __g.gameOptions.aimX === 1 && document.body.classList.contains('aimX') && JSON.parse(localStorage.getItem('coreBreakerOptions')).aimStyle === 1), '照準の形のプルダウンで X字を選べて、保存される');
  ok(await ev(() => !document.getElementById('triangleAim').hasAttribute('hidden') && getComputedStyle(document.getElementById('taRing')).display !== 'none'), '照準のまわりに円が出る');
  const W = 1280 / 2, H = 720 / 2;
  const ring = await box('taRing');
  ok(Math.abs(ring.cx - W) < 2 && Math.abs(ring.cy - H) < 2, '円は画面の真ん中');
  const bars = { taBoostFill: [-1, -1, 'ブースト'], taHpFill: [1, -1, '耐久'], taSpFill: [-1, 1, 'SP'], taAmmoFill: [1, 1, '残弾'] };
  for (const [id, [sx, sy, name]] of Object.entries(bars)) {
    const b = await box(id.replace('Fill', 'Bg'));
    const inner = { x: sx < 0 ? b.r : b.x, y: sy < 0 ? b.b : b.y }, outer = { x: sx < 0 ? b.x : b.r, y: sy < 0 ? b.y : b.b };
    ok(Math.sign(b.cx - W) === sx && Math.sign(b.cy - H) === sy && Math.hypot(inner.x - W, inner.y - H) >= ring.w / 2 - 6 && Math.hypot(outer.x - W, outer.y - H) > ring.w, `${name}の棒は${sy < 0 ? '上' : '下'}${sx < 0 ? '左' : '右'}へ、円の外へ伸びる`);
  }
  await ev(() => { const p = __g.player; p.boost = p.maxBoost / 2; p.hp = p.maxHp * .25; __g.triangleHud(p); });
  ok(await ev(() => document.getElementById('taBoostFill').getAttribute('stroke-dasharray') === '50.0 100' && document.getElementById('taHpFill').getAttribute('class') === 'ta-low' && /BOOST 50%/.test(document.getElementById('taBoostValue').textContent)), '値が棒と文字に出る（ブースト50%、耐久が少ないと警告の色）');
  // 文字は重ならない
  const texts = ['taBoostValue', 'taHpText', 'taSpValue', 'taAmmoText'];
  const rects = []; for (const id of texts) rects.push(await box(id));
  const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  ok(rects.every((a, i) => rects.every((b, j) => i === j || !overlap(a, b))) && rects.every(a => !overlap(a, ring)), '4つの文字は互いにも円とも重ならない');
  await ev(() => { __g.addScore(__g.player, 'battle', 4, '撃破'); for (const d of document.querySelectorAll('#scorePop div')) d.style.animation = 'none'; });
  const score = await box('scorePop'), ammo = await box('taAmmoBg');
  ok(score.x > W && score.y >= ammo.b - 2 && score.x < ammo.r, 'スコア（+4 撃破）は右下の残弾の棒の下');
  await page.screenshot({ path: out + '/x_aim.png' });
  // 大きさの設定も効く
  const w1 = (await box('taRing')).w;
  await ev(() => { const el = document.getElementById('optHudTriangle'); el.value = 150; el.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(Math.abs((await box('taRing')).w / w1 - 1.5) < .05, '照準ゲージの大きさ150%で円も棒も1.5倍');
  await ev(() => { const el = document.getElementById('optHudTriangle'); el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // 旧い照準
  await style(2); await step(1);
  ok(await ev(() => !document.body.classList.contains('aimX') && document.body.classList.contains('aimClassic') && getComputedStyle(document.getElementById('triangleAim')).display === 'none'), '「旧い照準」を選ぶと X字は消えて旧い照準になる');
  const statusShown = () => ev(() => document.body.dataset.console === 'standard' && getComputedStyle(document.getElementById('status')).display !== 'none');
  ok(await statusShown(), '旧い照準では、左下の耐久・ブースト・SPの計器も前のとおり出る');
  // 三角に戻す
  await style(0); await step(2);
  const ammoT = await box('taAmmoBg'), hpT = await box('taHpBg');
  ok(await ev(() => !document.body.classList.contains('aimX') && getComputedStyle(document.getElementById('taRing')).display === 'none') && ammoT.cx < W && hpT.cx > W && ammoT.cy < H + 40, '「三角」で三角の照準に戻る（左が残弾、右が耐久）');
  ok(!(await statusShown()), '三角では左下の計器は隠したまま（2026-11-04 の整理どおり）');
  // 前の「旧い照準を使う」スイッチの保存から移す
  await ev(() => localStorage.setItem('coreBreakerOptions', JSON.stringify({ aimClassic: 1, master: 40 })));
  await page.reload();
  ok(await ev(() => __g.gameOptions.aimStyle === 2 && document.getElementById('optAimStyle').value === '2' && document.body.classList.contains('aimClassic') && __g.gameOptions.master === 40), '前に「旧い照準を使う」をONで保存していれば、照準の形は「旧い照準」になる');
});
