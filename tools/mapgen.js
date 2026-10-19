// マップ生成のデータ部分。地形の乱数と配置の乱数は分離する。
const fs = require('node:fs');

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function geometry(seed) {
  const rng = random(seed), integer = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const west = integer(-90, -80), east = integer(68, 78), deck = integer(7, 9), pad = integer(60, 68);
  const terrain = [], layout = [];
  for (const sign of [1, -1]) {
    terrain.push({type:'block', x:west, z:sign * pad, hx:17, hz:18, h:deck, slope:2.5});
    terrain.push({type:'ramp', x0:west - 13, x1:west + 13, z0:sign * (pad + 18), z1:sign * (pad + 62), h:deck});
    // ポッドは三方の土手と窪地に隠し、ベース側だけ開ける。
    terrain.push({type:'block', x:0, z:sign * 141, hx:18, hz:3, h:5, slope:2.5});
    for (const x of [-21, 21]) terrain.push({type:'block', x, z:sign * 151, hx:3, hz:10, h:5, slope:2.5});
    terrain.push({type:'trench', x:0, z0:sign * 147, z1:sign * 158, w:12, slope:3, h:-2});
  }
  // 貯水区画は片側だけ。通り道・再出撃位置から外し、段差は歩ける傾斜にする。
  terrain.push({type:'trench', x:126, z0:24, z1:86, w:10, slope:12, h:-5});
  for (const [x, z, w, d, h] of [
    [-36, 46, 16, 20, 11], [34, -46, 18, 22, 9],
    [35, 86, 14, 16, 7], [-38, -88, 16, 14, 12],
    [-128, -20, 12, 28, 6], [113, -66, 12, 20, 5],
    [40, 10, 7, 7, 14], [-44, -10, 7, 7, 10],
  ]) layout.push([x, z, w, d, h]);
  const d = {
    order:5, name:'白煙循環区', subtitle:'検証中', asym:true,
    size:[150, 240], team:5, time:300, baseZ:210, baseLine:165,
    desc:'停止した熱交換施設。片側の保守高架と地上の連絡路が交差する。配置・勝率を検証中。',
    terrain, layout,
    plants:[['A', 0, 120, 'B'], ['Z', 0, -120, 'R']],
    turrets:[[-33, 177], [33, 177]], radar:[-50, 220],
    catapults:[[-62, 190, -116, 94], [62, 190, east, 100], [-100, 190, west, 112], [100, 190, 110, 112]],
    basePods:[[-21, 190], [21, 190]], plantPods:[['A', 0, 153], ['Z', 0, -153]],
    barricades:[], bridges:[[west, 0, 28, pad * 2 - 20, deck, 1.5]],
    water:[[126, 55, 10, 31, -4.7]],
    paved:[[-20, 20, -138, 138], [west - 21, west + 21, -138, 138], [east - 22, east + 22, -138, 138],
      [-115, 105, -116, -94], [-115, 105, -18, 18], [-115, 105, 94, 116], [-30, 30, 112, 165], [-30, 30, -165, -112]],
    generation:{version:1, seed, west, east, deck, pad, balance:'勝率未確定'},
  };
  return d;
}

function placements(candidates, seed, count = 64) {
  if (!Number.isInteger(count) || count < 1) throw new Error('配置試行数は正の整数にしてください');
  const rng = random(seed), proposals = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const shuffled = candidates.slice();
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const take = 1 + Math.floor(rng() * Math.min(4, candidates.length));
    const selected = shuffled.slice(0, take).sort((a, b) => b.z - a.z || a.x - b.x);
    if (!selected.length || selected.some((a, j) => selected.slice(j + 1).some(b => Math.hypot(a.x - b.x, a.z - b.z) < 42))) continue;
    // 極端な初動距離の差を一次検査で落とす。これは実対戦の勝率ではない。
    const blue = Math.min(...selected.map(p => Math.hypot(p.x, 210-p.z)));
    const red = Math.min(...selected.map(p => Math.hypot(p.x, -210-p.z)));
    if (Math.max(blue,red) / Math.min(blue,red) > 1.35) continue;
    const signature = selected.map(p => p.key).join(',');
    if (seen.has(signature)) continue;
    seen.add(signature);
    const plants = [[0, 120, 'B'], ...selected.map(p => [p.x, p.z, null]), [0, -120, 'R']]
      .map(([x, z, owner], j) => [String.fromCharCode(65 + j), x, z, owner]);
    const elevated = selected.filter(p => p.y >= 5).length;
    const spread = Math.max(...selected.map(p => p.x)) - Math.min(...selected.map(p => p.x));
    const metrics = {plants:plants.length, elevated, spread, offCenter:selected.filter(p => Math.abs(p.x) > 40).length};
    const name = elevated >= 2 ? '高架縦断' : elevated ? '片翼争奪' : spread > 80 ? '両翼連絡' : metrics.offCenter ? '側面迂回' : '中央冷却路';
    proposals.push({plants, plantPods:[['A', 0, 153], [plants.at(-1)[0], 0, -153]], name, metrics, signature});
  }
  return proposals;
}

// 座標の微差ではなく、拠点数・高所・左右への分散の差を使って候補を選ぶ。
function diversity(a, b) {
  return Math.abs(a.plants - b.plants) + Math.abs(a.elevated - b.elevated) * 2 + Math.abs(a.spread - b.spread) / 60 + Math.abs(a.offCenter - b.offCenter);
}
function selectDiverse(proposals, count) {
  const chosen = [];
  const left = proposals.slice().sort((a, b) => a.metrics.plants - b.metrics.plants || a.metrics.offCenter - b.metrics.offCenter);
  while (left.length && chosen.length < count) {
    let index = 0;
    if (chosen.length) {
      let best = -Infinity;
      left.forEach((p, i) => {const score = Math.min(...chosen.map(q => diversity(p.metrics, q.metrics))); if (score > best) {best = score; index = i;}});
      if (best < 1) break;
    }
    chosen.push(left.splice(index, 1)[0]);
  }
  return chosen;
}

function serialize(id, data) {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error('マップIDは英小文字から始まる英小文字・数字・_ にしてください');
  // gen_rough.py の既存の terrain マーカーを利用する。
  const rough = data.generation?.roughCount || 0;
  const terrain = ['terrain: [', '    // 起伏ここから'];
  data.terrain.forEach((f, i) => {
    if (i === rough) terrain.push('    // 起伏ここまで');
    terrain.push('    ' + JSON.stringify(f) + ',');
  });
  if (rough === data.terrain.length) terrain.push('    // 起伏ここまで');
  terrain.push('  ]');
  const text = JSON.stringify({...data, terrain:null}, null, 2).replace('"terrain": null', terrain.join('\n'))
    .replace(/\[\n([^\[\]{}]+)\n\s*\]/g, (all, values) => {
      try {return JSON.stringify(JSON.parse('[' + values + ']'));} catch {return all;}
    });
  return '// tools/generate_map.js の出力。個別に編集せずシードと設定から再生成する。\n' +
    `(window.MAP_DATA = window.MAP_DATA || {}).${id} = ` + text + ';\n';
}

function save(id, data, file) {fs.writeFileSync(file, serialize(id, data));}
function facilitiesPass(log) {
  const visibility=[...log.matchAll(/か所中 (\d+)か所から見える/g)].map(match=>Number(match[1]));
  return !log.includes('★') && log.includes('ページのエラー 0') && visibility.length>=2 && visibility.every(count=>count===0);
}
module.exports = {random, geometry, placements, diversity, selectDiverse, serialize, save, facilitiesPass};
