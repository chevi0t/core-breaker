// 炸裂散弾ライフルと衝撃散弾銃の弾の筋を主武器と同じ太さにする（2026-11-05 オーナー指定）。ほかの副武器は細いまま
// node tools/test/big_trace_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('散弾の弾の筋の太さ', async ({ ev, ok, sortie }) => {
  await sortie('mesa');
  const r = await ev(() => {
    const p = __g.player, W = __g.WEAPONS, out = {};
    const aim = p.pos.clone().add(new p.pos.constructor(0, 2, -60));
    for (const k of ['dart', 'dartE', 'dartH', 'hsg', 'hsgX', 'hsgW', 'hsgH', 'sniper', 'battle']) {
      const n = __g.fx.length; __g.fire(p, aim, 0, W[k]);
      const t = __g.fx.slice(n).filter(f => f.kind === 'tracer');
      out[k] = t.length ? t.every(f => f.enlarged) : null;
    }
    return out;
  });
  for (const k of ['dart', 'dartE', 'dartH', 'hsg', 'hsgX', 'hsgW', 'hsgH']) ok(r[k] === true, `${k} の筋は主武器と同じ太さ`);
  ok(r.sniper === false && r.battle === false, '狙撃銃の筋はそのまま');
});
