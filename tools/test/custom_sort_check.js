// 機体カスタマイズの並べ替えと重量のバー（2026-11-11、オーナー「重量ゲージをアクションの下ぐらいに」
// 「並べ替えを頭であればロックオン性能や集弾率などパーツごとの各種性能でソートできるように」）。
//  - 重量のバー（#cuWBar）がアクション（#cuActions）のすぐ下、3列（.cuCols）の上にある。
//  - 並べ替えのプルダウンに、その枠の性能（差の表 itemNums と同じ数値）が出て、選ぶと良い順の平らな一覧になる。
//  - 全兵装の全枠の全性能で、順番が正しく、エラーが出ない。軽い順・重い順・メーカーごとは今までどおり。
// node tools/test/custom_sort_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('カスタマイズの並べ替え', async ({ page, ev, ok }) => {
  await page.click('#pgMenu [data-page="pgCustom"]');
  const pick = sl => page.click(`#cuSlotList [data-cslot="${sl}"]`);
  const sortBy = v => page.selectOption('#cuSortSel', v);
  const rows = () => page.$$eval('#cuSeries [data-pick]', bs => bs.map(b => ({ key: b.dataset.pick, tag: b.querySelector('.kg em')?.textContent || '', kg: b.querySelector('.kg').textContent })));
  const options = () => page.$$eval('#cuSortSel option', os => os.map(o => ({ v: o.value, t: o.textContent, g: o.parentElement.label || '' })));

  // 重量のバーの場所
  const pos = await ev(() => {
    const r = id => document.querySelector(id).getBoundingClientRect(), a = r('#cuActions'), w = r('#cuWBar'), c = r('.cuCols');
    const kids = [...document.querySelector('#pgCustom').children].map(e => e.id || e.className);
    return { order: kids.indexOf('cuWBar') === kids.indexOf('cuActions') + 1 && kids.indexOf('cuCols') === kids.indexOf('cuWBar') + 1, below: w.top >= a.bottom - 1, above: w.bottom <= c.top + 1, gap: w.top - a.bottom, text: document.querySelector('#cuWBar').textContent };
  });
  ok(pos.order && pos.below && pos.above && pos.gap < 40, `重量のバーがアクションのすぐ下、3列の上にある（すき間 ${Math.round(pos.gap)}px）`);
  ok(/重量 \d+kg/.test(pos.text) && /重量耐性 \d+kg/.test(pos.text), '重量のバーに重量と重量耐性が出ている');

  // 頭：性能の選択肢と、良い順
  await pick('head');
  let op = await options();
  ok(op.slice(0, 3).map(o => o.v).join() === 'order,light,heavy' && op[1].g === '重量', '並べ替えの頭はメーカーごと・軽い順・重い順のまま');
  const headStats = op.filter(o => o.g === '性能の良い順').map(o => o.t);
  ok(headStats.join() === '被ダメージ,ロック距離,弾のばらつき', '頭の性能：被ダメージ・ロック距離・弾のばらつき（' + headStats.join('・') + '）');
  await sortBy('stat:ロック距離');
  let rs = await rows();
  const head = await ev(() => Object.fromEntries(Object.entries(__g.PARTS.head).map(([k, p]) => [k, { lock: p.lock, aim: p.aim, armor: p.armor, weight: p.weight }])));
  const mono = (list, f) => list.every((r, i) => !i || f(list[i - 1].key) <= f(r.key) + 1e-9);
  ok(rs.length === Object.keys(head).length && mono(rs, k => -head[k].lock), `ロック距離：頭の全${rs.length}型が長い順に並ぶ（先頭 ${rs[0].tag}）`);
  ok(rs.every(r => r.tag === `ロック距離 ${head[r.key].lock}m`) && rs.every(r => r.kg.endsWith(head[r.key].weight + 'kg')), '行の右に並べ替えた性能の数値と重量が出る');
  ok(await page.$eval('#cuSortSel', s => s.value) === 'stat:ロック距離', 'プルダウンが選んだ性能のまま');
  await sortBy('stat:弾のばらつき');
  rs = await rows();
  ok(mono(rs, k => 1 / head[k].aim), `弾のばらつき：小さい（良い）順に並ぶ（先頭 ${rs[0].tag}、最後 ${rs[rs.length - 1].tag}）`);
  await sortBy('stat:被ダメージ');
  rs = await rows();
  ok(mono(rs, k => head[k].armor), `被ダメージ：小さい（良い）順に並ぶ（先頭 ${rs[0].tag}）`);

  // 並べた一覧から付けられる
  const target = rs[rs.length - 1].key;
  await page.click(`#cuSeries [data-pick="${target}"]`);
  ok(await ev(k => __g.mechCfg.head === k, target) && (await rows()).length === rs.length, '並べた一覧の行をクリックして付けられ、並べ替えは続く');

  // 枠を替える：同じ名前の性能は引き継ぎ、無い性能ならメーカーごとに戻る
  await pick('body');
  ok(await page.$eval('#cuSortSel', s => s.value) === 'stat:被ダメージ', '胴に替えても、胴にもある性能（被ダメージ）の並べ替えは続く');
  op = await options();
  ok(op.filter(o => o.g).map(o => o.t).join() === '軽い順,重い順,被ダメージ,ブースト,SP回復', '胴の性能：被ダメージ・ブースト・SP回復');
  await sortBy('stat:ブースト');
  await pick('arms');
  ok(await page.$eval('#cuSortSel', s => s.value) === 'order' && await page.$$eval('#cuSeries .cuSer', b => b.length) > 0, '腕に無い性能（ブースト）のときは、メーカーごとの一覧で出る');
  op = await options();
  ok(op.filter(o => o.g === '性能の良い順').map(o => o.t).join() === '被ダメージ,リロード時間,持ち替え,反動,主・副武器の弾', '腕の性能：被ダメージ・リロード時間・持ち替え・反動・主・副武器の弾');
  await pick('legs');
  op = await options();
  const legStats = op.filter(o => o.g === '性能の良い順').map(o => o.t);
  ok(legStats.includes('歩行・通常移動') && legStats.includes('ダッシュ・高速移動') && legStats.includes('巡航') && legStats.includes('重量耐性'), '脚の性能：歩行・ダッシュ（ホバーの呼び名も同じ性能）・巡航・重量耐性（' + legStats.join('、') + '）');
  await sortBy('stat:歩行');
  rs = await rows();
  const legs = await ev(() => Object.fromEntries(Object.entries(__g.PARTS.legs).map(([k, p]) => [k, { walk: p.walk, kind: p.kind }])));
  const hover = rs.filter(r => legs[r.key].kind === 'hover');
  ok(rs.length === Object.keys(legs).length && mono(rs, k => -legs[k].walk) && hover.length > 0 && hover.every(r => r.tag.startsWith('通常移動 ')), `歩行：ホバー脚（${hover.length}型、表示は通常移動）も一緒に速い順に並ぶ`);

  // 全兵装・全枠・全性能：順番が正しく、持たない型は最後
  const all = await ev(() => {
    const g = __g, bad = [], sel = () => document.querySelector('#cuSortSel');
    let n = 0, lists = 0;
    for (const cls of g.CLASS_KEYS) {
      document.querySelector(`#cuTabs [data-cu="${cls}"]`).click();
      for (const sl of [...g.PART_SLOTS, ...g.SLOTS]) {
        document.querySelector(`#cuSlotList [data-cslot="${sl}"]`).click();
        const stats = g.cuSortStats(sl), items = g.cuItems(sl);
        lists++;
        for (const st of stats) {
          sel().value = 'stat:' + st.id; sel().dispatchEvent(new Event('change', { bubbles: true }));
          const keys = [...document.querySelectorAll('#cuSeries [data-pick]')].map(b => b.dataset.pick);
          if (keys.length !== items.length || new Set(keys).size !== items.length) { bad.push(`${cls} ${sl} ${st.id}：${keys.length}/${items.length}型`); continue; }
          const vals = keys.map(k => { const r = g.cuSortNum(sl, k, st.id); return r ? r[1] : null; });
          for (let i = 1; i < vals.length; i++) {
            const a = vals[i - 1], b = vals[i];
            if (a === null && b !== null) bad.push(`${cls} ${sl} ${st.id}：持たない型が先にある`);
            else if (a !== null && b !== null && (st.hi ? a < b - 1e-9 : a > b + 1e-9)) bad.push(`${cls} ${sl} ${st.id}：${keys[i - 1]}(${a}) → ${keys[i]}(${b})`);
          }
          if (document.querySelectorAll('#cuSeries [data-pick] .kg em').length !== items.length) bad.push(`${cls} ${sl} ${st.id}：数値の出ていない行がある`);
          n++;
        }
        for (const [v, dir] of [['light', 1], ['heavy', -1]]) {
          sel().value = v; sel().dispatchEvent(new Event('change', { bubbles: true }));
          const kg = [...document.querySelectorAll('#cuSeries [data-pick]')].map(b => g.itemKg(sl, b.dataset.pick));
          if (kg.length !== items.length || kg.some((x, i) => i && (x - kg[i - 1]) * dir < 0)) bad.push(`${cls} ${sl} ${v}`);
          if (document.querySelector('#cuSeries [data-pick] .kg em')) bad.push(`${cls} ${sl} ${v}：性能の数値が残っている`);
        }
        sel().value = 'order'; sel().dispatchEvent(new Event('change', { bubbles: true }));
        if (!document.querySelector('#cuSeries .cuSer')) bad.push(`${cls} ${sl}：メーカーごとに戻らない`);
      }
    }
    return { bad, n, lists };
  });
  ok(!all.bad.length, `全4兵装の${all.lists}枠・${all.n}通りの性能で良い順に並び、軽い順・重い順・メーカーごとも今までどおり` + (all.bad.length ? '：' + all.bad.slice(0, 6).join('、') : ''));
});
