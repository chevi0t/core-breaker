// OSM 市街地の施設・徒歩・屋上・実際の Bot 戦を検査する。
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const [debugDir, dataFile, outputDir, mode] = process.argv.slice(2);
if (!outputDir) throw new Error('使い方: node tools/test/osm_city_check.js dbgフォルダ 生成JSON 記録フォルダ');
const {map:data} = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
fs.mkdirSync(outputDir, {recursive:true});
(async()=>{
  const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:720}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.requestAnimationFrame=()=>0;
      window.AudioContext=window.webkitAudioContext=undefined;
      window.__allBotBattle=true;
      let seed=20261022, now=0;
      Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
      performance.now=()=>now;
      window.__advanceClock=()=>now+=50;
    });
    await page.route('**/maps.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MAP_DATA={osm_city:'+JSON.stringify(data)+'};'}));
    await page.route('**fonts.g*/**',r=>r.fulfill({contentType:'text/css',body:''}));
    await page.goto('file://'+path.resolve(debugDir,'dbg.html'));
    await page.waitForFunction(()=>window.__g);
    await page.click('#start');
    const result=await page.evaluate(()=>{
      const g=__g,T=g.T,d=g.curMap,N=g.NAV,checks=[],routes=[],roofs=[];
      const assert=(ok,name)=>{if(!ok)throw new Error(name);checks.push(name);};
      g.running=false;
      for(const u of g.units){u.frozen=true;u.pos.set(d.size[0]-6,0,d.size[1]-6);}
      const u=g.player,reset=(p)=>{
        g.equip(u,'assault');u.pos.set(p[0],p[2]||0,p[1]);u.vel.set(0,0,0);
        Object.assign(u,{alive:true,onGround:true,zip:null,zipCd:0,flying:false,repairing:false,planted:false,stun:'',electricT:0,downT:0,ctrlLockT:0,swing:null,transfer:null,dashT:0,longDash:false,charging:false,overheat:false,boost:u.maxBoost});
      };
      assert(d.terrain.length===0,'地面に起伏を付けない');
      assert(d.attribution.license==='ODbL-1.0'&&d.desc.includes('OpenStreetMap'),'地理データの出典');
      assert(d.layout.length<1000&&N.pts.length<800,'形状と経路の上限');
      const roadMeshes=[];g.scene.traverse(o=>{if(o.name==='city-road-surface')roadMeshes.push(o);});
      assert(roadMeshes.length===1,'道路を1メッシュへ統合');
      assert(!g.hittables.includes(roadMeshes[0]),'舗装を新たな射撃障害物にしない');
      const buildings=g.hittables.filter(o=>o.name.startsWith('city-building-'));
      assert(buildings.length===2,'建物の壁と屋根を2メッシュへ統合');
      g.scene.updateMatrixWorld(true);
      for(const [x,z,w] of d.generation.roadCover){
        const hit=g.castFrom(new T.Vector3(x-w/2-5,2.4,z),new T.Vector3(1,0,0),u,w+10);
        assert(hit&&Math.abs(hit.point.x-(x-w/2))<.05,'道路の遮蔽 '+[x,z]);
      }
      for(const {center,cover} of d.generation.roofs){
        const hit=g.castFrom(new T.Vector3(cover[0]-8,center[2]+1.5,cover[1]),new T.Vector3(1,0,0),u,16);
        assert(hit&&Math.abs(hit.point.x-(cover[0]-3.5))<.05,'屋上の遮蔽 '+center);
      }
      for(const p of g.plants){
        assert(g.groundAt(p.pos.x,p.pos.z,0)<.1,'プラント'+p.id+'は地上');
        for(const side of [-1,1]) for(const dx of [-6,0,6]) for(const dist of [46,49,52]){
          const x=p.pos.x+dx,z=p.pos.z+side*dist;
          assert(!g.obstacles.some(o=>o.top>.6&&(o.bottom===undefined||o.bottom<4)&&x>o.minX-1.2&&x<o.maxX+1.2&&z>o.minZ-1.2&&z<o.maxZ+1.2),'出撃帯 '+[p.id,side,dx,dist]);
        }
      }
      for(const l of N.links){
        const a=N.pts[l.a],b=N.pts[l.b];
        assert(g.clearPath(a.x,a.z,b.x,b.z,a.y)&&g.clearPath(b.x,b.z,a.x,a.z,b.y),'経路 '+l.a+'–'+l.b);
      }
      const near=(p)=>N.pts.reduce((best,q,i)=>Math.hypot(q.x-p[0],q.z-p[1])<Math.hypot(N.pts[best].x-p[0],N.pts[best].z-p[1])?i:best,0);
      const goals=[[8,d.baseZ-20],[8,-d.baseZ+20],...g.plants.map(p=>[p.pos.x+6,p.pos.z+3])];
      for(const chassis of ['light','heavy']) for(const team of ['B','R']){
        u.team=team;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,'assault');
        u.navW=N.links.map(()=>1);
        const start=team==='B'?goals[0]:goals[1];
        for(const goal of goals){
          if(goal===start)continue;
          const route=g.navPath(u,near(start),near(goal));
          assert(!!route,'到達経路 '+[chassis,team,goal]);
          const first=N.pts[route[0]];reset([first.x,first.z,first.y]);
          let ticks=0;
          for(const i of route.slice(1)){
            const q=N.pts[i];let reached=false;
            for(let n=0;n<600;n++){
              const delta=new T.Vector3(q.x-u.pos.x,0,q.z-u.pos.z);
              if(delta.length()<1.2){reached=true;break;}
              g.physics(u,delta.normalize(),false,false,.05);ticks++;
            }
            assert(reached,'徒歩 '+[chassis,team,i,JSON.stringify(u.pos.toArray())]);
          }
          routes.push({chassis,team,goal,seconds:ticks*.05,arrived:true});
        }
      }
      for(const chassis of ['light','heavy'])for(let i=0;i<g.ziplines.length;i++){
        const zip=g.ziplines[i];u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};
        reset([zip.bottom.x,zip.bottom.z,zip.bottom.y]);
        assert(g.zipGrab(u),'屋上の綱を掴む '+[chassis,i]);
        let n=0;while(u.zip&&n++<1000)g.physics(u,new T.Vector3(),false,false,.05);
        for(let k=0;k<30;k++)g.physics(u,new T.Vector3(),false,false,.05);
        assert(!u.zip&&u.onGround&&Math.abs(u.pos.y-zip.top.y)<.2,'屋上へ着地 '+[chassis,i,JSON.stringify(u.pos.toArray())]);
        roofs.push({chassis,i,height:u.pos.y,seconds:n*.05});
      }
      const catapults=[];
      for(const chassis of ['light','heavy'])for(const cp of g.catapults){
        u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};
        reset([cp.pos.x,cp.pos.z,cp.pos.y]);g.launch(u,cp);
        let ticks=0;
        while((u.flying||!u.onGround)&&ticks++<400)g.physics(u,new T.Vector3(),false,false,.05);
        const miss=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
        assert(u.onGround&&miss<6,'カタパルトの着地 '+[chassis,cp.side,cp.pos.x,miss]);
        catapults.push({chassis,team:cp.side,from:cp.pos.toArray(),landing:u.pos.toArray(),miss});
      }
      return {checks:checks.length,routes,roofs,catapults,boxes:d.layout.length,nav:N.pts.length,links:N.links.length};
    });
    console.log('施設・徒歩・屋上',JSON.stringify(result));
    if(mode==='--features-only'){
      result.errors=errors;
      fs.writeFileSync(path.join(outputDir,'features.json'),JSON.stringify(result,null,2));
      if(errors.length)throw new Error(errors.join('\n'));
      return;
    }
    // 新規の通常編成で10対10を開始し、本体の同じ loop を進める。
    await page.evaluate(()=>{
      __g.setup();__g.running=true;
      __g.renderer.render=()=>__g.scene.updateMatrixWorld(true);
      window.__battle={owners:[],kills:[],steps:0};
    });
    for(let batch=0;batch<15;batch++){
      const state=await page.evaluate(()=>{
        const g=__g,s=__battle;
        for(let n=0;n<200&&g.running;n++){
          __advanceClock();g.loop(s.steps++*50);
          const owners=g.plants.map(p=>p.owner||'-').join('');
          if(s.owners.at(-1)!==owners)s.owners.push(owners);
        }
        return {seconds:g.MATCH-g.timeLeft,owners:s.owners,core:[g.cores.B.hp,g.cores.R.hp],kills:g.units.map(u=>({team:u.team,kills:u.sc.kills,deaths:u.sc.deaths})),running:g.running};
      });
      console.log('Bot戦',batch+1,JSON.stringify(state));
      result.battle=state;
      if(!state.running)break;
    }
    result.errors=errors;
    fs.writeFileSync(path.join(outputDir,'validation.json'),JSON.stringify(result,null,2));
    if(errors.length)throw new Error(errors.join('\n'));
    if(result.battle.owners.length<2)throw new Error('Botによる占拠変化がありません');
    console.log('成功',result.checks,'件、実走',result.routes.length,'経路、屋上',result.roofs.length,'件');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
