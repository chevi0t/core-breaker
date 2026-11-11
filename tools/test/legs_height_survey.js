// 逆脚の高いジャンプで新しく登れるようになる所を、今あるマップの箱（obstacles）から数える（#228）。試験ではなく調べ物。
// node tools/test/legs_height_survey.js [dbg] [出力]
// 目安（RULES.md §5 と legs_kinds_check の実測）：二脚はジャンプ 6.6m、空中ダッシュ込みで 10m まで。逆脚はジャンプ 8.8m（空中ダッシュ込みで約12m）、溜めジャンプ 11.8m（同 約15m）。
// 箱の上面が、周りの地面（箱の外 2.5m の8点のうち一番高い所。そこから跳ぶ）より 10m を超えて 15m 以下の物を数える。都市モデルのマップ（箱でない建物）は数えられない。
const fs = require('node:fs'), path = require('node:path');
const { check } = require('./lib');
check('逆脚の高さの調べ', async ({ ev, ok, page, dir, out, step }) => {
  await step(2);
  const ids = await ev(() => Object.keys(__g.MAPS)), res = {};
  for (const id of ids) {
    await page.goto('file://' + path.join(dir, 'dbg.html')); await step(2);
    res[id] = await ev(id => {
      const g = __g; g.selectMap(id); g.setup(); g.running = false;
      const list = [], city = !!g.cityMap;
      for (const o of g.obstacles) {
        if (!Number.isFinite(o.top) || (o.bottom ?? -Infinity) > o.top - .5) continue;
        const cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2, m = 2.5, pts = [[o.minX - m, cz], [o.maxX + m, cz], [cx, o.minZ - m], [cx, o.maxZ + m], [o.minX - m, o.minZ - m], [o.maxX + m, o.minZ - m], [o.minX - m, o.maxZ + m], [o.maxX + m, o.maxZ + m]];
        let from = -Infinity;
        for (const [x, z] of pts) { if (Math.abs(x) > g.MAP_X - 1 || Math.abs(z) > g.MAP_Z - 1) continue; const h = g.groundAt(x, z, o.top - 10.01); if (h < o.top - .5) from = Math.max(from, h); }
        const rel = o.top - from;
        if (rel > 10 && rel <= 15 && o.maxX - o.minX >= 2 && o.maxZ - o.minZ >= 2) list.push({ x: +cx.toFixed(0), z: +cz.toFixed(0), top: +o.top.toFixed(1), rel: +rel.toFixed(1), size: [+(o.maxX - o.minX).toFixed(0), +(o.maxZ - o.minZ).toFixed(0)], edge: Math.abs(cx) > g.MAP_X - 12 || Math.abs(cz) > g.MAP_Z - 12 });
      }
      return { name: g.MAPS[id].name, city, boxes: g.obstacles.length, plain: list.filter(b => b.rel <= 12), charged: list.filter(b => b.rel > 12) };
    }, id);
  }
  const lines = ['| マップ | 箱の数 | 逆脚のジャンプで新しく届く（10〜12m） | 溜めジャンプで新しく届く（12〜15m） | 例（x,z：高さ） |', '|---|---:|---:|---:|---|'];
  for (const [id, r] of Object.entries(res)) lines.push(`| ${r.name}（${id}）${r.city ? '※都市モデル' : ''} | ${r.boxes} | ${r.plain.length} | ${r.charged.length} | ${[...r.plain, ...r.charged].slice(0, 4).map(b => `${b.x},${b.z}：${b.rel}m`).join('、')} |`);
  console.log(lines.join('\n'));
  fs.writeFileSync(path.join(out, 'legs-height.json'), JSON.stringify(res, null, 1) + '\n'); fs.writeFileSync(path.join(out, 'legs-height.md'), lines.join('\n') + '\n');
  ok(ids.length > 0, `${ids.length}マップを調べた`);
}, { errorsOk: /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/ });
