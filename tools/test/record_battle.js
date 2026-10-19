// 本体の対戦を観測し、単独で開ける俯瞰リプレイを保存する。過去の結果から軌跡を推定しない。
// python3 tools/test/make_dbg.py dbg --trace
// node tools/test/record_battle.js dbg circulation-v3 出力フォルダ 20261039,20261040,20261041
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const {chromium} = require('playwright');
const {openMap} = require('../mapgen_browser');
const observeMobility = require('./mobility_observer');
const ROOT = path.resolve(__dirname, '../..');
const [dbg, id = 'circulation-v3', output = 'dbg/replay', seedList = '20261039,20261040,20261041'] = process.argv.slice(2);
const seeds = seedList.split(',').map(Number);
if (dbg !== 'dbg' || !seeds.length || new Set(seeds).size !== seeds.length || seeds.some(s => !Number.isInteger(s) || s < 0 || s > 0xffffffff)) throw new Error('dbg、マップID、出力フォルダ、重複しない32bit整数のシードを指定してください');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

function summarize(match) {
  const losses = Object.fromEntries(['B','R'].map(team => [team, {direct:0,wreck:0}]));
  for (const e of match.events) if (e.type === 'coreHit' || e.type === 'wreck') losses[e.team][e.type === 'coreHit' ? 'direct' : 'wreck'] += e.amount;
  for (const [i, team] of ['B','R'].entries()) {
    const total = losses[team].direct + losses[team].wreck;
    if (Math.abs(match.initialCore[i] - match.finalCore[i] - total) > 1e-6) throw new Error(`${team} コア被害の内訳が実測HP差と一致しません`);
  }
  const firstHits = ['B','R'].map(team => match.events.find(e => e.type === 'coreHit' && e.unit?.startsWith(team)) || null);
  return {seed:match.seed, winner:match.winner, seconds:match.seconds, losses, firstHits,
    invasions:Object.fromEntries(['B','R'].map(team => [team, match.events.filter(e => e.type === 'baseEnter' && e.team === team).length])),
    captures:match.events.filter(e => e.type === 'plant').length, kills:match.kills, errors:match.errors};
}

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const data = {version:1, sourceCommit:child.execFileSync('git', ['rev-parse','HEAD'], {cwd:ROOT,encoding:'utf8'}).trim(),
    engineSha256:hash('prototype/index.html'), mapSourceSha256:hash('prototype/maps/'+id.replace(/-v\d+$/,'')+'.js'), recorderSha256:hash('tools/test/record_battle.js'), debugMakerSha256:hash('tools/test/make_dbg.py'), mobilityObserverSha256:hash('tools/test/mobility_observer.js'),
    positionSampleSeconds:0.25, unitColumns:['x','y','z','hp','flags','segment','yaw','coreDamageRaw','target'],
    flags:{alive:1,flying:2,upper:4,invulnerable:8,transfer:16,down:32},
    note:'新しく実行した対戦の観測記録。過去13試合の再生ではない。位置は0.25秒刻み、被害・出撃・侵入・所有者変更は0.05秒刻みで観測。攻撃機の位置は命中時の現在位置であり発射地点や弾道ではない。', matches:[]};
  let browser;
  try {
    browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    for (const seed of seeds) {
      const {page,errors} = await openMap(browser, id, null, seed);
      try {
        if (!await page.evaluate(() => window.__battleTraceVersion === 1)) throw new Error('make_dbg.py dbg --trace を実行してください');
        await page.click('#start');
        await page.evaluate('window.__observeMobility = '+observeMobility.toString());
        const info = await page.evaluate(() => {
          const g=__g, scene=g.units[0].group.parent;
          g.renderer.render=()=>scene.updateMatrixWorld();
          g.player.isPlayer=false; g.spawn(g.player,'base');
          const round=n=>Math.round(n*100)/100, uid=u=>u.team+(u.idx+1);
          const s=window.__recording={ticks:0,events:[],frames:[],segments:Object.fromEntries(g.units.map(u=>[uid(u),0])),inBase:{},alive:{},owners:Object.fromEntries(g.plants.map(p=>[p.id,p.owner]))};
          window.__battleEvent=e=>{
            e.t=round(g.MATCH-g.timeLeft);
            if(e.pos) e.pos=e.pos.map(round);
            if(e.type==='deploy') s.segments[e.unit]++;
            e.segment=s.segments[e.unit];
            s.events.push(e);
          };
          for(const u of g.units) s.events.push({type:'deploy',t:0,unit:uid(u),team:u.team,at:'base',reason:'initial',pos:u.pos.toArray().map(round),segment:0});
          window.__recordFrame=()=>{
            s.frames.push({t:round(g.MATCH-g.timeLeft),c:[g.cores.B.hp,g.cores.R.hp],p:g.plants.map(p=>[p.owner,round(p.gauge)]),l:g.curMap.lifts ? g.lifts.map(l=>l.pos.toArray().map(round)) : [],u:g.units.map(u=>[
              round(u.pos.x),round(u.pos.y),round(u.pos.z),round(u.hp),
              (u.alive?1:0)|(u.flying?2:0)|(u.onGround && g.groundAt(u.pos.x,u.pos.z,u.pos.y)>5?4:0)|(u.invulT>0?8:0)|(u.transfer?16:0)|(u.downT>0?32:0),
              s.segments[uid(u)],round(u.yaw),u.sc.coreDmg,u.target ? (u.target.kind==='unit'?uid(u.target):u.target.kind) : null])});
          };
          __recordFrame();
          const [mx,mz]=g.curMap.size, step=4, nx=Math.ceil(mx*2/step)+1,nz=Math.ceil(mz*2/step)+1;
          const heights=[];
          for(let z=0;z<nz;z++) for(let x=0;x<nx;x++) heights.push(round(g.terrainH(-mx+x*step,-mz+z*step)));
          return {initialCore:[g.cores.B.hp,g.cores.R.hp],duration:g.MATCH,
            units:g.units.map(u=>({id:uid(u),team:u.team,role:u.role,cls:u.cls,className:g.CLASSES[u.cls].name,mech:u.mech,loadout:Object.fromEntries(Object.entries(u.slots).map(([k,s])=>[k,s.w.name]))})),
            map:{id:g.mapId,name:g.curMap.name,subtitle:g.curMap.subtitle,size:g.curMap.size,baseLine:g.curMap.baseLine,
              terrain:{step,nx,nz,heights},obstacles:g.obstacles.filter(o=>!g.curMap.lifts || !g.lifts.some(l=>l.ob===o)).map(o=>({minX:o.minX,maxX:o.maxX,minZ:o.minZ,maxZ:o.maxZ,top:o.top,bottom:o.bottom || 0})),
              bridges:g.curMap.bridges || [],water:g.curMap.water || [],
              plants:g.plants.map(p=>({id:p.id,pos:p.pos.toArray(),radius:g.PLANT_R})),
              cores:['B','R'].map(team=>({team,pos:g.cores[team].pos.toArray()})),
              catapults:g.catapults.map(c=>({pos:c.pos.toArray(),land:c.land.toArray()})),
              jumpPads:g.curMap.jumpPads ? g.jumpPads.map(p=>({pos:p.pos.toArray(),exit:p.exit.toArray(),radius:p.radius})) : [],
              lifts:g.curMap.lifts ? g.lifts.map(l=>({from:l.from.toArray(),to:l.to.toArray(),w:l.w,depth:l.depth})) : [],
              nav:{nodes:g.NAV ? g.NAV.pts.map(p=>[p.x,p.y,p.z]) : [],links:g.NAV ? g.NAV.links.map(l=>[l.a,l.b]) : []}}};
        });
        data.map ||= info.map;
        let ended=false, elapsed=0;
        while (!ended && elapsed < info.duration + 1) {
          ({ended,elapsed}=await page.evaluate(() => {
            const g=__g,s=__recording,uid=u=>u.team+(u.idx+1),round=n=>Math.round(n*100)/100;
            for(let f=0;f<100 && !g.ended;f++) {
              g.loop(__advanceClock()); s.ticks++;
              for(const e of __observeMobility()){e.segment=s.segments[e.unit];s.events.push(e);}
              for(const p of g.plants) if(p.owner!==s.owners[p.id]) {s.events.push({type:'plant',t:round(g.MATCH-g.timeLeft),plant:p.id,from:s.owners[p.id],to:p.owner});s.owners[p.id]=p.owner;}
              for(const u of g.units) {
                const id=uid(u), inside=u.alive && u.pos.z*g.TEAM[u.team].dir>g.curMap.baseLine;
                if(inside && !s.inBase[id]) s.events.push({type:'baseEnter',t:round(g.MATCH-g.timeLeft),unit:id,team:u.team,pos:u.pos.toArray().map(round),segment:s.segments[id]});
                if(s.alive[id] && !u.alive) s.events.push({type:'down',t:round(g.MATCH-g.timeLeft),unit:id,team:u.team,pos:u.pos.toArray().map(round),segment:s.segments[id]});
                s.inBase[id]=inside; s.alive[id]=u.alive;
              }
              if(s.ticks%5===0 || g.ended) __recordFrame();
            }
            return {ended:g.ended,elapsed:g.MATCH-g.timeLeft};
          }));
        }
        const match=await page.evaluate(()=>{
          const g=__g,b=g.cores.B.hp,r=g.cores.R.hp;
          return {...__recording,ended:g.ended,seconds:Math.round((g.MATCH-g.timeLeft)*100)/100,
            finalCore:[b,r],winner:b===r?'draw':r<=0 || (b>0 && b>r)?'B':'R',
            kills:Object.fromEntries(['B','R'].map(t=>[t,g.units.filter(u=>u.team===t).reduce((n,u)=>n+u.sc.kills,0)]))};
        });
        const {segments,inBase,alive,owners,...record}=match;
        Object.assign(record,{seed,units:info.units,initialCore:info.initialCore,errors});
        if(!record.ended || errors.length || !record.kills.B || !record.kills.R) throw new Error(`seed ${seed} の対戦が正常に終わりませんでした: ${errors.join(',')}`);
        const summary=summarize(record);
        data.matches.push(record);
        fs.writeFileSync(path.join(output,'recorded.json'),JSON.stringify(data)+'\n');
        fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({note:data.note,sourceCommit:data.sourceCommit,matches:data.matches.map(summarize)},null,2)+'\n');
        const template=fs.readFileSync(path.join(__dirname,'battle_viewer.html'),'utf8');
        fs.writeFileSync(path.join(output,'replay.html'),template.replace('/*__BATTLE_DATA__*/',JSON.stringify(data).replace(/</g,'\\u003c')));
        console.log(`seed=${seed} ${record.seconds}秒 勝者=${record.winner} コア直接被害 B=${summary.losses.B.direct.toFixed(1)}/R=${summary.losses.R.direct.toFixed(1)} 大破被害 B=${summary.losses.B.wreck.toFixed(1)}/R=${summary.losses.R.wreck.toFixed(1)} HP差との照合OK エラー${errors.length}`);
      } finally {await page.close();}
    }
  } finally {if(browser) await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
