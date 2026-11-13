// 電子妨害の被弾演出（2026-11-13 オーナー指定）：①ノイズ ②EMPの英文と BACKUP SYSTEM ACTIVE ③SYSTEM CHECK & REBOOT ④照準周りのHUDが戻る。
// 効果時間に合わせて伸び、即応型（2.5秒）は③④だけ。妨害中はロックオンできないこと（今までどおり）も確かめる。
// node tools/test/jam_screen_check.js [dbg] [出力フォルダ]（JAM_SHOTS=1 なら描画して各段の画面を jam-<秒>-<段>.png で残す。swiftshader では遅い）
const { check } = require('./lib');
const path = require('node:path');
check('電子妨害の被弾演出', async ({ page, ev, step, ok, sortie, out }) => {
  const shots = !!process.env.JAM_SHOTS;
  await sortie('city', { render: shots });
  const hit = s => ev(s => { const p = __g.player; p.jamT = Math.max(p.jamT || 0, s); }, s);
  const look = () => ev(() => ({ ph: +document.getElementById('jamView').dataset.ph || 0, shown: !document.getElementById('jamView').hidden,
    gauge: getComputedStyle(document.getElementById('aimGauge')).visibility, cross: getComputedStyle(document.getElementById('cross')).visibility,
    locked: __g.player.locked, jamT: __g.player.jamT }));
  const run = async (sec, expect) => {
    await hit(sec);
    let t = 0;
    for (const [at, ph] of expect) {
      await step(Math.round((at - t) / .05)); t = at;
      const s = await look();
      ok(s.shown && s.ph === ph, `${sec}秒：${at}秒後は段${ph}（${s.ph}）`);
      ok(ph < 4 ? s.gauge === 'hidden' : s.gauge !== 'hidden', `${sec}秒：段${ph}で照準周りのHUDが${ph < 4 ? '消える' : '戻る'}`);
      ok(s.cross !== 'hidden', `${sec}秒：段${ph}でも照準の点は残る`);
      ok(!s.locked, `${sec}秒：段${ph}でもロックオンしない`);
      if (shots) await page.screenshot({ path: path.join(out, `jam-${sec}-${ph}.png`), timeout: 180000 });
    }
    await step(Math.round((sec - t) / .05) + 4);
    const s = await look();
    ok(!s.shown && s.gauge !== 'hidden', `${sec}秒：切れたら演出が消えて照準周りのHUDが残る`);
  };
  await run(5, [[0.2, 1], [1.5, 2], [3.5, 3], [4.6, 4]]);
  await run(7, [[0.2, 1], [3, 2], [5, 3], [6.6, 4]]);
  await run(4, [[0.2, 1], [1.5, 2], [2.8, 3], [3.6, 4]]);
  await run(2.5, [[0.2, 3], [1.5, 3], [2.1, 4]]);
  // 途中で喰らい直したら頭から
  await hit(5); await step(60); ok((await look()).ph === 3, '5秒：3秒後は段3');
  await hit(5); await step(2); ok((await look()).ph === 1, '喰らい直すと段1からやり直す');
  await step(110);
});
