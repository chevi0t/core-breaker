// 使い方: node tools/test/bot_battle.js <dir> city,wide,mesa,dock 150（<dir> は make_dbg.py の出力。プレイヤーもBotにして決まった秒数戦わせ、エラーと撃破・設置物を数える）
// v0.11 Bot同士の対戦（武器は出撃ごとにランダム）：マップごとに決まった秒数流し、エラー・撃破・使われた武器・設置物を数える
// v0.17 から蘇生（行動不能から起き上がった回数）とエリア移動（待機を始めた回数）も数える
const path = require('path');
let chromium; // Playwright：普通に入っていればそれを、無ければこの環境の場所から
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dir = process.argv[2], maps = (process.argv[3] || 'city,wide,mesa,dock').split(','), secs = +(process.argv[4] || 150);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  try {
  for (const id of maps) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    const errs = [];
    p.on('pageerror', e => { errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]); });
    p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
    await p.route('**fonts.g*/**', r => r.abort());
    await p.goto('file://' + path.resolve(dir, 'dbg.html'));
    // ソフトウェア描画でも準備中の描画を待たずに操作できるよう、先に行列更新だけにする。
    await p.evaluate(() => { __g.renderer.render = () => { const u = __g.units[0]; if (u) u.group.parent.updateMatrixWorld(); }; });
    await p.waitForTimeout(200);
    const E = (fn, a) => p.evaluate(fn, a);
    await E(id => __g.selectMap(id), id);
    // Bot戦は出撃処理を直接起動する。ポインタロックを伴う実マウス操作は必要ない。
    await p.evaluate(() => document.getElementById('start').click());
    await p.waitForTimeout(300);
    await E(() => {
      const g = __g; { const sc = g.units[0].group.parent; g.renderer.render = () => sc.updateMatrixWorld(); }
      g.player.isPlayer = false;
      g.spawn(g.player, 'base'); // Botとしてランダムな武器で出直す
      window.__st = { kills: 0, spawns: 0, used: {}, placed: {}, fieldT: 0, sentryShots: 0, remoteBoom: 0, maxShells: 0, stuck: 0, revives: 0, xfers: 0, barrierT: 0, escortT: 0, specialTypes: {}, artilleryShots: 0, maxBarrages: 0 };
      const was = new Map(), seen = new Set(), subAmmo = new Map(), auxAmmo = new Map();
      const secondarySeries = new Set(['flare','chain','dart','charge','zoom','blastSniper','lightSniper','jumpMine','delayMine','detonator'].map(k=>g.WEAPONS[k]?.series).filter(Boolean));
      __st.secondaryShots = {};__st.auxiliaryShots={};__st.radarTime={};
      const auxiliarySeries=new Set(['sabre','rod','claw','pike','jammer','airTurret','flyTurret','stunGrenade','planeSensor','ammoBox','radarTool'].map(k=>g.WEAPONS[k]?.series).filter(Boolean));
      const f = () => {
        const s = __st;
        for (const u of g.units) {
          if (was.get(u) && !u.alive) s.kills++;
          if (!was.get(u) && u.alive && seen.has(u.slots)) s.revives++; // 同じ装備のまま生き返った＝蘇生
          if (u.transfer && !u.__xf) s.xfers++;
          u.__xf = !!u.transfer;
          if (u.alive && (!was.get(u) || !seen.has(u.slots))) {
            seen.add(u.slots); s.spawns++;
            for (const k of g.SLOTS) { const n = u.slots[k].w.name; s.used[n] = (s.used[n] || 0) + 1; }
          }
          was.set(u, u.alive);
          const sub=u.slots.sub, count=sub.ammo+sub.reserve, prev=subAmmo.get(sub);
          if (secondarySeries.has(sub.w.series) && prev!=null && count<prev) s.secondaryShots[sub.w.key]=(s.secondaryShots[sub.w.key]||0)+prev-count;
          subAmmo.set(sub,count);
          const aux=u.slots.aux, ac=aux.w.type==='sword'?(u.meleeFired||0):aux.ammo+aux.reserve, prevAux=auxAmmo.get(aux);
          if(auxiliarySeries.has(aux.w.series)){
            const n=prevAux==null?0:aux.w.type==='sword'?ac-prevAux:prevAux-ac;
            if(n>0)__st.auxiliaryShots[aux.w.key]=(__st.auxiliaryShots[aux.w.key]||0)+n;
            if(aux.w.type==='radarTool' && aux.scanRadius>0)__st.radarTime[aux.w.key]=(__st.radarTime[aux.w.key]||0)+.05;
          }
          auxAmmo.set(aux,ac);
          if (u.artilleryFired > (u.__artWas || 0)) s.artilleryShots += u.artilleryFired - (u.__artWas || 0);
          u.__artWas = u.artilleryFired;
          if (u.fieldOn) s.fieldT += 0.05;
          if (u.barrierOn) s.barrierT += 0.05;
          if (u.escortOn) s.escortT += 0.05;
          if (['barrier','escort','repairPost','artillery'].includes(u.slots.sp.w.type)) s.specialTypes[u.slots.sp.w.key] = true;
        }
        for (const gd of g.gadgets) if (!gd.__seen) { gd.__seen = true; s.placed[gd.name] = (s.placed[gd.name] || 0) + 1; }
        s.maxShells = Math.max(s.maxShells, g.shells.length); s.maxBarrages = Math.max(s.maxBarrages,g.barrages.length);
        requestAnimationFrame(f);
      };
      f();
    });
    const t0 = Date.now();
    let res, nextProgress = 30;
    // 低速な環境で指定時間に届かず成功扱いにならないよう、実時間上限と進行を両方確かめる。
    while (Date.now() - t0 < 1200000) {
      await p.waitForTimeout(3000);
      if (errs.length) throw new Error(errs.join('\n'));
      res = await E(() => ({ t: Math.round(__g.MATCH - __g.timeLeft), ended: !document.getElementById('overlay').hidden }));
      if (res.t >= nextProgress) { console.log(id + ': ' + res.t + '秒まで進行'); nextProgress += 30; }
      if (res.t >= secs || res.ended) break;
    }
    const st = await E(() => {
      const g = __g, s = __st;
      // どの武器が何回撃破を取ったかは数えない。武器の種類ごとの使われ方と、試合の進み
      return { t: Math.round(g.MATCH - g.timeLeft), core: [Math.round(g.cores.B.hp), Math.round(g.cores.R.hp)], kills: s.kills, spawns: s.spawns, kinds: Object.keys(s.used).length,
        placed: s.placed, fieldT: Math.round(s.fieldT), maxShells: s.maxShells, revives: s.revives, xfers: s.xfers, barrierT: Math.round(s.barrierT), escortT: Math.round(s.escortT), specialTypes: Object.keys(s.specialTypes), artilleryShots: s.artilleryShots, maxBarrages: s.maxBarrages, secondaryShots: s.secondaryShots, auxiliaryShots:s.auxiliaryShots, radarTime:s.radarTime,
        mechTypes: [...new Set(g.units.flatMap(u => ['head','body','arms','legs'].map(k => u.mech[k])))],
        score: g.units.map(u => `${u.team}${u.idx}:${u.cls[0]}${u.sc.kills}/${u.sc.deaths}`).join(' ') };
    });
    console.log(`== ${id} ${st.t}秒 コア/戦力 ${st.core} 撃破${st.kills} 蘇生${st.revives} エリア移動${st.xfers} 出撃${st.spawns} 使われた武器${st.kinds}種 フィールド作動${st.fieldT}秒 弾の最大${st.maxShells}`);
    if (st.t < secs && !res.ended) throw new Error(id + ': 指定したゲーム内時間に未到達');
    if (errs.length) throw new Error(errs.join('\n'));
    console.log('  機体の型', st.mechTypes.join(','));
    console.log('  追加特別装備', st.specialTypes.join(','), 'バリア作動' + st.barrierT + '秒、自動銃作動' + st.escortT + '秒');
    console.log('  榴弾砲', st.artilleryShots + '発、飛翔中の最大' + st.maxBarrages + '発');
    console.log('  追加副武器の発射', JSON.stringify(st.secondaryShots));
    console.log('  追加補助装備',JSON.stringify(st.auxiliaryShots),'レーダー稼働秒',JSON.stringify(st.radarTime));
    console.log('  設置', JSON.stringify(st.placed));
    console.log('  ', st.score);
    console.log('  エラー', errs.length ? errs.slice(0, 5) : 'なし');
    await p.close();
  }
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
