// 脚の種類ごとの釣り合いを Bot 戦で比べる（#228）。試験ではなく計測。 node tools/test/legs_balance.js [dbg] [出力] [マップ=wide,city] [秒=240]
// 同じ上半身（標準）・同じ武器（兵装の初期装備）で、脚だけ 二脚（standard）・ホバー（skimmer）・四脚（dozer）・逆脚（hopper）に変えた Bot を
// 両軍に同じ数だけ入れ（番号 0〜7：強襲4機と重火力4機に4種類ずつ。8番以降は数えない）、生存時間・与ダメージ・撃破・被撃破を1機あたりで比べる。
const fs = require('node:fs'), path = require('node:path');
const { check } = require('./lib');
const maps = (process.argv[4] || 'wide,city').split(','), secs = +(process.argv[5] || 240), LEGS = ['standard', 'skimmer', 'dozer', 'hopper'];
check('脚ごとの Bot 戦', async ({ ev, ok, sortie, page, dir, out }) => {
  const total = Object.fromEntries(LEGS.map(k => [k, { n: 0, life: 0, dmg: 0, kills: 0, deaths: 0, braceT: 0 }])), perMap = {};
  for (const map of maps) {
    await page.goto('file://' + path.join(dir, 'dbg.html')); await sortie(map);
    await ev(LEGS => {
      const g = __g, T = g.T; g.player.isPlayer = false;
      window.__lb = { rows: new Map(), seen: new Map() };
      for (const u of g.units) {
        if (u.idx > 7) continue;
        u.mech = { ...g.MECH_DEFAULT, legs: LEGS[u.idx % 4] }; u.cls = u.idx < 4 ? 'assault' : 'heavy'; u.nextCls = null; u.actionId = 'crouch';
        u.controlLoadout = { ...g.CLASSES[u.cls] }; for (const k of Object.keys(u.controlLoadout)) if (!g.SLOTS.includes(k)) delete u.controlLoadout[k];
        // 形も脚に合わせて作り直す（被弾の形が脚で変わるため）
        const old = new Set(); u.group.traverse(o => old.add(o));
        for (let i = g.hittables.length - 1; i >= 0; i--) if (old.has(g.hittables[i])) g.hittables.splice(i, 1);
        g.scene.remove(u.group); g.disposeMech(u.group);
        const m = g.buildMech(g.TEAM[u.team].color, u.mech); g.scene.add(m.g); m.g.rotation.order = 'YXZ';
        Object.assign(u, { group: m.g, gun: m.gun, gun2: m.gun2, flame: m.flame, blade: m.blade, pack: m.pack, mount: m.mount, armorMat: m.armor, rig: m.rig, hoverJet: m.hoverJet });
        m.g.traverse(o => { if (o.isMesh && !o.userData.visualOnly) { o.userData.ref = u; g.hittables.push(o); } });
        g.spawn(u, 'base');
        __lb.rows.set(u, { legs: u.mech.legs, kind: u.stats.P.legs.kind || 'biped', cls: u.cls, life: 0, dmg: 0, braceT: 0 });
      }
    }, LEGS);
    const frames = Math.round(secs / .05);
    for (let done = 0; done < frames; done += 400) await ev(n => {
      const g = __g, L = __lb;
      for (let i = 0; i < n; i++) {
        g.loop(window.__t = (window.__t || 0) + 50);
        for (const [u, row] of L.rows) { if (u.alive && !(u.downT > 0)) row.life += .05; if (g.legBraced(u)) row.braceT += .05; }
        // 与ダメージ：受けた側の dmgBy（誰からいくら）の増えた分を足す
        for (const v of g.units) for (const [by, amount] of v.dmgBy) {
          let m = L.seen.get(v); if (!m) L.seen.set(v, m = new Map());
          const was = m.get(by) || 0; if (amount > was && L.rows.has(by)) L.rows.get(by).dmg += amount - was; m.set(by, amount);
        }
        for (const [v, m] of L.seen) for (const by of [...m.keys()]) if (!v.dmgBy.has(by)) m.delete(by);
      }
    }, Math.min(400, frames - done));
    const rows = await ev(() => [...__lb.rows].map(([u, r]) => ({ ...r, kills: u.sc.kills, deaths: u.sc.deaths, cls: u.cls, legsNow: u.mech.legs })));
    ok(rows.length >= 8 && rows.every(r => r.legs === r.legsNow && ['assault', 'heavy'].includes(r.cls)), `${map}：${rows.length}機が指定の脚と兵装で戦った`);
    perMap[map] = {};
    for (const k of LEGS) {
      const rs = rows.filter(r => r.legs === k), t = total[k], m = perMap[map][k] = { n: rs.length, life: 0, dmg: 0, kills: 0, deaths: 0, braceT: 0 };
      for (const r of rs) for (const f of ['life', 'dmg', 'kills', 'deaths', 'braceT']) { m[f] += r[f]; t[f] += r[f]; }
      t.n += rs.length;
    }
  }
  // 1機あたり。生存時間は「1回の出撃で生きていた秒」（生きていた秒 ÷ (被撃破+1)）
  const view = t => ({ n: t.n, life: t.life / (t.deaths + t.n), dmg: t.dmg / t.n, kills: t.kills / t.n, deaths: t.deaths / t.n, brace: t.braceT / t.n });
  const V = Object.fromEntries(LEGS.map(k => [k, view(total[k])])), b = V.standard, names = { standard: '二脚（ハウンド）', skimmer: 'ホバー（スキマー）', dozer: '四脚（ドーザー）', hopper: '逆脚（ホッパー）' };
  const cell = (v, base, d = 1) => `${v.toFixed(d)}（×${(v / base).toFixed(2)}）`;
  const md = [`マップ ${maps.join('・')}、各 ${secs} 秒。1機あたり（二脚との比）`, '', '| 脚 | 機数 | 1出撃の生存時間（秒） | 与ダメージ | 撃破 | 被撃破 | 踏ん張った秒 |', '|---|---:|---:|---:|---:|---:|---:|',
    ...LEGS.map(k => `| ${names[k]} | ${V[k].n} | ${cell(V[k].life, b.life)} | ${cell(V[k].dmg, b.dmg, 0)} | ${cell(V[k].kills, b.kills, 2)} | ${cell(V[k].deaths, b.deaths, 2)} | ${V[k].brace.toFixed(1)} |`)].join('\n');
  console.log(md);
  fs.writeFileSync(path.join(out, 'legs-balance.json'), JSON.stringify({ maps, secs, total, perMap, view: V }, null, 2) + '\n'); fs.writeFileSync(path.join(out, 'legs-balance.md'), md + '\n');
}, { errorsOk: /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/ });
