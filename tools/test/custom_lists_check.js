// 機体カスタマイズの一覧（2026-11-06）：全兵装の全枠（パーツ4つと武器4つ）の一覧を実際に開き、シリーズを全部開いて、
// 全部の型にマウスを乗せても（差の表）エラーが出ないこと。表のつながり（武器↔シリーズ、パーツ↔シリーズ↔メーカー）も確かめる。
// きっかけ：スタナーのシリーズ名 ie が索敵センサーの ie と重なり（同じオブジェクトの中の重複キーは後の方が勝つ）、
// 支援の補助装備の一覧が開けなかった（オーナー「機体カスタマイズ支援補助装備のリスト読み込み不可」）。
// node tools/test/custom_lists_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('カスタマイズの一覧', async ({ page, ev, ok, errors }) => {
  const table = await ev(() => {
    const g = __g, bad = [];
    for (const [id, se] of Object.entries(g.SERIES)) {
      if (!g.MAKERS[se.maker]) bad.push(`シリーズ ${id} のメーカー ${se.maker} が無い`);
      for (const [k] of se.types) if (!g.WEAPONS[k]) bad.push(`シリーズ ${id} の ${k} が武器に無い`); else if (g.WEAPONS[k].series !== id) bad.push(`${k} のシリーズが ${g.WEAPONS[k].series}（${id} のはず。シリーズ名の重複？）`);
    }
    for (const [k, w] of Object.entries(g.WEAPONS)) if (!g.SERIES[w.series]) bad.push(`武器 ${k}（${w.name}）にシリーズが無い`);
    for (const c of g.CLASS_KEYS) for (const s of g.SLOTS) for (const k of g.ARMORY[c][s]) if (!g.WEAPONS[k]) bad.push(`${c} ${s} の ${k} が武器に無い`);
    for (const [slot, ps] of Object.entries(g.PARTS)) for (const [k, p] of Object.entries(ps)) {
      const se = g.PART_SERIES[p.series];
      if (!se) bad.push(`パーツ ${slot}.${k} にシリーズが無い`); else if (!g.MAKERS[se.maker]) bad.push(`パーツのシリーズ ${p.series} のメーカーが無い`);
    }
    return { bad, weapons: Object.keys(g.WEAPONS).length, series: Object.keys(g.SERIES).length };
  });
  ok(!table.bad.length, `武器${table.weapons}種・シリーズ${table.series}：表のつながりに抜けが無い` + (table.bad.length ? '：' + table.bad.slice(0, 5).join('、') : ''));
  await page.click('#pgMenu [data-page="pgCustom"]');
  for (const c of await ev(() => __g.CLASS_KEYS)) {
    await page.click(`[data-cu="${c}"]`);
    const slots = await ev(() => [...document.querySelectorAll('#cuSlotList [data-cslot]')].map(b => b.dataset.cslot));
    for (const s of slots) {
      const before = errors.length;
      const r = await ev(([c, s]) => {
        const g = __g, list = document.querySelector('#cuSlotList');
        list.querySelector(`[data-cslot="${s}"]`).click();
        for (let n = 0; n < 200; n++) { const b = document.querySelector('#cuSeries [data-series][aria-expanded="false"]'); if (!b) break; b.click(); }
        const picks = [...document.querySelectorAll('#cuSeries [data-pick]')].map(b => b.dataset.pick);
        for (const k of picks) document.querySelector(`#cuSeries [data-pick="${k}"]`)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        document.querySelector('#cuSeries').dispatchEvent(new PointerEvent('pointerleave'));
        const want = ['head', 'body', 'arms', 'legs'].includes(s) ? Object.keys(g.PARTS[s]).length : g.ARMORY[c][s].length;
        return { head: document.querySelector('#cuSeries h3')?.textContent || '', n: new Set(picks).size, want };
      }, [c, s]);
      ok(errors.length === before && r.n === r.want, `${c} ${r.head}：型${r.n}/${r.want}を開いて、全部にマウスを乗せられる` + (errors.length > before ? '：' + errors[before].split('\n')[0] : ''));
    }
  }
});
