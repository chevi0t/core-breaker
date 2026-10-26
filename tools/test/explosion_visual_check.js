// 実際の爆発描画で時間変化・遮蔽・資源の再利用・上限・戦闘状態との分離を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const dir=path.resolve(process.argv[2]||'dbg/explosions'),out=path.resolve(process.argv[3]||path.join(dir,'results'));
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  fs.mkdirSync(out,{recursive:true});const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
  await page.goto('file://'+path.join(dir,'dbg.html'));
  const result=await page.evaluate(()=>{
   const g=__g,T=g.T,checks=[],yes=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
   g.selectMap('dock');document.getElementById('start').click();g.running=false;
   const at=new T.Vector3(0,200,0);g.camera.position.set(0,203,30);g.camera.lookAt(0,202,0);
   const state=()=>JSON.stringify({weapons:g.WEAPONS,units:g.units.map(u=>[u.hp,u.pos.toArray(),u.yaw,u.pitch,u.recoil,u.invulT]),lock:g.lock.target?.idx,shake:g.blastShake});
   const before=state(),random=Math.random;let consumed=0;Math.random=()=>{consumed++;return random();};
   try{g.boom(at);for(let i=0;i<10;i++)g.boomUpdate(.01);}finally{Math.random=random;}
   yes(consumed===0,'発生・資源作成・更新が戦闘用Math.randomを消費しない');
   yes(state()===before,'爆発演出だけでは耐久・武器・照準・反動・ロック・視界揺れを変えない');
   const batches=g.boomVisuals,all=()=>Object.values(batches),ids=all().map(b=>[b.mesh.uuid,b.geometry.uuid,b.mesh.material.uuid]);
   yes(all().length===5&&all().every(b=>b.mesh.material.depthTest&&!b.mesh.material.depthWrite),'共有5バッチで通常の遮蔽を維持する');
   yes(g.booms[0].at.equals(at.clone().add(new T.Vector3(0,2,0))),'従来の爆心の表示高さを維持する');
   function atTime(time,scale=1){g.clearBooms();g.boom(at,scale);g.boomUpdate(time);}
   atTime(.08);const big=Math.max(...batches.fire.attributes.size.array.slice(0,batches.fire.count));
   yes(batches.fire.count>0&&batches.sparks.count>0&&batches.rings.count>0,'起爆直後に火球・火花・衝撃波が出る');
   atTime(.08,.5);const small=Math.max(...batches.fire.attributes.size.array.slice(0,batches.fire.count));
   yes(big>small*1.6,'炸裂弾の小さい爆発を通常の爆発と区別する');
   atTime(.3);yes(batches.fire.count>0&&batches.smoke.count>0,'火球から煙へ移り変わる');
   atTime(.8);yes(batches.fire.count===0&&batches.rings.count===0&&batches.smoke.count>0,'閃光と衝撃波が消えてから煙が短く残る');
   g.boomUpdate(1);yes(g.booms.length===0&&all().every(b=>!b.mesh.visible&&b.geometry.drawRange.count===0),'寿命後は全バッチを非表示にする');
   // 共有描画物をそのまま独立した黒背景へ移し、壁による画素の遮蔽を確かめる。
   const fixture=new T.Scene();fixture.background=new T.Color(0);for(const b of all())fixture.add(b.mesh);
   const camera=new T.PerspectiveCamera(55,1,.1,1000);camera.position.set(0,202,30);camera.lookAt(0,202,0);
   const rt=new T.WebGLRenderTarget(128,128),pixels=new Uint8Array(128*128*4);
   const brightness=()=>{g.renderer.setRenderTarget(rt);g.renderer.render(fixture,camera);g.renderer.readRenderTargetPixels(rt,0,0,128,128,pixels);let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];return sum;};
   atTime(.08);const visible=brightness();
   const wall=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshBasicMaterial({color:0,side:T.DoubleSide}));wall.position.set(0,202,10);fixture.add(wall);
   const hidden=brightness();yes(visible>10000&&hidden<visible*.01,'不透明な壁の向こうに爆発を透かさない');
   fixture.remove(wall);wall.geometry.dispose();wall.material.dispose();
   // ウォームアップ後、何度発生しても同じ描画資源へ戻る。
   const memory=[];
   for(let round=0;round<5;round++){
    g.clearBooms();for(let i=0;i<g.BOOM_MAX;i++)g.boom(at.clone().add(new T.Vector3((i%8-3.5)*27,0,(Math.floor(i/8)-1.5)*27)));g.boomUpdate(.24);brightness();
    memory.push({...g.renderer.info.memory});yes(g.renderer.info.render.calls<=5,'同時32爆発でも追加描画は5回以下 '+round);
    for(const b of all())for(const a of Object.values(b.attributes))yes(a.array.every(Number.isFinite),'描画座標・色・サイズが有限 '+round);
   }
   yes(memory.slice(1).every(m=>m.geometries===memory[0].geometries&&m.textures===memory[0].textures),'反復後にGPU形状・テクスチャが増加しない');
   yes(JSON.stringify(ids)===JSON.stringify(all().map(b=>[b.mesh.uuid,b.geometry.uuid,b.mesh.material.uuid])),'メッシュ・形状・材質を使い回す');
   const started=performance.now();for(let i=0;i<120;i++){for(const b of g.booms)b.t=.2;g.boomUpdate(1/60);}const updateMeanMs=(performance.now()-started)/120;
   for(let i=0;i<500;i++)g.boom(at);yes(g.booms.length===g.BOOM_MAX,'連続発生の表示数を32件に制限する');
   const trajectory=[];
   for(const hz of [30,120]){atTime(0);g.booms[0].seed=123;for(let i=0;i<hz/2;i++)g.boomUpdate(1/hz);trajectory.push(Array.from(batches.smoke.attributes.position.array.slice(0,batches.smoke.count*3)));}
   yes(trajectory[0].length===trajectory[1].length&&trajectory[0].every((v,i)=>Math.abs(v-trajectory[1][i])<1e-4),'30Hzと120Hzで同じ時刻の煙の位置が一致する');
   g.renderer.setRenderTarget(null);rt.dispose();for(const b of all())g.scene.add(b.mesh);
   g.boom(at);g.setup();yes(g.booms.length===0&&all().every(b=>!b.mesh.visible),'再試合で爆発を消す');
   g.boom(at);g.buildMap('city');yes(g.booms.length===0&&all().every(b=>!b.mesh.visible),'マップ変更で爆発を消す');
   return {checks,maximumExplosions:g.BOOM_MAX,additionalDrawCalls:5,updateMeanMs,memory,wallPixels:{visible,hidden},glError:g.renderer.getContext().getError()};
  });
  assert.deepEqual(errors,[]);assert.equal(result.glError,0);
  fs.writeFileSync(path.join(out,'explosion-check.json'),JSON.stringify({...result,errors},null,2)+'\n');
  console.log(JSON.stringify({checks:result.checks.length,maximumExplosions:result.maximumExplosions,additionalDrawCalls:5,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
