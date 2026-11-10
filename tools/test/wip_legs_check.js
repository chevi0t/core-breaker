// 準備中の脚（四脚・逆脚、#227）の表の確かめ。ブラウザ不要。 node tools/test/wip_legs_check.js
// 遊べる所（PARTS.legs・PART_SERIES）に出ていないこと、各4型、Ⅱ〜Ⅳ型が Ⅰ型の ±10% に収まること、名前とキーが今ある物と重ならないことを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../../prototype/parts.js'), 'utf8');
const t = new Function(src + ';return partTables();')();
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { PARTS, PART_SERIES, WIP_LEGS, WIP_LEG_SERIES, LEG_KIND_TRAITS, MAKERS } = t;
ok(Object.keys(WIP_LEG_SERIES).length === 2, 'シリーズは2つ');
const models = new Set(Object.values(PARTS).flatMap(ps => Object.values(ps).map(p => p.model))), seriesNames = new Set(Object.values(PART_SERIES).map(s => s.name));
for (const [id, ps] of Object.entries(WIP_LEG_SERIES)) {
  ok(!PART_SERIES[id] && !seriesNames.has(ps.name), id + '：今あるシリーズと重ならない');
  ok(!!MAKERS[ps.maker] && !!LEG_KIND_TRAITS[ps.kind], id + '：メーカーと脚の種類');
  const keys = Object.keys(ps.types); ok(keys.length === 4, id + '：4型');
  const base = WIP_LEGS[keys[0]];
  for (const k of keys) {
    const p = WIP_LEGS[k];
    ok(!Object.hasOwn(PARTS.legs, k) && !PARTS.head[k], k + '：遊べる所の表に無い');
    ok(p.wip === true && p.kind === ps.kind && p.series === id && !models.has(p.model), k + '：印と名前');
    for (const f of ['weight', 'armor', 'walk', 'dash', 'cruise', 'cap']) ok(p[f] > 0 && Math.abs(p[f] / base[f] - 1) <= 0.1001, `${k}.${f} は Ⅰ型の ±10%`);
    for (const f of ['spread', 'recoil', 'stagger', 'hoverCost', 'jump', 'landSpeed', 'landTime', 'plantTime']) ok(typeof p.traits[f] === 'number' && p.traits[f] > 0, `${k}.traits.${f}`);
    ok(['brace', 'charge'].includes(p.traits.crouch.type) && !!p.traits.action.tackle && !!p.traits.action.kick, k + '：しゃがみとアクションの倍率');
  }
}
const q = WIP_LEGS.dozer, r = WIP_LEGS.hopper, heavy = PARTS.legs.heavy, light = PARTS.legs.light;
ok(q.walk < heavy.walk && q.dash < heavy.dash && q.cap > heavy.cap, '四脚は重装二脚より遅く、積める');
ok(r.walk < light.walk && r.dash < light.dash && r.cap > light.cap && r.traits.jump > 1, '逆脚は軽量二脚より横に遅く、高く跳ぶ');
console.log(`準備中の脚：${n}項目 成功`);
