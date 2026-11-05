// 光学迷彩中に Bot が気づく距離（2026-11-05）。気づく距離は 8m＋見えやすさ²×80m で、画面の濃さ（見えやすさの2乗）と合う。
// node tools/test/camo_notice_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('光学迷彩に気づく距離', async ({ ev, ok, sortie }) => {
  await sortie('mesa');
  const r = await ev(() => {
    const p = __g.player, sl = p.slots.sp, keep = sl.w, out = {};
    sl.w = __g.WEAPONS.camo;
    // 見えやすさが落ち着くまで回して、気づかれる一番遠い距離を探す
    const far = (speed, poke) => {
      p.cloak = true; sl.overheat = false; p.vis = 1;
      for (let i = 0; i < 200; i++) { sl.heat = 100; p.vel.set(speed, 0, 0); if (poke) poke(i); __g.camoTick(p, sl, 0.05); }
      let d = 0; while (d < 100 && __g.noticed(p, d + 0.5)) d += 0.5;
      return d;
    };
    out.still = far(0); out.walk = far(__g.WALK); out.dash = far(__g.DASH);
    out.shoot = far(0, i => { if (i === 199) __g.reveal(p); });
    p.cloak = false; out.off = __g.noticed(p, 500);
    sl.w = keep;
    return out;
  });
  ok(r.still >= 7 && r.still <= 10, `止まっていると約${r.still}mまで寄られないと気づかれない`);
  ok(r.walk >= 17 && r.walk <= 23, `歩くと約${r.walk}m`);
  ok(r.dash >= 29 && r.dash <= 35, `ダッシュで約${r.dash}m（前は約52m）`);
  ok(r.shoot >= 55 && r.shoot <= 65, `撃った直後は約${r.shoot}m`);
  ok(r.off, '迷彩を切れば遠くでも気づかれる');
});
