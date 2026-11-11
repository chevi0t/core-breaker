// 四脚ドーザー・逆脚ホッパー（#227 で定義、#228 でゲームに入れた）の表の確かめ。ブラウザ不要。 node tools/test/legs_table_check.js
// 遊べる所（PARTS・PART_SERIES）に入っていること、頭・胴・腕・脚の各4型、脚の Ⅱ〜Ⅳ型が Ⅰ型の ±10% に収まること、頭・胴・腕がアーケード版の原表からの換算どおりであること、名前とキーが今ある物と重ならないこと、
// セットボーナスの形を見る。動きは legs_kinds_check.js。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '../..'), src = fs.readFileSync(path.join(ROOT, 'prototype/parts.js'), 'utf8');
const t = new Function(src + ';return partTables();')();
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { PARTS, PART_SLOTS, PART_SERIES, HOVER_PART_FIELDS, HOVER_PART_BASE, LEG_SERIES, LEG_KIND_TRAITS, MAKERS } = t;
const FIELDS = { head: ['weight', 'armor', 'lock', 'aim'], body: ['weight', 'armor', 'boost', 'sp', 'supply'], arms: ['weight', 'armor', 'reload', 'swap', 'recoil', 'ammo'], legs: ['weight', 'armor', 'walk', 'dash', 'cruise', 'cap'] };
ok(Object.keys(LEG_SERIES).length === 2, 'シリーズは2つ');
const count = (list, v) => list.filter(x => x === v).length, models = Object.values(PARTS).flatMap(ps => Object.values(ps).map(p => p.model)), seriesNames = Object.values(PART_SERIES).map(s => s.name);
for (const [id, ps] of Object.entries(LEG_SERIES)) {
  ok(PART_SERIES[id]?.kind === ps.kind && !PART_SERIES[id].profile && count(seriesNames, ps.name) === 1, id + '：PART_SERIES に入り、名前が重ならない');
  ok(!!MAKERS[ps.maker] && !!LEG_KIND_TRAITS[ps.kind], id + '：メーカーと脚の種類');
  ok(ps.types.length === 4 && typeof ps.set.text === 'string', id + '：4型とセットボーナス');
  for (const [slot, field, op, v] of ps.set.fx) ok(FIELDS[slot]?.includes(field) && ['mul', 'add'].includes(op) && Number.isFinite(v), `${id}：セットボーナス ${slot}.${field}`);
  for (const slot of PART_SLOTS) {
    const base = PARTS[slot][ps.types[0]];
    for (const k of ps.types) {
      const p = PARTS[slot][k];
      ok(!!p && p.series === id && count(models, p.model) === 4 && !p.wip, `${slot}.${k}：遊べる所の表にあり、名前が重ならない`);
      for (const f of FIELDS[slot]) ok(p[f] > 0, `${slot}.${k}.${f} は正の数`);
      if (slot !== 'legs') {
        ok(!p.kind && !p.traits, `${slot}.${k}：特別な動きは脚だけ`);
        const row = ps.ac[slot][ps.types.indexOf(k)], std = PARTS[slot].standard;
        HOVER_PART_FIELDS[slot].forEach((f, j) => ok(Math.abs(p[f] - std[f] * row[j] / HOVER_PART_BASE[slot][j]) <= (f === 'weight' ? 0.5 : 0.051), `${slot}.${k}.${f} は原表からの換算どおり`));
        if (slot === 'body') ok(p.sp === std.sp, `${slot}.${k}.sp は標準のまま`);
        continue;
      }
      for (const f of FIELDS[slot]) ok(Math.abs(p[f] / base[f] - 1) <= 0.1001, `${slot}.${k}.${f} は Ⅰ型の ±10%`);
      ok(p.kind === ps.kind, k + '：脚の種類');
      for (const f of ['spread', 'recoil', 'stagger', 'hoverCost', 'jump', 'landSpeed', 'landTime', 'plantTime']) ok(typeof p.traits[f] === 'number' && p.traits[f] > 0, `${k}.traits.${f}`);
      ok(['brace', 'charge'].includes(p.traits.crouch.type) && !!p.traits.action.tackle && !!p.traits.action.kick, k + '：しゃがみとアクションの倍率');
    }
  }
}
const W = PARTS, sum = (tbl, k) => PART_SLOTS.reduce((s, slot) => s + tbl[slot][k].weight, 0);
ok(W.legs.dozer.walk < PARTS.legs.heavy.walk && W.legs.dozer.dash < PARTS.legs.heavy.dash && W.legs.dozer.cap > PARTS.legs.heavy.cap, '四脚は重装二脚より遅く、積める');
ok(W.legs.hopper.walk < PARTS.legs.light.walk && W.legs.hopper.dash < PARTS.legs.light.dash && W.legs.hopper.cap > PARTS.legs.light.cap && W.legs.hopper.traits.jump > 1, '逆脚は軽量二脚より横に遅く、高く跳ぶ');
ok(W.head.dozer.armor < 1 && W.body.dozer.armor < 1 && W.arms.dozer.armor < 1 && W.arms.dozer.ammo > 1, 'ドーザーの上半身：標準より硬く、弾が多い');
ok(W.head.hopper.armor > 1 && W.body.hopper.armor > 1 && W.head.hopper.aim > 1 && W.arms.hopper.reload < 1, 'ホッパーの上半身：標準より薄く、射撃補正とリロードが良い');
for (const k of ['dozer', 'hopper']) ok(sum(W, k) - W.legs[k].weight < W.legs[k].cap, k + '：脚が自分の上半身を載せられる');
console.log(`四脚・逆脚の表：${n}項目 成功`);
