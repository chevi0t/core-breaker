// 壊せる建物（2026-11-05、オーナー選択「印を付けた物だけ」）。layout の7番目に印（true か耐久）を付けた建物だけが耐久を持ち、
// 爆風は威力そのまま、弾と近接は 1/4 だけ効く。壊れると足場と当たり判定が消えて沈み、瓦礫が残る。次の試合で元に戻る。
// 印は試験の中で mesa の layout に足す（マップのデータは変えない）。
// node tools/test/destructible_building_check.js [dbg] [出力フォルダ]
const { check } = require('./lib');
check('壊せる建物', async ({ ev, step, ok, sortie }) => {
  await ev(() => {
    const L = __g.MAPS.mesa.layout;
    window.__plain = L.length;
    L.push([0, 40, 8, 8, 6, 'house', true], [24, 70, 6, 6, 5, null, 20000]);
    __g.buildMap('mesa'); // 読み込み時に作った mesa を、印を足した layout で作り直す
  });
  await sortie('mesa');
  const a = await ev(() => {
    const B = __g.buildings, b = B[0];
    return { n: B.length, hp: B.map(x => x.maxHp), house: b.parts.length, hit: __g.hittables.includes(b.box) && b.box.userData.ref === b,
      ob: __g.obstacles.includes(b.ob), plain: __g.MAPS.mesa.layout.length - 2 === window.__plain,
      roofUp: __g.groundAt(b.pos.x, b.pos.z, 100) - __g.terrainH(b.pos.x, b.pos.z) };
  });
  ok(a.n === 4, `印の付いた2つが点対称に置かれ、壊せる建物は${a.n}つ（印の無い箱は入らない）`);
  ok(a.hp[0] === 15400 && a.hp[2] === 20000, `耐久は体積から ${a.hp[0]}、数で書いた物は ${a.hp[2]}`);
  ok(a.house >= 2, `家は屋根も建物の部品（${a.house}個）`);
  ok(a.hit && a.ob, '壊れる前は弾が当たり、足場と壁になる');
  ok(a.roofUp > 5, `屋上に乗れる（地面から${a.roofUp.toFixed(1)}m）`);

  const d = await ev(() => {
    const b = __g.buildings[0], e = __g.units.find(u => u.team !== __g.player.team), out = {};
    let hp = b.hp; __g.damage(b, e, 1000); out.shot = hp - b.hp;
    hp = b.hp; __g.blast({ owner: e, team: e.team, weaponName: '試験', spec: { dmg: 4000, blast: 10 } }, new __g.T.Vector3(b.ob.maxX + 0.5, b.ground + 2, b.pos.z), null); out.blast = hp - b.hp;
    return out;
  });
  ok(d.shot === 250, `弾1000のダメージは${d.shot}だけ効く（1/4）`);
  ok(d.blast > 3500 && d.blast <= 4000, `近くの爆風4000は${Math.round(d.blast)}効く`);

  const k = await ev(() => {
    const b = __g.buildings[0], e = __g.units.find(u => u.team !== __g.player.team);
    __g.blast({ owner: e, team: e.team, weaponName: '試験', spec: { dmg: 20000, blast: 10 } }, new __g.T.Vector3(b.ob.maxX + 0.5, b.ground + 2, b.pos.z), null);
    return { alive: b.alive, hit: __g.hittables.includes(b.box), ob: __g.obstacles.includes(b.ob), ref: b.box.userData.ref, rubble: !!b.rubble && b.rubble.children.length,
      ground: __g.groundAt(b.pos.x, b.pos.z, 100) - __g.terrainH(b.pos.x, b.pos.z), other: __g.buildings[1].alive,
      feed: document.getElementById('feed')?.textContent.includes('建物を破壊') };
  });
  ok(!k.alive && !k.hit && !k.ob && !k.ref, '耐久が尽きると弾も足場も消える');
  ok(k.ground < 0.1, '崩れた所は地面の高さを歩ける');
  ok(k.rubble >= 6, `瓦礫が${k.rubble}個残る`);
  ok(k.other, '点対称の相手側の建物は壊れない');
  ok(k.feed, '撃破ログに「建物を破壊」');

  const mid = await ev(() => { const b = __g.buildings[0]; return b.parts[0].position.y - b.home[0].y; });
  await step(10);
  const fall = await ev(() => { const b = __g.buildings[0]; return { y: b.parts[0].position.y - b.home[0].y, on: !!b.parts[0].parent }; });
  await step(30);
  const done = await ev(() => { const b = __g.buildings[0]; return { on: b.parts.some(m => m.parent), rubble: !!b.rubble.parent }; });
  ok(mid === 0 && fall.y < -1 && fall.on, `崩れながら沈む（0.5秒で${fall.y.toFixed(1)}m）`);
  ok(!done.on && done.rubble, '沈み切ると建物は消え、瓦礫は残る');

  // 近接も 1/4
  const m = await ev(() => { const b = __g.buildings[1], e = __g.units.find(u => u.team !== __g.player.team), hp = b.hp; __g.damage(b, e, 4000, false, true); return hp - b.hp; });
  ok(m === 1000, `近接4000は${m}だけ効く`);

  // 次の試合で元に戻る
  const r = await ev(() => {
    __g.resetBuildings();
    const b = __g.buildings[0];
    return { alive: b.alive, hp: b.hp === b.maxHp, hit: __g.hittables.includes(b.box) && b.box.userData.ref === b, ob: __g.obstacles.includes(b.ob),
      parts: b.parts.every((m, i) => m.parent && m.position.equals(b.home[i])), rubble: b.rubble, mat: !b.mats && !Array.isArray(b.box.material) && b.box.material === b.orig,
      other: __g.buildings[1].hp === __g.buildings[1].maxHp };
  });
  ok(r.alive && r.hp && r.hit && r.ob && r.parts && r.rubble === null && r.mat && r.other, '試合をやり直すと建物も耐久も元に戻る');

  // 出撃し直しても（マップの作り直し）同じ数
  const again = await ev(() => { __g.buildMap('mesa'); return __g.buildings.length; });
  ok(again === 4, `マップを作り直しても壊せる建物は${again}つ（前の分が残らない）`);
});
