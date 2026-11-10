// 準備中の機体（四脚ドーザー・逆脚ホッパー、#227）の表の確かめ。ブラウザ不要。 node tools/test/wip_legs_check.js
// 遊べる所（PARTS・PART_SERIES）に出ていないこと、頭・胴・腕・脚の各4型、Ⅱ〜Ⅳ型が Ⅰ型の ±10% に収まること、名前とキーが今ある物と重ならないこと、
// セットボーナスの形、形の定義（media/legs-proto/）が読めることを見る。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '../..'), src = fs.readFileSync(path.join(ROOT, 'prototype/parts.js'), 'utf8');
const t = new Function(src + ';return partTables();')();
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { PARTS, PART_SLOTS, PART_SERIES, WIP_PARTS, WIP_LEGS, WIP_SERIES, LEG_KIND_TRAITS, MAKERS } = t;
const FIELDS = { head: ['weight', 'armor', 'lock', 'aim'], body: ['weight', 'armor', 'boost', 'sp', 'supply'], arms: ['weight', 'armor', 'reload', 'swap', 'recoil', 'ammo'], legs: ['weight', 'armor', 'walk', 'dash', 'cruise', 'cap'] };
ok(Object.keys(WIP_SERIES).length === 2 && WIP_LEGS === WIP_PARTS.legs, 'シリーズは2つ');
const models = new Set(Object.values(PARTS).flatMap(ps => Object.values(ps).map(p => p.model))), seriesNames = new Set(Object.values(PART_SERIES).map(s => s.name));
const BODY = require(path.join(ROOT, 'media/legs-proto/body_shapes.js')), LEG = require(path.join(ROOT, 'media/legs-proto/leg_shapes.js'));
for (const [id, ps] of Object.entries(WIP_SERIES)) {
  ok(!PART_SERIES[id] && !seriesNames.has(ps.name), id + '：今あるシリーズと重ならない');
  ok(!!MAKERS[ps.maker] && !!LEG_KIND_TRAITS[ps.kind], id + '：メーカーと脚の種類');
  ok(ps.types.length === 4 && typeof ps.set.text === 'string', id + '：4型とセットボーナス');
  for (const [slot, field, op, v] of ps.set.fx) ok(FIELDS[slot]?.includes(field) && ['mul', 'add'].includes(op) && Number.isFinite(v), `${id}：セットボーナス ${slot}.${field}`);
  ok(['head', 'chest', 'shoulder'].every(f => typeof BODY[id][f] === 'function') && Object.keys(BODY[id].silhouette).length === 8 && typeof LEG[ps.kind] === 'function', id + '：形の定義');
  for (const slot of PART_SLOTS) {
    const base = WIP_PARTS[slot][ps.types[0]];
    for (const k of ps.types) {
      const p = WIP_PARTS[slot][k];
      ok(!Object.hasOwn(PARTS[slot], k), `${slot}.${k}：遊べる所の表に無い`);
      ok(p.wip === true && p.series === id && !models.has(p.model), `${slot}.${k}：印と名前`);
      for (const f of FIELDS[slot]) ok(p[f] > 0 && Math.abs(p[f] / base[f] - 1) <= 0.1001, `${slot}.${k}.${f} は Ⅰ型の ±10%`);
      if (slot !== 'legs') { ok(!p.kind && !p.traits, `${slot}.${k}：特別な動きは脚だけ`); continue; }
      ok(p.kind === ps.kind, k + '：脚の種類');
      for (const f of ['spread', 'recoil', 'stagger', 'hoverCost', 'jump', 'landSpeed', 'landTime', 'plantTime']) ok(typeof p.traits[f] === 'number' && p.traits[f] > 0, `${k}.traits.${f}`);
      ok(['brace', 'charge'].includes(p.traits.crouch.type) && !!p.traits.action.tackle && !!p.traits.action.kick, k + '：しゃがみとアクションの倍率');
    }
  }
}
const W = WIP_PARTS, sum = (tbl, k) => PART_SLOTS.reduce((s, slot) => s + tbl[slot][k].weight, 0);
ok(W.legs.dozer.walk < PARTS.legs.heavy.walk && W.legs.dozer.dash < PARTS.legs.heavy.dash && W.legs.dozer.cap > PARTS.legs.heavy.cap, '四脚は重装二脚より遅く、積める');
ok(W.legs.hopper.walk < PARTS.legs.light.walk && W.legs.hopper.dash < PARTS.legs.light.dash && W.legs.hopper.cap > PARTS.legs.light.cap && W.legs.hopper.traits.jump > 1, '逆脚は軽量二脚より横に遅く、高く跳ぶ');
ok(sum(W, 'dozer') > sum(PARTS, 'heavy') && sum(W, 'hopper') < sum(PARTS, 'light'), '全身の重さ：ドーザーは重装より重く、ホッパーは軽量より軽い');
ok(W.arms.dozer.recoil > PARTS.arms.heavy.recoil && W.body.dozer.boost < PARTS.body.heavy.boost, 'ドーザー：反動に強く、ブーストは少ない');
ok(W.body.hopper.boost > PARTS.body.light.boost && W.head.hopper.armor > PARTS.head.light.armor, 'ホッパー：ブーストが多く、薄い');
console.log(`準備中の機体：${n}項目 成功`);
