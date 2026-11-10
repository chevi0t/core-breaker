// ロックオン中のズーム（2026-11-11、オーナー「フルオートじゃない単発武器の倍率1.5倍にして」「スコープ付きじゃないやつね」
// 「ショットガンは1.3倍でいいや」）。
//  - 単発（semi）で、スコープが無く散弾でもない銃を持ってロックしている間は 1.5倍。
//    単発の散弾銃・連射・3点射・溜め撃ち・ガトリング・近接武器・スタンガンは 1.3倍。
//  - ロックしていなければズームしない。持ち替えると画角も変わる。スコープ付きの単発（狙撃銃）は 1.3倍の側。
// node tools/test/lock_zoom_check.js [dbg]
const { check } = require('./lib');
check('ロックオン中のズーム', async ({ ev, ok, sortie }) => {
  await sortie('dock');
  const r = await ev(() => {
    const g = __g, u = g.player, e = g.units.find(q => q.team !== u.team), F = 70;
    g.gameOptions.fov = F;
    Object.assign(u, { alive: true, weapon: 'main', switchT: 0, scoped: false, seekMode: false, dashState: '' });
    // dt を大きくして、画角を目標まで一度に寄せる
    const fovWith = (key, slot = 'main', locked = true) => {
      u.slots[slot] = g.slotOf(key); u.weapon = slot;
      Object.assign(g.lock, { target: locked ? e : null, visible: locked });
      g.camera.fov = F; g.updateCamera(u, 10);
      return g.camera.fov;
    };
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const mode = w => w.type !== 'gun' ? w.type : w.scope ? 'scope' : w.semi ? (w.pellets ? 'semiShot' : 'semi') : w.burst ? 'burst' : w.chargeTime ? 'charge' : w.spin ? 'spin' : 'auto';
    const mains = [...new Set(g.CLASS_KEYS.flatMap(c => g.ARMORY[c].main))], by = {}, bad = [];
    for (const k of mains) {
      const w = g.WEAPONS[k], m = mode(w), want = m === 'semi' ? 1.5 : 1.3, got = F / fovWith(k);
      (by[m] ||= []).push(w.name);
      if (!near(got, want)) bad.push(`${w.name}（${m}）が ${got.toFixed(3)}倍`);
      if (!near(fovWith(k, 'main', false), F)) bad.push(`${w.name}：ロックしていないのにズームした`);
    }
    const aux = [...new Set(g.CLASS_KEYS.flatMap(c => g.ARMORY[c].aux))].filter(k => g.WEAPONS[k].type === 'sword' || g.WEAPONS[k].stunField);
    const auxBad = aux.filter(k => !near(F / fovWith(k, 'aux'), 1.3)).map(k => g.WEAPONS[k].name);
    const scoped = Object.keys(g.WEAPONS).filter(k => g.WEAPONS[k].type === 'gun' && g.WEAPONS[k].semi && g.WEAPONS[k].scope);
    const shotNames = (by.semiShot || []).concat(mains.filter(k => g.WEAPONS[k].pellets && mode(g.WEAPONS[k]) !== 'semiShot').map(k => g.WEAPONS[k].name));
    const scopedBad = scoped.filter(k => !near(F / fovWith(k), 1.3)).map(k => g.WEAPONS[k].name);
    // 持ち替え：単発の主武器でロック中に近接武器へ替えると 1.3倍へ戻る
    const semiKey = mains.find(k => mode(g.WEAPONS[k]) === 'semi'), autoKey = mains.find(k => mode(g.WEAPONS[k]) === 'auto');
    const a = F / fovWith(semiKey); u.slots.aux = g.slotOf(aux[0]); u.weapon = 'aux'; g.camera.fov = F; g.updateCamera(u, 10); const b = F / g.camera.fov;
    // 寄り方は今までと同じ速さ（LOCK_ZOOM_RATE）：1コマ（1/60秒）では目標まで行かない
    u.slots.main = g.slotOf(semiKey); u.weapon = 'main'; g.camera.fov = F; g.updateCamera(u, 1 / 60); const step = g.camera.fov;
    Object.assign(g.lock, { target: null, visible: false });
    return { by: Object.fromEntries(Object.entries(by).map(([m, l]) => [m, l.length])), semiNames: by.semi, semiShotNames: by.semiShot || [], shots: shotNames.length, bad, aux: aux.length, auxBad, scoped: scoped.length, scopedBad, swap: [a, b], step, consts: [g.LOCK_ZOOM, g.LOCK_ZOOM_SEMI], semi: g.WEAPONS[semiKey].name, auto: g.WEAPONS[autoKey].name };
  });
  ok(r.consts[0] === 1.3 && r.consts[1] === 1.5, '倍率は 1.3倍と、単発の 1.5倍');
  ok(!r.bad.length && r.by.semi > 0, `主武器の単発${r.by.semi}種は 1.5倍、単発の散弾銃${r.by.semiShot}種・連射${r.by.auto}種・3点射${r.by.burst}種・溜め撃ち${r.by.charge}種・ガトリング${r.by.spin}種は 1.3倍。ロックしていなければズームなし` + (r.bad.length ? '：' + r.bad.slice(0, 5).join('、') : ''));
  ok(['マークスマンライフル', '単射二丁拳銃', 'マグナム'].every(n => r.semiNames.some(x => x.startsWith(n))) && r.semiNames.every(n => !n.includes('散弾')), '1.5倍はマークスマンライフル・単射二丁拳銃・マグナムの各型：' + r.semiNames.join('、'));
  ok(r.semiShotNames.length > 0 && r.shots >= r.semiShotNames.length, `散弾を撃つ主武器${r.shots}種は、単発（${r.semiShotNames.join('、')}）も含めて 1.3倍`);
  ok(r.aux > 0 && !r.auxBad.length, `ロックできる補助装備（近接武器・スタンガン）${r.aux}種は 1.3倍のまま` + (r.auxBad.length ? '：' + r.auxBad.join('、') : ''));
  ok(r.scoped > 0 && !r.scopedBad.length, `スコープ付きの単発${r.scoped}種は 1.5倍にしない`);
  ok(Math.abs(r.swap[0] - 1.5) < 1e-6 && Math.abs(r.swap[1] - 1.3) < 1e-6, `${r.semi}でロック中に近接武器へ持ち替えると 1.5倍から 1.3倍へ戻る`);
  ok(r.step < 70 && r.step > 70 / 1.5 + 1, `寄る速さは今までどおり（1コマ後の画角 ${r.step.toFixed(1)}度、目標 ${(70 / 1.5).toFixed(1)}度）`);
});
