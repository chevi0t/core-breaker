// マップの確認：施設の置き場所、プラントのリペアポッドが敵陣側から見えるか、カタパルトの着地点、プラントからの再出撃位置、見た目のスクリーンショット、Botの通り道（nav）。
// 使い方：
//   python3 tools/build_maps.py
//   python3 tools/test/make_dbg.py 作業フォルダ
//   node tools/test/map_check.js 作業フォルダ マップID [--quick]
// --quick はカタパルトとスクリーンショットを飛ばす（ヘッドレスのWebGLは遅い。カタパルトは描画を止めて測るので速い）。
// Playwright と Chromium が要る。結果は文で出し、良し悪しは読む人が決める（数値の目安は prototype/maps/README.md）。
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [dir, mapId, flag] = process.argv.slice(2);
if (!dir || !mapId) { console.log('使い方: node tools/test/map_check.js 作業フォルダ マップID [--quick]'); process.exit(1); }
const quick = flag === '--quick';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  const errs = [];
  p.on('pageerror', e => { errs.push(e.message); console.log('ページのエラー', e.message); });
  await p.route('**fonts.g*/**', r => r.abort());
  await p.goto('file://' + path.resolve(dir, 'dbg.html'));
  await p.waitForTimeout(1500);
  const E = (fn, a) => p.evaluate(fn, a);
  const ok = await E(id => !!__g.MAPS[id], mapId);
  if (!ok) { console.log(`マップ ${mapId} がありません：`, await E(() => Object.keys(__g.MAPS).join(', '))); await b.close(); process.exit(1); }
  await E(id => __g.selectMap(id), mapId);
  await p.click('#start');
  await p.waitForTimeout(300);
  const now = () => E(() => __g.timeLeft);
  async function wait(sec) { const t = await now(); while ((await now()) > t - sec) await p.waitForTimeout(25); }
  // Botは止めてマップの隅へ。1体を的に使う
  await E(() => {
    const g = __g, [mx, mz] = g.curMap.size;
    for (const u of g.units) if (!u.isPlayer) { u.frozen = true; u.pos.set(mx - 8, 0, (u.team === 'B' ? 1 : -1) * (mz - 8)); }
    window.__dummy = g.units.find(u => u.team === 'R');
    window.__hold = null;
    const f = () => { if (__hold && g.player.alive) { g.player.pos.copy(__hold); g.player.vel.set(0, 0, 0); } requestAnimationFrame(f); };
    f();
  });
  console.log(await E(() => {
    const d = __g.curMap; return `■ ${d.name}（${__g.mapId}）：${d.team}対${d.team}、${d.time / 60}分、${d.size[0] * 2}×${d.size[1] * 2}m、ベース z=±${d.baseZ}、境目 z=±${d.baseLine}`;
  }));
  // 1. 施設の置き場所：地面の高さと、障害物に埋まっていないか
  console.log('\n1. 施設（地面の高さ・障害物との重なり）\n' + await E(() => {
    const g = __g, out = [];
    // 施設そのものの箱（プラントの柱・砲台・レーダー、幅3m以下）と橋は数えない
    const inBox = (x, z) => g.obstacles.some(o => o.bottom === undefined && (o.maxX - o.minX > 3.2 || o.maxZ - o.minZ > 3.2) && x > o.minX - 0.5 && x < o.maxX + 0.5 && z > o.minZ - 0.5 && z < o.maxZ + 0.5 && o.top > g.terrainH(x, z) + 0.5);
    const line = (name, x, z) => `  ${name} (${x.toFixed(1)}, ${z.toFixed(1)}) 地面 ${g.terrainH(x, z).toFixed(1)}m${inBox(x, z) ? '　★障害物に埋まっている' : ''}`;
    for (const pl of g.plants) out.push(line(`プラント${pl.id}（最初は${pl.owner || '中立'}）`, pl.pos.x, pl.pos.z));
    for (const pd of g.pods) out.push(line(`ポッド ${pd.plant ? 'プラント' + pd.plant.id : 'ベース'}`, pd.pos.x, pd.pos.z));
    for (const c of g.catapults) out.push(line(`カタパルト ${c.plant ? 'プラント' + c.plant.id : 'ベース'}`, c.pos.x, c.pos.z));
    for (const t of g.turrets) out.push(line('防衛砲台', t.pos.x, t.pos.z));
    for (const r of g.radars) out.push(line('レーダー', r.pos.x, r.pos.z));
    for (const p of g.curMap.jumpPads ? g.jumpPads : []) {
      const floor = g.groundAt(p.pos.x, p.pos.z, p.pos.y);
      out.push(`  ジャンプパッド (${p.pos.x}, ${p.pos.z}, 高さ${p.pos.y}) 射出高${p.rise}m${Math.abs(floor-p.pos.y)>.5 ? '　★踏める床の高さと違う' : ''}`);
    }
    for (const l of g.curMap.lifts ? g.lifts : []) out.push(`  リフト (${l.from.x}, ${l.from.z}, 高さ${l.from.y}) → (${l.to.x}, ${l.to.z}, 高さ${l.to.y})　実走検査は mobility_check.js`);
    return out.join('\n');
  }));
  // 2. プラントのリペアポッドの上の機体が、敵陣側（ポッドより敵ベース寄り）のどこから見えるか。15m格子の目の高さ4.6mから胴と頭を狙う
  console.log('\n2. プラントのポッドが敵陣側から見えるか（自軍側の半分のポッド。15m格子、そのプラントの中心より敵ベース寄りで180m以内）\n' + await E(() => {
    const g = __g, T = g.T, e = __dummy, out = [], [mx, mz] = g.curMap.size;
    const hidden=g.cityBattle?new Set(['B','R'].map(team=>g.plants.slice().sort((a,b)=>a.pos.distanceTo(g.cores[team].pos)-b.pos.distanceTo(g.cores[team].pos))[0]?.id)):null;
    for (const pod of g.pods.filter(pd => pd.plant && (hidden?hidden.has(pd.plant.id):(g.curMap.asym || pd.pos.z > 0)))) {
      e.pos.set(pod.pos.x, g.terrainH(pod.pos.x, pod.pos.z), pod.pos.z); e.group.position.copy(e.pos); e.group.updateMatrixWorld(true);
      let n = 0; const seen = [];
      const side = pod.plant.pos.z >= 0 ? 1 : -1;
      const own=hidden?(pod.plant.pos.distanceTo(g.cores.B.pos)<pod.plant.pos.distanceTo(g.cores.R.pos)?'B':'R'):null;
      const back=own?g.cores[own].pos.clone().sub(pod.plant.pos).setY(0):null;
      const z0=hidden?-mz+5:pod.plant.pos.z,z1=hidden?mz-5:-mz+5;
      for (let x = -mx + 5; x <= mx - 5; x += 15) for (let z = z0; hidden?z<=z1:side*z>=-mz+5; z += hidden?15:-15*side) {
        if (Math.hypot(x - pod.pos.x, z - pod.pos.z) > 180) continue;
        if(hidden&&((x-pod.plant.pos.x)*back.x+(z-pod.plant.pos.z)*back.z>0||!g.cityBattle.free(x,z,g.terrainH(x,z),g.obstacles)))continue;
        n++;
        const eye = new T.Vector3(x, g.terrainH(x, z) + 4.6, z);
        const vis = [2.4, 3.9].some(h => {
          const tp = new T.Vector3(e.pos.x, e.pos.y + h, e.pos.z), dir = tp.clone().sub(eye), d = dir.length();
          const hit = g.castFrom(eye, dir.normalize(), g.player, d + 2);
          return hit && hit.ref === e;
        });
        if (vis) seen.push(`(${x.toFixed(0)}, ${z.toFixed(0)})`);
      }
      out.push(`  ポッド プラント${pod.plant.id} (${pod.pos.x}, ${pod.pos.z})：${n}か所中 ${seen.length}か所から見える${seen.length ? '　' + seen.slice(0, 12).join(' ') + (seen.length > 12 ? ' …' : '') : ''}`);
    }
    return out.join('\n') || '  （自軍側の半分にプラントのポッドが無い）';
  }));
  // 3. プラントからの再出撃位置
  console.log('\n3. プラントからの再出撃位置（20回ずつ）\n' + await E(() => {
    const g = __g, u = g.player, out = [];
    for (const pl of g.plants) {
      const prev = [pl.owner, pl.gauge]; pl.owner = 'B'; pl.gauge = 100;
      const ds = [], zs = [];
      for (let i = 0; i < 20; i++) { g.spawn(u, pl.id); ds.push(Math.hypot(u.pos.x - pl.pos.x, u.pos.z - pl.pos.z)); zs.push(u.pos.z); }
      out.push(`  プラント${pl.id}：中心から ${Math.min(...ds).toFixed(0)}〜${Math.max(...ds).toFixed(0)}m、z ${Math.min(...zs).toFixed(0)}〜${Math.max(...zs).toFixed(0)}（プラントは z=${pl.pos.z}）`);
      [pl.owner, pl.gauge] = prev;
    }
    g.spawn(u, 'base'); u.invulT = 0;
    return out.join('\n');
  }));
  if (!quick) {
    // 4. カタパルト（自軍側の半分の台）：乗って、着地した所と目標の差
    console.log('\n4. カタパルト（自軍側の台。目標はマップに書いた着地点。ゲームと同じ1/60秒刻みで、描画を止めて測る）');
    await E(() => { window.__render = __g.renderer.render; __g.renderer.render = () => {}; window.__dt = 1 / 60; });
    const cats = await E(() => __g.catapults.filter(c => __g.curMap.asym || c.pos.z > 0).map(c => ({ x: c.pos.x, z: c.pos.z, plant: c.plant ? c.plant.id : null, tx: c.land.x, tz: c.land.z })));
    for (const c of cats) {
      // 台の真ん中に置き、着地したコマで止めて位置を取る（前のコマとの間を高さの比で補間する。着地の後に滑った分は数えない）
      const { fl, r } = await E(([c]) => new Promise(res => {
        const g = __g, u = g.player;
        if (c.plant) { const pl = g.plants.find(q => q.id === c.plant); pl.owner = 'B'; pl.gauge = 100; }
        u.flying = false; u.catCd = 0; u.ctrlLockT = 0;
        u.pos.set(c.x, g.terrainH(c.x, c.z) + 0.05, c.z); u.vel.set(0, 0, 0); u.hp = u.maxHp;
        let n = 0, flew = false, prev = null;
        const f = () => {
          n++;
          if (u.flying) flew = true;
          if (flew && !u.flying && u.onGround && prev) {
            const dt = Math.max(0.001, prev.t - g.timeLeft), fall = -(prev.vy - 34 * dt) * dt;
            const k = Math.max(0, Math.min(1, (prev.y - u.pos.y) / Math.max(0.01, fall)));
            return res({ fl: true, r: [prev.x + (u.pos.x - prev.x) * k, prev.z + (u.pos.z - prev.z) * k, u.pos.y] });
          }
          if ((!flew && n > 60) || n > 2000) return res({ fl: flew, r: [u.pos.x, u.pos.z, u.pos.y] });
          prev = { x: u.pos.x, y: u.pos.y, z: u.pos.z, vy: u.vel.y, t: g.timeLeft };
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }), [c]);
      const miss = Math.hypot(r[0] - c.tx, r[1] - c.tz);
      console.log(`  ${c.plant ? 'プラント' + c.plant : 'ベース'}の台 (${c.x}, ${c.z})：${fl ? `着地 (${r[0].toFixed(1)}, ${r[1].toFixed(1)}) 高さ ${r[2].toFixed(1)}m、目標 (${c.tx.toFixed(1)}, ${c.tz.toFixed(1)}) との差 ${miss.toFixed(1)}m${miss > 6 ? '　★ずれが大きい' : ''}` : '★射出されない'}`);
    }
    await E(() => { __g.renderer.render = window.__render; window.__dt = 0; __g.resetPlants(); });
    // 5. 見た目：自軍ベースから前、各プラントの再出撃位置あたり（中心から自軍ベース側へ48m）から見たスクリーンショット
    for (const name of ['base', ...await E(() => __g.plants.map(pl => pl.id))]) {
      await E(name => {
        const g = __g, u = g.player, d = g.curMap;
        let x = g.TEAM.B.baseX||0, z = g.TEAM.B.baseZ - 15;
        if (name !== 'base') { const pl = g.plants.find(q => q.id === name); x = pl.pos.x; z = pl.pos.z + 48; }
        if(g.cityBattle){
          const pl=g.plants.find(p=>p.id===name),owner=pl?.owner;
          if(pl)pl.owner=u.team;
          g.spawn(u,name);if(pl)pl.owner=owner;
        }else {g.spawn(u, 'base');u.pos.set(x, g.terrainH(x, z), z);}
        u.invulT = 0; u.yaw = 0; u.pitch = -0.08; window.__hold = u.pos.clone();
      }, name);
      await wait(0.6);
      const file = path.resolve(dir, `map_${mapId}_${name}.png`);
      await p.screenshot({ path: file });
      console.log('  スクリーンショット', file);
    }
  }
  // 6. Botの通り道（nav があるマップだけ）
  console.log('\n6. Botの通り道（nav）\n' + await E(() => {
    const g = __g, N = g.NAV;
    if (!N) return '  （nav が無い。Botはまっすぐ目標へ向かう）';
    const name = i => i < N.n ? `${i}` : `~${N.flip[i]}`, P = N.pts, out = [];
    out.push(`  節点 ${P.length}（自軍側 ${N.n}）、リンク ${N.links.length}`);
    for (const [i, q] of P.entries()) if (i < N.n && g.obstacles.some(o => o.bottom === undefined && o.top > q.y + 0.6 && q.x > o.minX - 1 && q.x < o.maxX + 1 && q.z > o.minZ - 1 && q.z < o.maxZ + 1)) out.push(`  ★節点 ${i} (${q.x}, ${q.z}) が障害物の中か、1m以内`);
    // リンクの両端がまっすぐ歩けるか（Botは見通せない節点へも向かうが、引っかかる）。敵軍側どうしのリンクは自軍側と同じなので省く
    for (const l of N.links) {
      if (l.a >= N.n && l.b >= N.n) continue;
      const a = P[l.a], b = P[l.b], ab = g.clearPath(a.x, a.z, b.x, b.z, a.y), ba = g.clearPath(b.x, b.z, a.x, a.z, b.y);
      if (!ab || !ba) out.push(`  ★リンク ${name(l.a)}–${name(l.b)}：${!ab && !ba ? '両方向とも' : !ab ? `${name(l.a)}→${name(l.b)} が` : `${name(l.b)}→${name(l.a)} が`}まっすぐ歩けない（障害物か、登れない段差）`);
    }
    // つながり：0番から届かない節点
    const seen = new Set([0]), q = [0];
    while (q.length) { const i = q.pop(); for (const [j] of N.adj[i]) if (!seen.has(j)) { seen.add(j); q.push(j); } }
    const lost = P.map((_, i) => i).filter(i => !seen.has(i));
    out.push(lost.length ? `  ★0番から届かない節点：${lost.map(name).join(', ')}` : '  全部の節点がつながっている');
    // 施設から見通せる節点があるか（Botは目標を見通せる近い節点へ向かう）
    const targets = [...g.plants.map(pl => [`プラント${pl.id}`, pl.pos]), ...g.catapults.filter(c => c.pos.z > 0).map(c => [`カタパルト (${c.pos.x}, ${c.pos.z})`, c.pos])];
    for (const [nm, p] of targets) {
      const i = g.navNear(p.x + 4, p.z + 3, g.terrainH(p.x, p.z), false), c = P[i];
      if (!g.clearPath(c.x, c.z, p.x + 4, p.z + 3, c.y)) out.push(`  ★${nm} を見通せる節点が近くに無い（いちばん近い ${name(i)} から歩けない）`);
    }
    return out.join('\n');
  }));
  console.log('\nページのエラー', errs.length);
  await b.close();
})();
