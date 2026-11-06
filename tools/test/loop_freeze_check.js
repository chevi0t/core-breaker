// 試合が固まる不具合（2026-11-06、遊んだ人から「11/5の更新から時々フリーズして戻れない」）の試験
// node tools/test/loop_freeze_check.js [dbg] [出力フォルダ]
// 1. 反射衛星砲の Bot が、機体でない目標（砲台・レーダー・コア）を狙っても例外を出さない（vel が無く、ここで loop が止まっていた）
// 2. コマの処理で例外が出ても、次のコマを頼み続けて試合が進む
const { check } = require('./lib');
check('試合が固まらない', async ({ ev, step, ok, sortie }) => {
  await sortie('mesa');
  const r = await ev(() => {
    const g = __g, out = {};
    const bot = g.units.find(u => !u.isPlayer && u.team === 'B');
    g.equip(bot, 'heavy'); bot.slots.sp = g.slotOf('reflector'); Object.assign(bot, { alive: true, isPlayer: false, onGround: true, stun: '' });
    for (const u of g.units) if (u !== bot) { u.alive = false; u.pos.set(10000, 0, 10000); } // 近くの敵機で線の向きが決まらないように
    const targets = { 砲台: g.turrets.find(t => t.team !== bot.team), レーダー: g.radars.find(t => t.team !== bot.team), コア: g.cores.R };
    for (const [name, t] of Object.entries(targets)) {
      if (!t) { out[name] = '無し'; continue; }
      bot.pos.set(t.pos.x + 60, g.terrainH(t.pos.x + 60, t.pos.z), t.pos.z);
      try { const plan = g.reflectorPlan(bot, t); out[name] = plan ? '線' : '撃たない'; } catch (e) { out[name] = '例外 ' + e.message; }
    }
    return out;
  });
  for (const [name, v] of Object.entries(r)) ok(!/^例外/.test(v), `反射衛星砲の Bot が${name}を狙っても例外なし（${v}）`);

  // コマの処理の中で例外を1回投げさせる。前は requestAnimationFrame を頼む前に止まり、それきり試合が動かなかった
  const s = await ev(() => {
    const g = __g, real = window.annTick, errs = [];
    let raf = 0, thrown = 0;
    window.requestAnimationFrame = () => ++raf;
    const cerr = console.error; console.error = (...a) => errs.push(a.join(' '));
    window.annTick = () => { if (!thrown++) throw new Error('試験の例外'); return real(); };
    const t0 = g.timeLeft;
    try { for (let i = 0; i < 20; i++) g.loop(window.__t = (window.__t || 0) + 50); } catch (e) { errs.push('外へ漏れた ' + e.message); }
    window.annTick = real; console.error = cerr;
    return { raf, thrown, advanced: t0 - g.timeLeft, errs };
  });
  ok(s.thrown > 1, 'コマの処理の途中で例外が出た（試験の仕掛け）');
  ok(s.raf === 20, `例外の出たコマも次のコマを頼む（${s.raf}/20）`);
  ok(s.advanced > .8, `例外の後も試合の時間が進む（${s.advanced.toFixed(2)}秒）`);
  ok(s.errs.length === 1 && /試験の例外/.test(s.errs[0]), '例外はコンソールへ1回だけ出る（外へは漏れない）');
});
