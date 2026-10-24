// 本体の実機体で進入境界・警告・試走・切替を検査する。画像や大量ログは端末へ出さない。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {build,ID}=require('../build_hoshimichi_west_walk.cjs');
const ROOT=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-walk-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const dbg=path.join(out,'dbg');
 execFileSync('python3',['tools/test/make_dbg.py',dbg],{cwd:ROOT});
 const debugFile=path.join(out,'walk-dbg.html'),normalFile=path.join(out,'walk.html');
 build(debugFile,path.join(dbg,'dbg.html'));const generated=build(normalFile);
 // 本体と単独プレビューは同じ保存形式の復元器を使う。
 const engine=fs.readFileSync(path.join(ROOT,'prototype/index.html'),'utf8');
 const codec=fs.readFileSync(path.join(ROOT,'tools/city_volume_codec.js'),'utf8').split("if (typeof module")[0];
 assert(engine.includes(codec));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
 const errors=[],requests=[];
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
  await page.goto(pathToFileURL(debugFile).href);await page.waitForFunction(()=>window.__g);
  const tests=await page.evaluate(()=>{
   const g=__g,T=g.T,c=g.cityMap,result={};let checks=0;
   const ok=(v,msg)=>{checks++;if(!v)throw Error(msg);},near=(a,b)=>Math.abs(a-b)<1e-6;
   g.setup();const p=g.player;g.renderer.render=()=>{};
   ok(g.units.length===1&&!g.cityBattle&&!g.plants.length&&!g.pods.length&&!g.turrets.length,'試走にBOTや施設を置かない');
   ok(c.volumes.length===2210&&typeof g.curMap.cityTerrain.volumes==='string','整数列を元データを変えずに読む');
   const vector=(x,y,z)=>new T.Vector3(x,y,z);
   // 四辺・四隅。高さに関係なく機体半径が内側に入り、接線・内向きの速度が残る。
   for(const y of [-5,0,200,1000])for(const [axis,i] of [['x',0],['z',2]])for(const sign of [-1,1]){
    const other=axis==='x'?'z':'x',edge=c.playBounds[i+(sign>0?1:0)];
    for(const direction of [-1,1]){
     const u={pos:vector(0,y,0),vel:vector(7,3,9)};u.pos[axis]=edge+sign*25;u.vel[axis]=direction*sign*20;
     const tangent=u.vel[other];c.clampToBounds(u);
     ok(near(u.pos[axis],edge-sign*1.3)&&u.pos.y===y,'半径を含め地上・空中で四辺を止める');
     ok(u.vel[axis]===(direction>0?0:direction*sign*20)&&u.vel[other]===tangent&&u.vel.y===3,'接線と内向き速度を保つ');
    }
   }
   for(const sx of [-1,1])for(const sz of [-1,1]){const u={pos:vector(sx*500,300,sz*500),vel:vector(sx*200,5,sz*200)};c.clampToBounds(u);ok(near(u.pos.x,sx*348.7)&&near(u.pos.z,sz*173.7)&&u.vel.x===0&&u.vel.z===0,'角の二辺を止める');}
   const walls=c.boundaryWarnings;
   ok(walls.length===4&&!walls.some(w=>g.hittables.includes(w)),'警告壁を射線・カメラの障害物にしない');
   for(const [axis,i] of [['x',0],['z',2]])for(const sign of [-1,1]){
    const edge=c.playBounds[i+(sign>0?1:0)];
    for(const distance of [8.1,7.9,4,0]){
     p.pos.set(0,50,0);p.pos[axis]=edge-sign*(1.3+distance);c.updateBoundary(p);
     const visible=walls.filter(w=>w.visible);ok(visible.length===(distance<8?1:0),'8m手前から近い辺だけ表示');
     if(distance<8){const w=visible[0];ok(near(w.position.y,54)&&w.geometry.parameters.width===16&&w.geometry.parameters.height===8&&w.material.color.getHex()===0xffd447,'近傍16m幅・8m高の黄色い半透明壁');}
    }
   }
   p.pos.set(348.7,250,173.7);c.updateBoundary(p);ok(walls.filter(w=>w.visible).length===2,'空中の角では二辺を表示');
   c.updateBoundary(null);ok(walls.every(w=>!w.visible),'停止中・死亡時は警告を隠す');
   // 正式な移動計算で歩行・ダッシュ・近接踏込み・被弾・射出の境界を確認する。
   const reset=()=>{g.spawn(p);p.pos.set(0,250,0);p.onGround=false;p.stun='';p.recoverT=p.electricT=0;p.vel.set(0,0,0);};
   const modes=['walk','dash','lunge','knockback','catapult','hover'];result.physics=[];
   for(const isPlayer of [true,false])for(const [axis,i] of [['x',0],['z',2]])for(const sign of [-1,1])for(const mode of modes){
    reset();p.isPlayer=isPlayer;const edge=c.playBounds[i+(sign>0?1:0)],wish=vector(0,0,0);wish[axis]=sign;p.pos[axis]=edge-sign*1.4;p.vel[axis]=sign*100;
    if(mode==='dash'){p.dashT=.24;p.dashDir.copy(wish);}
    if(mode==='lunge'){p.lungeT=p.lungeT0=.3;p.lungeSpeed=80;p.lungeDir.copy(wish);}
    if(mode==='knockback'){p.stun='down';p.stunT=1;}
    if(mode==='catapult'){p.flying=true;p.flightSpeed=100;p.ctrlLockT=.2;}
    for(let n=0;n<12;n++){
     g.physics(p,wish,mode==='dash',false,.05,mode==='hover');
     ok(Math.abs(p.pos.x)<=348.700001&&Math.abs(p.pos.z)<=173.700001,'移動中に境界を越えない '+mode);
    }
    result.physics.push({mode,axis,sign,isPlayer});
   }
   p.isPlayer=true;
   result.walks=[];
   for(const start of g.curMap.walkStarts){
    const paths=[];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     reset();p.pos.fromArray(start.at);p.onGround=true;const wish=vector(dx,0,dz);
     for(let n=0;n<30;n++)g.physics(p,wish,false,false,.05);
     const moved=Math.hypot(p.pos.x-start.at[0],p.pos.z-start.at[2]);paths.push({dir:[dx,dz],moved,end:p.pos.toArray()});
     ok(p.pos.toArray().every(Number.isFinite)&&p.pos.y>=-5,'試走位置が有限で川底より下へ落ちない');
    }
    ok(Math.max(...paths.map(p=>p.moved))>3,'各開始地点で実機体が移動できる');
    reset();p.pos.fromArray(start.at);p.onGround=true;g.physics(p,vector(0,0,0),false,true,.05,true);ok(p.pos.y>0&&!p.onGround,'実機体がジャンプできる');
    result.walks.push({label:start.label,paths,jumpY:p.pos.y});
   }
   g.spawn(p);g.running=true;g.timeLeft=.01;for(let n=0;n<10;n++)g.loop(performance.now()+n*50);
   ok(g.timeLeft===.01&&!g.ended&&document.getElementById('timer').textContent==='地形試走','試走は時間切れにならない');
   // 背景の外側にだけ遠景床を作り、川の上へ新しい床を重ねない。
   let apron=null;g.scene.traverse(m=>{if(m.name==='city-distant-ground')apron=m;});ok(!!apron&&!g.hittables.includes(apron),'遠景の床に接触を付けない');
   const a=apron.geometry.attributes.position.array;for(let i=0;i<a.length;i+=9){const x=(a[i]+a[i+3]+a[i+6])/3,z=(a[i+2]+a[i+5]+a[i+8])/3;ok(Math.abs(x)>=450||Math.abs(z)>=275,'遠景床が川や街の内側を覆わない');}
   result.checks=checks;result.geometry=c.geometryStats;return result;
  });
  // 同じページ内で既存都市と往復し、旧警告を含め資源・表示状態の残留を確認する。
  const mapsCode=fs.readFileSync(path.join(ROOT,'prototype/maps.js'),'utf8');
  const vm=require('node:vm'),ctx={window:{}};vm.runInNewContext(mapsCode,ctx);
  const legacy=JSON.parse(JSON.stringify(ctx.window.MAP_DATA));
  const switches=await page.evaluate(({legacy,ID})=>{
   const g=__g;Object.assign(g.MAPS,legacy);const first=g.cityMap;const rows=[];
   for(const id of ['hoshimichi','kanto','city',ID,'dock',ID]){
    const old=g.cityMap,walls=old?.boundaryWarnings||[];g.running=false;g.selectMap(id);g.setup();
    if(old&&old!==g.cityMap&&old.cameraGeometryCount!==0)throw Error('旧カメラ形状が残留');
    if(walls.length)throw Error('旧警告メッシュが残留');
    if(id===ID){if(g.units.length!==1||g.cityMap.boundaryWarnings.length!==4)throw Error('試走への復帰が不正');}
    else if(g.units.length<4||document.querySelector('#top .core').hidden)throw Error('通常対戦への復帰が不正');
    if(['hoshimichi','kanto'].includes(id)&&g.cityMap.clampToBounds!==null)throw Error('旧都市の範囲を変更');
    rows.push({id,units:g.units.length,warnings:g.cityMap?.boundaryWarnings.length||0});
   }
   return rows;
  },{legacy,ID});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await page.close();
  // デバッグ版ではないHTMLを描画し、通常の出撃・W・Shift・Space入力を通す。
  const normal=await browser.newPage({offline:true,viewport:{width:1280,height:900}});normal.on('pageerror',e=>errors.push(e.stack));normal.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await normal.addInitScript(()=>{
   AudioContext=undefined;
   // 本体の関数や入力を差し替えず、描画へ渡された機体とフレームだけを観測する。
   let three;
   Object.defineProperty(window,'THREE',{configurable:true,get:()=>three,set:value=>{
    three=value;let Renderer;
    Object.defineProperty(value,'WebGLRenderer',{configurable:true,get:()=>Renderer,set:Original=>{
     Renderer=function(...args){const r=new Original(...args),render=r.render.bind(r);r.render=(scene,camera)=>{
      if(!window.walkPlayer)scene.traverse(m=>{if(m.userData.ref?.kind==='unit'&&m.userData.ref.isPlayer){window.walkPlayer=m.userData.ref;window.walkRenderer=r;}});
      return render(scene,camera);
     };return r;};Renderer.prototype=Original.prototype;
    }});
   }});
  });
  normal.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await normal.goto(pathToFileURL(normalFile).href);await normal.locator('#start').click();await normal.waitForFunction(()=>window.walkPlayer?.alive);
  const start=await normal.evaluate(()=>walkPlayer.pos.toArray());
  await normal.keyboard.down('KeyW');await normal.waitForFunction(([x,,z])=>Math.hypot(walkPlayer.pos.x-x,walkPlayer.pos.z-z)>2,start);
  await normal.keyboard.down('ShiftLeft');await normal.waitForFunction(()=>!!walkPlayer.dashState);
  await normal.keyboard.up('ShiftLeft');await normal.keyboard.up('KeyW');
  await normal.waitForFunction(()=>walkPlayer.onGround&&!walkPlayer.stun);const baseY=await normal.evaluate(()=>walkPlayer.pos.y);
  await normal.keyboard.down('Space');await normal.waitForFunction(y=>walkPlayer.pos.y>y+.3,baseY);await normal.keyboard.up('Space');
  const input=await normal.evaluate(()=>({end:walkPlayer.pos.toArray(),renderedTriangles:walkRenderer.info.render.triangles}));
  assert(input.renderedTriangles>0);
  assert.equal(await normal.locator('#timer').textContent(),'地形試走');assert.equal(await normal.evaluate(()=>window.__g===undefined),true);
  await normal.keyboard.press('KeyM');assert.equal(await normal.locator('#bigMap').isVisible(),true);await normal.keyboard.press('KeyM');
  await normal.screenshot({path:path.join(out,'walk.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.writeFileSync(path.join(out,'walk-check.json'),JSON.stringify({generated,...tests,switches,normalInput:{start,...input},errors,externalRequests:requests},null,2)+'\n');
  console.log(`境界・警告・実機体の移動 ${tests.checks}項目、既存マップとの切替、通常HTMLの入力：成功。エラー0、外部通信0`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
