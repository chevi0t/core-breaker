// 昇降設備の見た目だけでなく、実際の physics・Bot・マップ切替を検査する。
// python3 tools/test/make_dbg.py dbg && node tools/test/mobility_check.js dbg
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {openMap}=require('../mapgen_browser');
if(process.argv[2]!=='dbg')throw new Error('dbg を指定してください');
(async()=>{
  let browser;
  try{
    browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
    const {page,errors}=await openMap(browser,'mobility',null,20261051);
    try{
      await page.click('#start');
      const results=await page.evaluate(()=>{
        const g=__g,T=g.T,dt=.05,report=[];
        const check=(ok,message)=>{if(!ok)throw new Error(message);};
        const reset=()=>{
          g.setup();for(const v of g.units)v.frozen=true;
          const u=g.player;u.frozen=false;u.stun='';u.catCd=0;u.onGround=true;u.vel.set(0,0,0);
          const scene=u.group.parent;g.renderer.render=()=>scene.updateMatrixWorld();return u;
        };
        let u=reset(),peak=0;
        u.pos.set(-60,0,0);
        for(let i=0;i<80;i++){g.physics(u,new T.Vector3(),false,i===0,dt);peak=Math.max(peak,u.pos.y);}
        check(peak>6 && peak<7,'通常ジャンプが約6.8m（時間刻み0.05秒では約6.3m）になっていない');
        report.push({name:'通常ジャンプでは高さ12mへ届かない',peak});
        for(const [team,isPlayer] of [['B',true],['B',false],['R',false]]){
          u=reset();u=team==='R'?g.units.find(v=>v.team==='R'):u;u.isPlayer=isPlayer;
          const p=g.jumpPads[0];u.pos.copy(p.pos);u.onGround=true;u.catCd=0;
          g.jumpPadUpdate(dt);check(u.flying && u.vel.y>0 && u.vel.x===0 && u.vel.z===0,'垂直射出でない');
          let high=0,arrived=false;
          for(let i=0;i<240;i++){
            const goal=u.pos.y<p.exit.y+.5 && u.vel.y>0?p.pos:p.exit;
            const wish=new T.Vector3(goal.x-u.pos.x,0,goal.z-u.pos.z);if(wish.length()>1)wish.normalize();else wish.set(0,0,0);
            g.physics(u,wish,false,false,dt);high=Math.max(high,u.pos.y);
            if(u.onGround && u.pos.y>11.8){arrived=true;break;}
          }
          check(arrived,'ジャンプパッドから高所へ着地できない');
          report.push({name:`ジャンプパッド実走 ${team}/${isPlayer?'プレイヤー':'Bot'}`,peak:high,landing:u.pos.toArray()});
        }
        for(const [team,isPlayer] of [['B',true],['B',false],['R',false]]){
          u=reset();u=team==='R'?g.units.find(v=>v.team==='R'):u;u.isPlayer=isPlayer;
          const l=g.lifts[0];u.pos.copy(l.from);u.onGround=true;let up=false,down=false;
          for(let i=0;i<600;i++){
            g.liftUpdate(dt);g.physics(u,new T.Vector3(),false,false,dt);
            if(u.pos.distanceTo(l.to)<.05)up=true;
            if(up && u.pos.distanceTo(l.from)<.05){down=true;break;}
          }
          check(up && down,'リフトで往復できない');
          report.push({name:`リフト往復 ${team}/${isPlayer?'プレイヤー':'Bot'}`,up,down});
        }
        u=reset();let l=g.lifts[0];u.pos.copy(l.from);u.onGround=true;
        for(let i=0;i<300 && l.pos.y<5;i++){g.liftUpdate(dt);g.physics(u,new T.Vector3(),false,false,dt);}
        check(l.pos.y>=5,'リフトが上昇しない');
        g.physics(u,new T.Vector3(1,0,0),false,true,dt);g.liftUpdate(dt);
        check(!u.onGround && !u.lift,'リフトからジャンプで離れられない');
        report.push({name:'移動するリフトからジャンプで降りる',height:u.pos.y});
        u=reset();l=g.lifts[0];u.pos.copy(l.from);u.onGround=true;
        const ceiling={minX:17,maxX:29,minZ:-5,maxZ:5,bottom:6,top:8};g.obstacles.push(ceiling);
        let stopped=false;
        for(let i=0;i<180;i++){g.liftUpdate(dt);g.physics(u,new T.Vector3(),false,false,dt);stopped ||= l.blocked;check(u.pos.y+4<=6.01,'リフトで天井をすり抜けた');}
        check(stopped,'天井があってもリフトが止まらない');g.obstacles.splice(g.obstacles.indexOf(ceiling),1);
        for(let i=0;i<150 && l.pos.distanceTo(l.to)>.05;i++){g.liftUpdate(dt);g.physics(u,new T.Vector3(),false,false,dt);}
        check(l.pos.distanceTo(l.to)<.05,'障害物を除いてもリフトが再開しない');
        report.push({name:'頭上の障害物で停止し、除去後に再開',stopped,resumed:true});
        u=reset();l=g.lifts[0];u.pos.set(60,0,0);
        for(let i=0;i<300 && l.pos.distanceTo(l.to)>.05;i++)g.liftUpdate(dt);
        check(l.pos.distanceTo(l.to)<.05,'空のリフトが上端に着かない');
        u.pos.copy(l.from);u.onGround=true;stopped=false;
        for(let i=0;i<200;i++){g.liftUpdate(dt);g.physics(u,new T.Vector3(),false,false,dt);if(l.blocked){stopped=true;break;}}
        check(stopped && l.pos.y-.6>=u.pos.y+4,'下降リフトが下の機体を押し潰した');
        u.pos.set(60,0,0);
        for(let i=0;i<150 && l.pos.distanceTo(l.from)>.05;i++)g.liftUpdate(dt);
        check(l.pos.distanceTo(l.from)<.05,'床下が空いても下降を再開しない');
        report.push({name:'床下の機体で停止し、退避後に下降を再開'});
        for(const kind of ['pad','lift']) for(const team of ['B','R']){
          reset();u=g.units.find(v=>v.team===team && !v.isPlayer);u.frozen=false;u.role='plant';
          u.pos.set(kind==='pad'?-31:33,0,3);u.vel.set(0,0,0);u.onGround=true;u.stun='';u.catCd=0;
          let used=false,arrived=false;
          for(let i=0;i<800;i++){
            g.loop(__advanceClock());used ||= kind==='pad'?!!u.jumpPad:!!u.lift;
            if(u.onGround && u.pos.y>11.8 && g.terrainH(u.pos.x,u.pos.z)>11.8 && Math.hypot(u.pos.x,u.pos.z)<16){arrived=true;break;}
          }
          check(used && arrived,`Bot ${team} が ${kind} を選んで高所へ到達できない (${u.pos.toArray()})`);
          report.push({name:`Botの設備選択と高所到達 ${team}/${kind}`,used,arrived,landing:u.pos.toArray()});
        }
        reset();l=g.lifts[0];for(let i=0;i<300 && l.pos.distanceTo(l.to)>.05;i++)g.liftUpdate(dt);
        check(l.pos.distanceTo(l.to)<.05,'待機検査のリフトが上端に着かない');
        u=g.units.find(v=>v.team==='B' && !v.isPlayer);u.frozen=false;u.role='plant';u.pos.set(33,0,3);u.onGround=true;u.vel.set(0,0,0);
        let waited=false,boarded=false,arrived=false;
        for(let i=0;i<1000;i++){g.loop(__advanceClock());waited ||= !u.lift && l.pos.distanceTo(l.from)>.2 && u.pos.x>29;boarded ||= !!u.lift;if(u.onGround && g.terrainH(u.pos.x,u.pos.z)>11.8){arrived=true;break;}}
        check(waited && boarded && arrived,'Botが不在のリフトを待って乗り込めない');
        report.push({name:'Botが下降リフトの外で待ち、次の便で台地へ到達',waited,boarded,arrived});
        g.setup();check(g.lifts[0].pos.distanceTo(g.lifts[0].from)<1e-6,'再試合でリフトが戻らない');
        report.push({name:'再試合でリフトを初期位置へ戻す'});
        g.MAPS.mobility_mirror={...g.curMap,asym:false,jumpPads:[{at:[-20,30,0],exit:[-6,30,12],rise:28}],lifts:[{from:[24,30,0],to:[16,30,12],size:[8,8]}]};
        g.selectMap('mobility_mirror');
        check(g.jumpPads.length===2 && g.lifts.length===2,'点対称に設備を展開できない');
        check(g.jumpPads[1].pos.x===20 && g.jumpPads[1].pos.z===-30 && g.jumpPads[1].exit.y===12,'設備の点対称で高さが変わった');
        report.push({name:'通常マップの設備は点対称、asym の設備は指定数で配置'});
        g.selectMap('city');check(g.jumpPads.length===0 && g.lifts.length===0,'マップ切替後に設備が残る');
        g.selectMap('mobility');check(g.jumpPads.length===1 && g.lifts.length===1,'マップ切替で設備が重複する');
        report.push({name:'従来マップと試験場の切替で設備を作り直す'});
        return report;
      });
      assert.equal(errors.length,0,errors.join('\n'));
      const output=process.argv[3] || 'dbg/mobility-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.writeFileSync(output,JSON.stringify({passed:results.length,results,errors},null,2)+'\n');
      console.log(`${results.length}件の実動作検査に成功、ページエラー0`);
    }finally{await page.close();}
  }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
