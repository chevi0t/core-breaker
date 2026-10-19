// 描画を省き、元のゲームの loop を固定時間で呼ぶ対戦検査。勝率の推定値は作らない。
// node tools/test/map_battle.js dbg circulation,circulation-v2,circulation-v3 301 出力.json [開始シード]
// マップIDを繰り返すと初期乱数を変えて再戦する。制限時間以上を指定すると終局まで検査する。
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {openMap} = require('../mapgen_browser');
const observeMobility = require('./mobility_observer');
const prepareBotBattle = require('./prepare_bot_battle');
const legacy=process.argv.includes('--legacy-player'),args=process.argv.slice(2).filter(a=>a!=='--legacy-player');
const maps=(args[1] || 'circulation,circulation-v2,circulation-v3').split(',');
const seconds=Number(args[2] || 150), output=args[3] || 'dbg/map-battles.json';
const seedStart=Number(args[4] ?? 20261019);
if(args[0]!=='dbg' || !(seconds>0 && Number.isFinite(seconds))) throw new Error('dbg と正の検証秒数を指定してください');
if(!Number.isInteger(seedStart) || seedStart<0 || seedStart+maps.length-1>0xffffffff) throw new Error('開始シードと最終シードは0〜4294967295の整数にしてください');
(async()=>{
  let browser;
  const results=[];
  try {
    browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    for(const [index,id] of maps.entries()) {
      const {page,errors}=await openMap(browser,id,null,seedStart+index,{silent:true});
      try {
        await page.click('#start');
        const initialization=await page.evaluate(prepareBotBattle,legacy);
        await page.evaluate('window.__observeMobility = '+observeMobility.toString());
        await page.evaluate(()=>{
          const g=__g;
          window.__battle={ticks:0,captures:0,events:[],mobility:[],owners:Object.fromEntries(g.plants.map(p=>[p.id,p.owner])),occupancy:{},layers:{upper:0,west:0,center:0,east:0},stalls:0,last:{}};
          __battle.initialCore=[g.cores.B.hp,g.cores.R.hp];
          if(window.__battleTraceVersion===1){
            __battle.losses={B:{direct:0,wreck:0},R:{direct:0,wreck:0}};
            window.__battleEvent=e=>{if(e.type==='coreHit'||e.type==='wreck')__battle.losses[e.team][e.type==='coreHit'?'direct':'wreck']+=e.amount;};
          }
        });
        let elapsed=0,ended=false;
        while(elapsed<seconds && !ended) {
          ({elapsed,ended}=await page.evaluate(limit=>{
            const g=__g,s=__battle;
            for(let frame=0;frame<100 && g.MATCH-g.timeLeft<limit && !g.ended;frame++) {
              g.loop(__advanceClock()); s.ticks++;
              s.mobility.push(...__observeMobility());
              for(const p of g.plants) {
                if(p.owner!==s.owners[p.id]) {s.events.push({t:Math.round((g.MATCH-g.timeLeft)*10)/10,id:p.id,from:s.owners[p.id],to:p.owner});s.owners[p.id]=p.owner;s.captures++;}
                const key=p.id+':'+(p.owner || 'neutral'); s.occupancy[key]=(s.occupancy[key] || 0)+0.05;
              }
              if(s.ticks%20===0) for(const u of g.units) {
                if(!u.alive) continue;
                const onUpper=u.onGround && g.groundAt(u.pos.x,u.pos.z,u.pos.y)>5;
                const layer=onUpper?'upper':u.pos.x < -45?'west':u.pos.x>45?'east':'center'; s.layers[layer]++;
                const key=u.team+u.idx,prev=s.last[key];
                if(prev && u.moveInput && !u.target && !u.flying && Math.hypot(u.pos.x-prev[0],u.pos.z-prev[1])<0.5) s.stalls++;
                s.last[key]=[u.pos.x,u.pos.z];
              }
            }
            return {elapsed:g.MATCH-g.timeLeft,ended:g.ended};
          },seconds));
        }
        const result=await page.evaluate(()=>{
          const g=__g,s=__battle;
          const b=g.cores.B.hp,r=g.cores.R.hp;
          return {map:g.mapId,seconds:Math.round((g.MATCH-g.timeLeft)*10)/10,matchDuration:g.MATCH,ended:g.ended,winner:g.ended?(b===r?'draw':r<=0 || (b>0 && b>r)?'B':'R'):null,endedBy:g.ended?(b<=0 || r<=0?'core':'time'):null,core:[Math.round(b),Math.round(r)],kills:{B:g.units.filter(u=>u.team==='B').reduce((a,u)=>a+u.sc.kills,0),R:g.units.filter(u=>u.team==='R').reduce((a,u)=>a+u.sc.kills,0)},captures:s.captures,captureEvents:s.events,occupancy:s.occupancy,layers:s.layers,layerSampling:'1秒ごとの生存機。upper は地上高5m超の面に接地中。その他は x<-45 / 中央 / x>45',stalls:s.stalls};
        });
        result.mobility=await page.evaluate(()=>__battle.mobility);
        result.initialization=initialization;
        result.coreExact=await page.evaluate(()=>[__g.cores.B.hp,__g.cores.R.hp]);
        result.initialCore=await page.evaluate(()=>__battle.initialCore);
        result.losses=await page.evaluate(()=>__battle.losses||null);
        if(result.losses) for(const [i,team] of ['B','R'].entries()) {
          if(Math.abs(result.initialCore[i]-result.coreExact[i]-result.losses[team].direct-result.losses[team].wreck)>1e-6)throw new Error(`${id}/${team}: コア被害内訳が一致しません`);
        }
        result.seed=seedStart+index;result.errors=errors;
        result.balance=result.ended?'勝率未確定（終局までの観測1試合）':'勝率未確定（短時間動作確認）';
        results.push(result);
        fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
        console.log(`${index+1}/${maps.length} ${id} seed=${result.seed}: ${result.seconds}秒 勝者=${result.winner || '未終了'} コア B=${result.core[0]}/R=${result.core[1]} 撃破 B=${result.kills.B}/R=${result.kills.R} 占拠変化${result.captures} エラー${errors.length}`);
        if(seconds>=result.matchDuration && !result.ended) throw new Error(`${id}: 制限時間を過ぎても試合が終了しませんでした`);
        if(errors.length || !result.kills.B || !result.kills.R) throw new Error(`${id}: 対戦検査に失敗しました`);
        if(id.startsWith('circulation') && !result.captures) throw new Error(`${id}: プラントの所有者が変わりませんでした`);
      } finally {await page.close();}
    }
  } finally {if(browser) await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
