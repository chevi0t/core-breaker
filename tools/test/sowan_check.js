// 双湾展示区：実際の都市当たり判定・射出・着地・境界と、既存マップへの切替を検査。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const dbg=path.resolve(process.argv[2]||'dbg'),out=path.resolve(process.argv[3]||'mapdesign/sowan');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 try{
  fs.mkdirSync(out,{recursive:true});const page=await browser.newPage({viewport:{width:1600,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto('file://'+path.join(dbg,'dbg.html'));await page.waitForFunction(()=>window.__g);
  const caps=JSON.parse(fs.readFileSync(path.join(__dirname,'../../mapdesign/sowan/generation.json'))).landingCaps;
  const result=await page.evaluate(caps=>{
   const g=__g,T=g.T;g.selectMap('sowan');g.setup();g.running=false;g.scene.updateMatrixWorld(true);
   const ok=(v,m,d)=>{if(!v)throw Error(m+' '+JSON.stringify(d));},u=g.player,zero=new T.Vector3();
   function reset(pos,type='heavy',team='B'){
    for(const k of Object.keys(g.keys))delete g.keys[k];for(const k of Object.keys(g.pressed))delete g.pressed[k];
    u.team=team;u.isPlayer=true;u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.equip(u,'assault');g.spawn(u,'base');u.pos.fromArray(pos);u.vel.set(0,0,0);u.boost=u.maxBoost;
    Object.assign(u,{onGround:true,catCd:0,stun:'',stunT:0,dashT:0,lungeT:0,recoverT:0,ctrlLockT:0,flying:false,jumpPad:null,planted:false,electricT:0,charging:false,chargerOn:false,repairing:false,overheat:false,transfer:null,downT:0});
    for(const other of g.units)other.alive=other===u;
   }
   ok(g.cityMap.extent[0]===825&&g.cityMap.extent[1]===312.5,'長方形の境界');
   ok(g.plants.length===4&&g.catapults.length===10&&g.radars.length===2,'施設数');
   const nav=g.cityBattle.navigationReport;
   const fixtures=[];
   for(const [team,slots] of Object.entries(g.curMap.cityBattle.baseSpawns))for(const p of slots){ok(g.cityBattle.free(p[0],p[1],0,g.obstacles),'基地の出撃点が空いている',{team,p});}
   for(const team of ['B','R'])for(const pl of g.plants)for(const p of g.curMap.cityBattle.respawns[team][pl.id]){
    const d=Math.hypot(p[0]-pl.pos.x,p[1]-pl.pos.z);ok(d>=46&&d<=52,'再出撃の距離',{team,plant:pl.id,p,d});ok(g.cityBattle.free(p[0],p[1],g.terrainH(...p),g.obstacles),'再出撃が建物や施設に埋まらない',{team,plant:pl.id,p});
   }
   const connections=[];
   const targets=[...g.plants.map(p=>[p.id,p.pos.x+4,p.pos.z+3]),...g.catapults.flatMap((cp,i)=>[[`cat${i}`,cp.pos.x,cp.pos.z],[`land${i}`,cp.land.x,cp.land.z]])];
   const start=g.curMap.cityBattle.baseSpawns.B[0],from=g.navNear(start[0],start[1],0,true);
   for(const [name,x,z] of targets){
    const to=g.navNear(x,z,0,false),p=g.NAV.pts[to];
    ok(g.clearPath(p.x,p.z,x,z,p.y),'施設が実際の経路へつながる',{name,x,z,nearest:p});
    ok(g.navPath({navW:g.NAV.links.map(()=>1)},from,to)?.length,'基地から施設まで地上経路がある',{name,x,z});connections.push(name);
   }
   const cats=[];
   for(const cp of g.catapults)for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const team of ['B','R']){
    reset(cp.pos.toArray(),type,team);g.catapultUpdate(dt);ok(u.flying,'カタパルトの接触射出');let peak=0;
    for(let t=0;t<(cp.flight??2.8)+3&&!u.onGround;t+=dt){g.physics(u,zero,false,false,dt);peak=Math.max(peak,u.pos.y);}
    const error=Math.hypot(u.pos.x-cp.land.x,u.pos.z-cp.land.z),info={from:cp.pos.toArray(),to:cp.land.toArray(),type,team,dt,error,end:u.pos.toArray(),peak};
    ok(u.onGround&&error<6&&Math.abs(u.pos.y-cp.land.y)<.2,'狙った場所へ着地',info);ok(u.ctrlLockT===0,'着地後の操作復帰',info);
    ok(g.cityBattle.free(u.pos.x,u.pos.z,u.pos.y,g.obstacles),'着地点が埋まっていない',info);
    // 着地地点から任意の開いた方向へ5m以上歩ける。
    const landed=u.pos.clone();let exited=false;
    for(let a=0;a<8&&!exited;a++){
     reset(landed.toArray(),type,team);const dir=new T.Vector3(Math.cos(a*Math.PI/4),0,Math.sin(a*Math.PI/4));
     for(let t=0;t<2;t+=dt)g.physics(u,dir,false,false,dt);
     exited=Math.hypot(u.pos.x-landed.x,u.pos.z-landed.z)>5;
    }
    ok(exited,'カタパルト着地後に退出できる',info);cats.push(info);
   }
   const edges=[];
   for(const p of [[900,70,0],[-900,70,0],[0,70,400],[0,70,-400]]){
    reset(p);g.physics(u,zero,false,false,1/30);ok(Math.abs(u.pos.x)<=823.701&&Math.abs(u.pos.z)<=311.201,'ステージ外へ落ちない',u.pos.toArray());edges.push(u.pos.toArray());
   }
   const roofLandings=[];
   for(const p of [...caps.map(c=>[...c.at,c.height]),[462,72,32],[488,98,32],[-492,200,54]]){
    reset([p[0],100,p[1]]);u.onGround=false;
    for(let t=0;t<8&&!u.onGround;t+=1/60)g.physics(u,zero,false,false,1/60);
    ok(u.onGround&&u.pos.y>=p[2]-.5,'塞いだ穴の底へ落ちない',{p,end:u.pos.toArray()});
    const landed=u.pos.clone();let escaped=false;
    for(let a=0;a<16&&!escaped;a++){
     reset(landed.toArray());const dir=new T.Vector3(Math.cos(a*Math.PI/8),0,Math.sin(a*Math.PI/8));
     for(let t=0;t<12;t+=1/30){g.physics(u,dir,false,t===0,1/30);if(u.pos.y<.1&&u.onGround){escaped=true;break;}}
    }
    ok(escaped,'穴埋めした屋上から地上へ退出可能',{p,landed:landed.toArray()});roofLandings.push(landed.toArray());
   }
   const shore=[];
   for(const z of [-50,80,200])for(let x=-800;x<800;x+=2){
    if(shore.length>=4)break;
    for(const sign of [-1,1]){
     if(g.terrainH(x,z)>-3||g.terrainH(x+sign*5,z)<-.1||!g.cityBattle.free(x+sign*7,z,0,g.obstacles))continue;
     reset([x,-4,z]);const dir=new T.Vector3(sign,0,0);let back=false;
     for(let t=0;t<3;t+=1/60){g.physics(u,dir,false,t===0,1/60);if(u.onGround&&u.pos.y>-.1){back=true;break;}}
     ok(back,'水底から通常ジャンプで岸へ戻れる',{from:[x,-4,z],end:u.pos.toArray()});shore.push({from:[x,z],end:u.pos.toArray()});break;
    }
   }
   ok(shore.length===4,'水辺の復帰地点を4箇所検査');
   window.sowanInspection={g,reset};
   return {navigation:nav,connections,cats,roofLandings,shore,boundaries:edges,plants:g.curMap.plants,geometry:g.cityMap.geometryStats};
  },caps);
  assert.deepEqual(errors,[]);console.log('施設・再出撃・全射出80条件・屋上脱出・水辺復帰・長方形境界：成功');
  await page.evaluate(()=>{const g=__g;window.sowanFog=g.scene.fog;g.scene.fog=null;g.camera.position.set(0,1000,550);g.camera.lookAt(0,0,-15);g.camera.far=6000;g.camera.updateProjectionMatrix();document.querySelectorAll('body > :not(canvas)').forEach(e=>e.style.visibility='hidden');g.renderer.domElement.id='sowan-test-render';g.renderer.domElement.style.visibility='visible';g.renderer.render(g.scene,g.camera);});
  await page.locator('#sowan-test-render').screenshot({path:path.join(out,'overview-3d.png')});
  await page.evaluate(()=>{const g=__g;g.camera.position.set(580,105,180);g.camera.lookAt(475,15,85);g.renderer.domElement.id='sowan-test-render';g.renderer.domElement.style.visibility='visible';g.renderer.render(g.scene,g.camera);});
  await page.locator('#sowan-test-render').screenshot({path:path.join(out,'landmark-3d.png')});
  const switches=await page.evaluate(()=>{
   const g=__g,rows=[];g.scene.fog=window.sowanFog;
   for(const id of ['city','hoshimichi','kanto','sowan','wide','sowan']){g.selectMap(id);g.setup();rows.push({id,size:g.curMap.size,extent:g.cityMap?.extent||null});}
   return rows;
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify({...result,switches,errors},null,2)+'\n');console.log('通常マップとの切替・ブラウザエラーなし');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
