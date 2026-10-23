// 梅田の半縮尺版を、元の4m機体と本体物理・施設・Botでオフライン検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const folder=path.resolve(process.argv[2]||'mapdesign/kanto_half');
const seconds=Number(process.argv[3]??150);
const config={seed:Number(process.argv[4]??20261024),team:process.argv[5]||'B'};

(async()=>{
  assert(Number.isFinite(seconds)&&seconds>=0,'対戦時間は0以上');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:900}});
    const errors=[],external=[],results={};
    page.on('pageerror',e=>{errors.push(e.stack||String(e));console.error('ブラウザ:',e.message);});
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(seed=>{
      window.testNow=0;performance.now=()=>window.testNow;
      requestAnimationFrame=()=>0;AudioContext=undefined;
      Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
    },config.seed);
    const open=async()=>{
      await page.goto(pathToFileURL(path.join(folder,'play.html')).href);
      await page.waitForFunction(()=>window.__cityBattle,null,{timeout:60000,polling:100});
      assert.deepEqual(errors,[],'読込時のブラウザエラー');
    };
    const check=async(label,fn)=>{
      results[label]=await page.evaluate(fn);
      assert.deepEqual(errors,[],label+'のブラウザエラー');
      console.log(label+': 完了');
    };
    await open();
    await page.evaluate(()=>{
      const g=__cityBattle,T=g.T;
      g.setup();g.running=false;g.scene.updateMatrixWorld(true);
      const u=g.player,zero=new T.Vector3();
      const ok=(value,message,data)=>{if(!value)throw Error(message+' '+JSON.stringify(data));};
      const clearKeys=()=>{
        for(const k of Object.keys(g.keys))delete g.keys[k];
        for(const k of Object.keys(g.pressed))delete g.pressed[k];
        g.mouseDown=false;
      };
      function reset(at,type='heavy',team='B'){
        clearKeys();u.team=team;u.isPlayer=true;
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};
        g.equip(u,'assault');g.spawn(u,'base');u.pos.fromArray(at);u.vel.set(0,0,0);u.boost=u.maxBoost;
        Object.assign(u,{onGround:true,catCd:0,stun:'',stunT:0,dashT:0,lungeT:0,recoverT:0,
          ctrlLockT:0,flying:false,jumpPad:null,planted:false,electricT:0,charging:false,
          chargerOn:false,repairing:false,overheat:false,transfer:null,downT:0});
        for(const other of g.units)other.alive=other===u;
      }
      function bounded(){
        ok(u.pos.toArray().every(Number.isFinite),'座標が有限',u.pos.toArray());
        ok(Math.abs(u.pos.x)<=248.7001&&Math.abs(u.pos.z)<=248.7001,
          '500×500m境界から4m機体が落ちない',u.pos.toArray());
      }
      function coast(duration,dt,wish=zero){
        for(let i=0;i<Math.ceil(duration/dt);i++){g.physics(u,wish,false,false,dt);bounded();}
      }
      window.__halfCheck={g,T,u,zero,ok,reset,bounded,coast,clearKeys};
    });

    await check('縮尺・施設・全経路',()=>{
      const {g,ok}=__halfCheck;
      ok(JSON.stringify(g.mapBounds)==='[250,250]'&&g.city.half===250,'地形は500×500m',g.mapBounds);
      ok(g.UNIT_H===4&&g.R===1.3,'機体は高さ4m・半径1.3mのまま',{height:g.UNIT_H,radius:g.R});
      ok(g.units.length===20,'標準は10対10',g.units.length);
      ok(g.turrets.length===8&&g.radars.length===2&&g.catapults.length===10&&g.pods.length===9&&g.jumpPads.length===6,
        '原案の両基地と街路施設を維持',{turrets:g.turrets.length,radars:g.radars.length,
          catapults:g.catapults.length,pods:g.pods.length,jumpPads:g.jumpPads.length});
      ok(g.plants.length===5&&g.plants.every(p=>p.owner===null),'5プラントは中立から');
      const markers=[['A',-102.5,82.5],['B',-222,-127.5],['C',7.5,15],['D',187.5,130],['E',85.5,-102.5]];
      for(const [id,x,z]of markers){
        const p=g.plants.find(p=>p.id===id);
        ok(p&&Math.hypot(p.pos.x-x,p.pos.z-z)<.01,'元のプラント位置を1/2に縮尺',{id,at:p?.pos.toArray()});
      }
      const plantCats=g.catapults.filter(cp=>cp.targetPlant);
      ok(plantCats.length===2&&plantCats.every(cp=>cp.targetPlant.id==='C'),'B→C・D→Cの射出台を維持');
      ok(g.city.district.lawns?.length>0&&g.terrainH(-222,-127.5)===0,'うめきた公園の芝生を維持');
      ok(g.NAV.pts.length>0&&g.NAV.links.length>0,'経路網がある');
      for(const e of g.NAV.links){
        const a=g.NAV.pts[e.a],b=g.NAV.pts[e.b];
        ok(g.clearPath(a.x,a.z,b.x,b.z,a.y)&&g.clearPath(b.x,b.z,a.x,a.z,b.y),
          '4m機体で全経路が往復可能',{a,b});
      }
      return {bounds:g.mapBounds,mechHeight:g.UNIT_H,mechRadius:g.R,plants:markers,
        bases:['B','R'].map(team=>({team,at:g.city.base(team).at})),
        counts:{turrets:g.turrets.length,radars:g.radars.length,catapults:g.catapults.length,
          pods:g.pods.length,jumpPads:g.jumpPads.length},navigation:{...g.battle.navigationReport,
          nodes:g.NAV.pts.length,links:g.NAV.links.length}};
    });

    await check('全カタパルトの弾道と操作復帰',()=>{
      const {g,T,u,zero,ok,reset,bounded,coast,clearKeys}=__halfCheck,rows=[];
      for(const cp of g.catapults)for(const type of ['light','heavy'])for(const dt of [1/30,1/120]){
        const info={from:cp.pos.toArray(),to:cp.land.toArray(),flight:cp.flight??2.8,type,dt};
        reset(info.from,type);g.catapultUpdate(dt);
        ok(u.flying&&!u.onGround&&u.ctrlLockT===1,'乗ると自動射出し最初の1秒だけ操作禁止',info);
        coast(.5,dt);ok(!g.shortDash(u,new T.Vector3(1,0,0)),'射出直後はダッシュ不可',info);
        coast(.6,dt);ok(u.ctrlLockT===0,'1秒後に操作復帰',info);
        let peak=u.pos.y;
        for(let t=1.1;t<info.flight+3&&!u.onGround;t+=dt){
          g.physics(u,zero,false,false,dt);bounded();peak=Math.max(peak,u.pos.y);
        }
        const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z),landing=u.pos.toArray();
        ok(u.onGround&&error<6&&Math.abs(u.pos.y-cp.land.y)<.12,
          '障害物に早着地せず指定地点6m以内へ着地',{...info,error,landing});
        ok(g.battle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'着地先で建物に埋まらない',{...info,landing});
        ok(u.ctrlLockT===0,'着地後も操作可能',info);
        reset(info.from,type);g.launch(u,cp);
        const forward=u.vel.clone().setY(0).normalize(),speed=Math.hypot(u.vel.x,u.vel.z);let minimum=speed;
        for(let t=0;t<info.flight+3&&!u.onGround;t+=dt){
          g.physics(u,forward,false,false,dt);bounded();
          if(!u.onGround)minimum=Math.min(minimum,Math.hypot(u.vel.x,u.vel.z));
        }
        const forwardError=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
        ok(u.onGround&&forwardError<6&&minimum>=speed*.99,'前入力でも慣性を保って着地',
          {...info,speed,minimum,forwardError,end:u.pos.toArray()});
        reset(info.from,type);g.launch(u,cp);coast(1.1,dt);
        const beforeDash=u.boost;
        g.keys.KeyD=g.keys.ShiftLeft=g.pressed.ShiftLeft=true;g.playerUpdate(u,dt);clearKeys();
        ok(u.dashState==='short'&&u.boost<beforeDash,'1秒後にShiftで空中ダッシュ',info);
        reset(info.from,type);g.launch(u,cp);
        for(let t=0;t<info.flight+1&&u.vel.y>=-8&&!u.onGround;t+=dt)g.physics(u,zero,false,false,dt);
        ok(!u.onGround&&u.ctrlLockT===0,'降下中に操作可能',info);
        const beforeHover=u.boost,fall=u.vel.y;
        g.keys.Space=true;g.playerUpdate(u,dt);clearKeys();
        ok(u.dashState==='hover'&&u.boost<beforeHover&&u.vel.y>fall,'Spaceで降下を緩められる',
          {...info,fall,after:u.vel.y});
        rows.push({...info,peak,error,landing,forwardError,launchSpeed:speed,minimumSpeed:minimum,
          dashAfterOneSecond:true,hoverAfterOneSecond:true});
      }
      return rows;
    });

    await check('プラント射出台の両脇から利用',()=>{
      const {g,u,zero,ok,reset,bounded}=__halfCheck,rows=[];
      for(const cp of g.catapults.filter(c=>c.targetPlant))for(const type of ['light','heavy'])
        for(const team of ['B','R'])for(const dt of [1/30,1/120])for(const offset of [-1.5,1.5]){
          const from=cp.pos.clone();from.x+=offset;reset(from.toArray(),type,team);g.catapultUpdate(dt);
          ok(u.flying,'両軍とも台の端で射出',{type,team,dt,offset,from:from.toArray()});
          for(let t=0;t<(cp.flight??2.8)+3&&!u.onGround;t+=dt){g.physics(u,zero,false,false,dt);bounded();}
          const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z);
          ok(u.onGround&&error<6&&Math.abs(u.pos.y-cp.land.y)<.12,'中心以外からも安全に着地',
            {type,team,dt,offset,from:from.toArray(),error,end:u.pos.toArray()});
          rows.push({type,team,dt,offset,from:from.toArray(),error,end:u.pos.toArray()});
        }
      return rows;
    });

    await check('6ジャンプパッドの屋上往復',()=>{
      const {g,T,u,ok,reset,bounded}=__halfCheck,rows=[];
      for(const pad of g.jumpPads)for(const type of ['light','standard','heavy'])for(const team of ['B','R'])for(const dt of [1/30,1/120]){
        const info={pad:pad.id,from:pad.pos.toArray(),exit:pad.exit.toArray(),type,team,dt};
        reset(info.from,type,team);g.jumpPadUpdate(dt);
        ok(u.flying&&u.vel.x===0&&u.vel.z===0&&u.ctrlLockT===0,'中立パッドが真上へ打ち上げる',info);
        let landing=null,peak=u.pos.y;
        for(let t=0;t<12;t+=dt){
          const goal=g.botMobilityGoal(u,pad.exit),wish=goal.clone().sub(u.pos).setY(0);
          if(wish.length()>1)wish.normalize();else wish.set(0,0,0);
          g.physics(u,wish,false,false,dt);bounded();peak=Math.max(peak,u.pos.y);
          if(u.onGround){landing=u.pos.clone();break;}
        }
        ok(landing&&landing.y>=pad.exit.y-.05,'縮尺後の屋上へ到達',
          {...info,landing:landing?.toArray(),peak});
        ok(g.battle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'屋上着地で建物に埋まらない',info);
        // 街路の乗り場へ戻る側から降りる。反対側には別の屋根・高架が続く場合がある。
        const direction=pad.pos.clone().sub(pad.exit).setY(0).normalize();let left=false;
        for(let t=0;t<60;t+=dt){
          g.physics(u,direction,false,false,dt);bounded();
          if(u.onGround&&u.pos.y<.1){left=true;break;}
        }
        ok(left,'屋上から地上へ戻れる',{...info,end:u.pos.toArray()});
        rows.push({...info,peak,landing:landing.toArray(),ground:u.pos.toArray()});
      }
      return rows;
    });

    await check('Botによる全パッド利用',()=>{
      const {g,u,ok,reset,bounded}=__halfCheck,rows=[];
      for(const pad of g.jumpPads)for(const type of ['light','heavy'])for(const team of ['B','R']){
        reset(pad.pos.toArray(),type,team);u.isPlayer=false;u.role='attack';u.target=null;
        u.order={kind:'go',pos:pad.exit.clone(),until:Infinity};
        let used=false,landing=null;const trace=[];
        for(let t=0;t<20;t+=.05){
          g.botUpdate(u,.05);g.jumpPadUpdate(.05);bounded();
          if(Math.round(t*20)%10===0)trace.push({t,at:u.pos.toArray(),v:u.vel.toArray(),route:u.mobilityRoute?.kind,dash:u.dashState});
          used ||= u.jumpPad===pad;
          if(used&&u.onGround){landing=u.pos.toArray();break;}
        }
        const success=!!(used&&landing&&landing[1]>=pad.exit.y-.05);
        rows.push({pad:pad.id,type,team,used,success,from:pad.pos.toArray(),landing,
          exit:pad.exit.toArray(),...(success?{}:{trace})});
      }
      return rows;
    });
    const failedPads=results['Botによる全パッド利用'].filter(row=>!row.success);
    if(failedPads.length)console.error('Botパッド未到達:',JSON.stringify(failedPads.map(({type,team,from,landing,exit})=>({type,team,from,landing,exit}))));

    await check('両基地から各プラントへ徒歩',()=>{
      const {g,T,u,ok,reset,bounded}=__halfCheck,rows=[];
      for(const team of ['B','R'])for(const plant of g.plants){
        reset([0,0,0],'heavy',team);g.spawn(u,'base');
        const start=u.pos.toArray(),goal=plant.pos.clone().add(new T.Vector3(4,0,3));
        const nearest=p=>g.NAV.pts.map((q,i)=>[Math.hypot(q.x-p.x,q.z-p.z)+Math.abs(q.y-p.y)*3,i])
          .sort((a,b)=>a[0]-b[0]).find(([,i])=>{const q=g.NAV.pts[i];return g.clearPath(p.x,p.z,q.x,q.z,p.y);})?.[1];
        const a=nearest(u.pos),b=nearest(goal);
        ok(a!==undefined&&b!==undefined,'基地とプラントが徒歩経路に接続',{team,plant:plant.id});
        u.navW=new Float64Array(g.NAV.links.length).fill(1);
        const route=g.navPath(u,a,b);
        ok(route?.length,'全プラントへの経路あり',{team,plant:plant.id});
        const points=route.map(i=>g.NAV.pts[i]);points.push({x:goal.x,y:goal.y,z:goal.z});
        let index=0,time=0;
        for(;index<points.length&&time<360;time+=1/60){
          const next=points[index],wish=new T.Vector3(next.x-u.pos.x,0,next.z-u.pos.z);
          if(wish.length()<.35&&Math.abs(u.pos.y-next.y)<.6){index++;continue;}
          g.physics(u,wish.normalize(),false,false,1/60);bounded();
        }
        ok(index===points.length,'重機体がブースト・ジャンプなしで到着',
          {team,plant:plant.id,index,total:points.length,end:u.pos.toArray(),next:points[index]});
        rows.push({team,plant:plant.id,seconds:time,start,end:u.pos.toArray()});
      }
      return rows;
    });

    await check('占拠・再出撃・補給・防衛',()=>{
      const {g,T,u,ok,reset,bounded}=__halfCheck,captures=[],spawns=[],repairs=[],defenses=[],shelterExits=[];
      for(const plant of g.plants)for(const team of ['B','R']){
        reset([plant.pos.x+4,plant.pos.y,plant.pos.z+3],'heavy',team);plant.owner=null;plant.gauge=0;
        for(let i=0;i<240;i++)g.plantUpdate(plant,.05);
        ok(plant.owner===team,'本体の占拠で所有権変更',{id:plant.id,team,gauge:plant.gauge});
        captures.push([plant.id,team]);
        for(let i=0;i<16;i++){
          g.spawn(u,plant.id);bounded();
          ok(g.battle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'再出撃で建物に埋まらない',
            {plant:plant.id,team,at:u.pos.toArray()});
          ok(Math.abs(u.pos.y-g.terrainH(u.pos.x,u.pos.z))<.06,'再出撃は地上',u.pos.toArray());
          ok(Math.hypot(u.pos.x-plant.pos.x,u.pos.z-plant.pos.z)<60,'所有プラントの近くへ再出撃',
            {plant:plant.id,team,at:u.pos.toArray()});
          spawns.push({plant:plant.id,team,at:u.pos.toArray()});
        }
      }
      for(const pod of g.pods){
        const team=pod.team||'B';if(pod.plant)pod.plant.owner=team;
        reset(pod.pos.toArray(),'heavy',team);
        const before=u.hp=u.maxHp-3000;u.moveInput=false;u.podT=u.podN=0;
        const slot=u.slots.main;slot.ammo=Math.max(1,slot.w.mag-1);slot.reserve=0;slot.reloadT=0;
        for(let i=0;i<40;i++)g.podUpdate(pod,.05);
        ok(u.hp>before&&u.repairing&&slot.reserve>0,'ポッドで修理と補給',
          {plant:pod.plant?.id,at:pod.pos.toArray(),hp:u.hp,reserve:slot.reserve});
        repairs.push({plant:pod.plant?.id||null,team,healed:u.hp-before});
        if(['A','E'].includes(pod.plant?.id)){
          const sign=pod.plant.id==='A'?1:-1,direction=new T.Vector3(0,0,sign);let escaped=false;
          for(let t=0;t<12;t+=1/120){
            u.repairing=false;g.physics(u,direction,false,false,1/120);bounded();
            if((u.pos.z-pod.pos.z)*sign>10&&Math.abs(u.pos.y)<.05){escaped=true;break;}
          }
          ok(escaped,'縮小後の補給窪地から4m機体が徒歩で出られる',
            {plant:pod.plant.id,from:pod.pos.toArray(),end:u.pos.toArray()});
          shelterExits.push({plant:pod.plant.id,end:u.pos.toArray()});
        }
      }
      for(const radar of g.radars){
        const base=g.city.base(radar.team),team=radar.team==='B'?'R':'B';
        reset([base.at[0]+16,base.height,base.at[1]],'heavy',team);
        g.radarUpdate(radar,.05);ok(radar.intruders.includes(u),'レーダーが基地の敵を検知',radar.team);
      }
      for(const turret of g.turrets){
        const team=turret.team==='B'?'R':'B';let fired=false;
        for(let angle=0;angle<Math.PI*2&&!fired;angle+=Math.PI/6){
          const x=turret.pos.x+Math.cos(angle)*18,z=turret.pos.z+Math.sin(angle)*18,y=g.terrainH(x,z);
          if(Math.abs(x)>248.7||Math.abs(z)>248.7||!g.battle.free(x,z,y,g.obstacles))continue;
          reset([x,y,z],'heavy',team);u.invulT=0;u.cloak=false;u.group.position.copy(u.pos);g.scene.updateMatrixWorld(true);
          turret.think=turret.fireCd=0;turret.target=null;
          for(let i=0;i<120;i++)g.turretUpdate(turret,.05);
          fired=g.shells.some(s=>s.owner===turret);
        }
        ok(fired,'砲台が視認した敵を射撃',turret.pos.toArray());defenses.push(turret.pos.toArray());
      }
      return {captures,spawns,repairs,defenses,shelterExits};
    });

    await check('4辺と4隅の転落防止',()=>{
      const {u,zero,reset,coast}=__halfCheck,rows=[];
      for(const [x,z]of [[248,0],[-248,0],[0,248],[0,-248],[248,248],[-248,248],[248,-248],[-248,-248]]){
        reset([x,220,z]);u.onGround=false;u.vel.set(Math.sign(x)*600,0,Math.sign(z)*600);
        u.flying=true;u.flightSpeed=1000;coast(.3,1/120,zero);rows.push({from:[x,z],end:u.pos.toArray()});
      }
      return rows;
    });

    let state=null;
    if(seconds>0){
      await open();
      await page.evaluate(team=>{
        const g=__cityBattle;g.chosenTeam=team;g.setup();g.player.isPlayer=false;g.spawn(g.player,'base');
        g.renderer.render=()=>g.scene.updateMatrixWorld(true);g.running=true;window.battleStart=g.timeLeft;
        window.battleStats={kills:0,respawns:0,catapults:0,jumpPads:0,captures:[],maxShells:0,repairSeconds:0};
        window.wasAlive=new Map(g.units.map(u=>[u,u.alive]));window.wasFlying=new Map();
        window.owners=new Map(g.plants.map(p=>[p,p.owner]));
      },config.team);
      for(let time=0;time<seconds;time+=15){
        state=await page.evaluate(duration=>{
          const g=__cityBattle,s=battleStats;
          for(let frame=0;frame<Math.round(duration*20)&&!g.ended;frame++){
            testNow+=50;g.frame(testNow);
            for(const u of g.units){
              if(wasAlive.get(u)&&!u.alive)s.kills++;
              if(!wasAlive.get(u)&&u.alive)s.respawns++;
              wasAlive.set(u,u.alive);
              if(!wasFlying.get(u)&&u.flying){if(u.jumpPad)s.jumpPads++;else s.catapults++;}
              wasFlying.set(u,u.flying);if(u.repairing)s.repairSeconds+=.05;
              if(!u.pos.toArray().every(Number.isFinite)||Math.abs(u.pos.x)>248.701||
                Math.abs(u.pos.z)>248.701||u.pos.y<Math.min(-.1,(g.city.river?.bed??0)-.05))
                throw Error('Bot対戦中の座標異常 '+JSON.stringify({id:u.id,alive:u.alive,at:u.pos.toArray()}));
            }
            for(const plant of g.plants){
              if(owners.get(plant)!==plant.owner&&plant.owner)
                s.captures.push({plant:plant.id,team:plant.owner,seconds:battleStart-g.timeLeft});
              owners.set(plant,plant.owner);
            }
            s.maxShells=Math.max(s.maxShells,g.shells.length);
          }
          return {seconds:battleStart-g.timeLeft,ended:g.ended,core:[g.cores.B.hp,g.cores.R.hp],
            plants:g.plants.map(p=>[p.id,p.owner]),...s};
        },Math.min(15,seconds-time));
        console.log(`Bot戦 ${Math.round(state.seconds)}秒: 撃破${state.kills} 占拠${state.captures.length} 射出台${state.catapults} パッド${state.jumpPads}`);
        assert.deepEqual(errors,[],'対戦中のブラウザエラー');if(state.ended)break;
      }
      assert(state.seconds>=seconds-.1||state.ended,'指定時間まで対戦が進む');
      if(seconds>=150){
        assert(state.kills>0,'Botが交戦して撃破が発生');
        assert(new Set(state.captures.map(p=>p.plant)).size===5,'5プラントをBotが占拠できる');
        assert(state.catapults>0,'Botがカタパルトを使用');
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={config,facilities:results,battle:state,errors,externalRequests:external,offline:true};
    const record=process.argv[4]?`half-check-${config.team}-${config.seed}.json`:'half-check.json';
    fs.writeFileSync(path.join(folder,record),JSON.stringify(report,null,2)+'\n');
    assert.equal(failedPads.length,0,'全パッドを両軍の軽・重Botが利用できる');
    console.log('梅田半縮尺版：4m機体・施設・移動・オフライン検査成功');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
