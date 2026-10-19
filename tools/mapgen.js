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
  const west = integer(-86, -80), east = integer(68, 74), deck = integer(12, 14), pad = integer(60, 68);
  const terrain = [], layout = [];
  for (const sign of [1, -1]) {
    terrain.push({type:'block', x:west, z:sign * pad, hx:17, hz:18, h:deck, slope:2.5});
    terrain.push({type:'ramp', x0:west - 13, x1:west + 13, z0:sign * (pad + 18), z1:sign * (pad + 90), h:deck});
    // ポッドは三方の土手と窪地に隠し、ベース側だけ開ける。
    terrain.push({type:'block', x:0, z:sign * 141, hx:18, hz:3, h:5, slope:2.5});
    for (const x of [-21, 21]) terrain.push({type:'block', x, z:sign * 151, hx:3, hz:10, h:5, slope:2.5});
    terrain.push({type:'trench', x:0, z0:sign * 147, z1:sign * 158, w:12, slope:3, h:-2});
  }
  terrain.push({type:'block',x:east,z:0,hx:18,hz:22,h:deck,slope:2.5});
  for (const sign of [1,-1]) terrain.push({type:'ramp',x0:east-12,x1:east+12,z0:sign*22,z1:sign*100,h:deck});
  // 貯水区画は片側だけ。通り道・再出撃位置から外し、段差は歩ける傾斜にする。
  terrain.push({type:'trench', x:126, z0:24, z1:86, w:10, slope:12, h:-5});
  for (const [x, z, w, d, h] of [
    [-36, 46, 16, 20, 11], [34, -46, 18, 22, 9],
    [35, 96, 14, 16, 7], [-35, -103, 12, 14, 12],
    [-128, -20, 12, 28, 6], [113, -66, 12, 20, 5],
    [27, 25, 7, 7, 14], [-44, -10, 7, 7, 10],
  ]) layout.push([x, z, w, d, h]);
  const d = {
    order:5, name:'白煙循環区', subtitle:'検証中', asym:true,
    size:[150, 240], team:5, time:300, baseZ:210, baseLine:165,
    desc:'停止した熱交換施設。西の保守高架と東の冷却塔広場へ、ジャンプパッド・リフト・長い坂から進む。',
    terrain, layout,
    plants:[['A', 0, 120, 'B'], ['Z', 0, -120, 'R']],
    turrets:[[-33, 177], [33, 177]], radar:[-50, 220],
    catapults:[[-62, 190, -116, 104], [62, 190, 108, 100], [-100, 190, west, 158], [100, 190, 110, 120]],
    basePods:[[-21, 190], [21, 190]], plantPods:[['A', 0, 153], ['Z', 0, -153]],
    barricades:[], bridges:[[west, 0, 28, pad * 2 - 20, deck, 1.5]],
    water:[[126, 55, 10, 31, -4.7]],
    jumpPads:[...[-1,1].map(s=>({at:[west+25,s*pad,0],exit:[west+10,s*pad,deck],rise:30})),
      {at:[east-25,0,0],exit:[east-12,0,deck],rise:30}],
    // 上端の台は崖の外へ接岸し、台の幅で高所の床につなぐ。
    lifts:[...[-1,1].map(s=>({from:[west-30,s*pad,0],to:[west-21,s*pad,deck],size:[8,8],speed:5,wait:2})),
      {from:[east+31,0,0],to:[east+22,0,deck],size:[8,8],speed:5,wait:2}],
    paved:[[-20, 20, -138, 138], [west - 36, west + 38, -165, 165], [east - 38, east + 37, -138, 138],
      [-115, 105, -116, -94], [-115, 105, -18, 18], [-115, 105, 94, 116], [-30, 30, 112, 165], [-30, 30, -165, -112]],
    generation:{version:2, seed, west, east, deck, pad, balance:'勝率未確定'},
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
    // 全戦場で昇降設備の先に争奪目標を置く。
    if (!elevated) continue;
    const spread = Math.max(...selected.map(p => p.x)) - Math.min(...selected.map(p => p.x));
    const metrics = {plants:plants.length, elevated, spread, offCenter:selected.filter(p => Math.abs(p.x) > 40).length};
    const bothSides=selected.some(p=>p.y>=5 && p.x<0) && selected.some(p=>p.y>=5 && p.x>0);
    const name = plants.length === 3 ? '昇降交差' : bothSides ? '高架縦断' : '片翼争奪';
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

// 共通の地形を固定し、戦場の構造ごとに中立の壊せる遮蔽を試す。
// 配置円・再出撃位置・昇降口を塞がず、短い壁の両端に徒歩経路を残す。
function routeCover(choice, revision='reviewed250') {
  if(['baseline','reviewed250'].includes(revision)) return {barricades:[]};
  if(!['cover1','cover2','repair3','reviewed250'].includes(revision)) throw new Error('修正案は baseline / cover1 / cover2 / repair3 / reviewed250 を指定してください');
  if(choice.metrics.plants===3) return {barricades:revision==='cover1'
    ?[[-24,172,2,18,4.5],[24,172,2,18,4.5]]
    :[[-45,158,12,2,4.5],[45,158,12,2,4.5]]};
  if(choice.metrics.offCenter===choice.metrics.elevated && choice.metrics.spread>100) return {barricades:[]};
  if(revision==='repair3'){
    // 低耐久Botが選べるポッドは90m以内。中央の実測大破地点から届く建物裏に置く。
    // 所有権は既存の地上中央プラントに従い、敵軍も奪えば利用できる。
    const relay=choice.plants.slice(1,-1).find(p=>p[1]===0&&p[2]===60);
    if(!relay) return {barricades:[]};
    return {barricades:[],plantPods:[...choice.plantPods,[relay[0],38,-27]]};
  }
  // 中央から北へ進む区間。中央通路を閉じず、南側へ射線を切って戻れる位置。
  return {barricades:revision==='cover1'
    ?[[-9,-24,14,2,4.5],[9,-79,14,2,4.5]]
    :[[-18,-38,2,18,4.5],[24,-90,2,18,4.5]]};
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
function facilitiesPass(log, requiredPodIds=null) {
  const visibility=[...log.matchAll(/か所中 (\d+)か所から見える/g)].map(match=>Number(match[1]));
  if(requiredPodIds){
    const pods=new Map([...log.matchAll(/ポッド(?: プラント)?([A-Z]+)[^\n]*?か所中 (\d+)か所から見える/g)].map(m=>[m[1],Number(m[2])]));
    // 敵陣から完全に隠す要件は両端のポッド。中央は視認数を報告し、★は全施設で禁止。
    return !log.includes('★')&&log.includes('ページのエラー 0')&&requiredPodIds.length>=2&&requiredPodIds.every(id=>pods.get(id)===0);
  }
  return !log.includes('★') && log.includes('ページのエラー 0') && visibility.length>=2 && visibility.every(count=>count===0);
}
module.exports = {random, geometry, placements, diversity, selectDiverse, routeCover, serialize, save, facilitiesPass};
