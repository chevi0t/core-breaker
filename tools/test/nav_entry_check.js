// 歩いて行ける通り道の点が無い所（低い屋上・高架の上など）から navEntry を呼んでも、
// 近い NAV_FAR 個までしか試さない（以前は全部の点を試し、広い都市マップで1回1秒ほど止まった。2026-11-10）。
// node tools/test/nav_entry_check.js [dbg のフォルダ]
const { check } = require('./lib');
check('navEntry の探す数', async ({ ev, ok, sortie }) => {
  await sortie('kanto');
  const r = await ev(() => {
    const g = __g, P = g.NAV.pts, orig = window.clearPath;
    let calls = 0;
    window.clearPath = () => { calls++; return false; }; // どこへも歩けない所
    let s;
    try { s = g.navEntry(P[0].x, P[0].z, P[0].y); } finally { window.clearPath = orig; }
    return { calls, stuck: !!s.stuck, n: P.length, near: g.NAV_NEAR, far: g.NAV_FAR };
  });
  ok(r.n > 200, `通り道の点が多いマップで試す（${r.n}点）`);
  ok(r.stuck, 'どこへも歩けないときは stuck を返す');
  ok(r.calls <= r.near + 36 * (1 + r.near) + r.far, `試した数は ${r.calls} 回（上限 NAV_NEAR＋周りの36点＋NAV_FAR）`);
  // 普通の所では今までどおり近い点が見つかる
  const back = await ev(() => { const g = __g, u = g.units.find(q => q.alive); const s = g.navEntry(u.pos.x, u.pos.z, u.pos.y, u); return !s.stuck; });
  ok(back, '出撃した機体の所からは通り道に入れる');
});
