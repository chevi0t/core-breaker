// 背負う特別装備を選んでいる間、手に持つ形は主武器のまま（2026-11-11、オーナー「特殊装備は背中に背負ってもらいたい…機体正面にもバリアのモジュールが出るのは意図しない」）。
//  - 機体カスタマイズの絵は、選んでいる枠の武器を持たせて描く。特別装備の枠を選ぶと、起動するだけの装備（防護バリア・加速装置・光学迷彩など）の背中の装置が手にも出ていた。
//  - 手に持って使う特別装備（リペアユニットなど）は今までどおり手に出る。
// node tools/test/sp_hand_check.js [dbg]
const { check } = require('./lib');
check('背負う特別装備は手に出さない', async ({ ev, ok }) => {
  const r = await ev(() => {
    const g = __g, bad = [], held = [];
    for (const cls of g.CLASS_KEYS) for (const key of g.ARMORY[cls].sp) {
      const m = g.buildMech(0x44aaff, { ...g.MECH_DEFAULT, legs: cls === 'heavy' ? 'dozer' : 'standard' }), ld = { ...g.loadout[cls], sp: key };
      g.weaponLook({ ...m, slots: Object.fromEntries(g.SLOTS.map(k => [k, g.slotOf(ld[k])])), weapon: 'sp', isPlayer: false, recoil: 0, cannonDeploy: 0, swing: null }, 0);
      const type = g.WEAPONS[key].type, back = g.TOGGLE_SP.includes(type) || g.MAP_SP.includes(type) || type === 'cannon' || type === 'beamCannon', inHand = m.gun.userData.weaponId;
      if (back ? inHand !== ld.main : inHand !== key) bad.push([cls, key, inHand]);
      if (!back) held.push(key);
      g.disposeMech(m.g);
    }
    return { bad, held, n: g.CLASS_KEYS.reduce((s, c) => s + g.ARMORY[c].sp.length, 0), barrier: g.WEAPONS.barrier.type };
  });
  ok(r.bad.length === 0, `特別装備 ${r.n} 種：背負う装備は手に主武器、手持ちの装備（${r.held.length} 種）は手にその装備（外れ ${JSON.stringify(r.bad)}）`);
  ok(r.barrier === 'barrier' && r.held.length > 0, '防護バリアは背負う装備の側、手持ちの特別装備も残っている');
});
