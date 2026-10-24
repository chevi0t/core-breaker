// 再構築地形を本体へ一時的に読み、川の復帰・空中着地・候補地・単独3D表示を検査する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {inlineGame}=require('../build_hoshimichi_west_walk.cjs');
const ROOT=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-rebuild-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const folder=path.join(ROOT,'mapdesign/hoshimichi_west/rebuild');
 const city=JSON.parse(fs.readFileSync(path.join(folder,'layout.json'))),generation=JSON.parse(fs.readFileSync(path.join(folder,'generation.json'))),approved=JSON.parse(fs.readFileSync(path.join(ROOT,'mapdesign/hoshimichi_west/layout-proposal.json')));
 const starts=[...approved.bases.map(q=>({label:q.team,at:[q.at[0],0,q.at[1]]})),...approved.plants.map(q=>({label:q.id,at:[q.at[0],0,q.at[1]]}))];
 city.spawns=[starts[0].at];
 const def={name:'星路西街区 地形確認',desc:'再構築した地形の確認用',size:[450,450],team:2,time:300,baseZ:400,baseLine:380,terrain:[],layout:[],plants:[],turrets:[],radar:[],catapults:[],basePods:[],plantPods:[],barricades:[],nav:[],walkOnly:true,asym:true,cityTerrain:city,walkStarts:starts};
 const dbg=path.join(out,'dbg');execFileSync('python3',['tools/test/make_dbg.py',dbg],{cwd:ROOT,stdio:'pipe'});const file=path.join(out,'rebuild-debug.html');inlineGame(file,path.join(dbg,'dbg.html'),def,'hoshimichi-west-rebuild-walk');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']}),errors=[],external=[];
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.__g).catch(e=>{throw Error(errors.join('\n')||e.message);});
  const physical=await page.evaluate(({starts,generation})=>{
   const g=__g;g.setup();g.running=false;g.renderer.render=()=>{};const u=g.player,T=g.T,zero=new T.Vector3();let checks=0;
   const ok=(v,m)=>{checks++;if(!v)throw Error(m);};
   ok(g.units.length===1&&!g.plants.length&&!g.turrets.length,'地形段階に対戦施設を追加しない');
   function fresh(at){g.spawn(u);u.pos.fromArray(at);u.vel.set(0,0,0);u.onGround=true;u.stun='';u.electricT=u.recoverT=0;u.flying=false;u.ctrlLockT=0;}
   for(const q of starts){fresh(q.at);const before=u.pos.clone();g.resolve(u);ok(before.distanceTo(u.pos)<.03&&Math.abs(g.groundAt(u.pos.x,u.pos.z,0))<.02,'施設候補地の平地 '+q.label);}
   const ramps=[];
   for(const r of g.cityMap.river.exits){
    fresh(r.start);const wish=new T.Vector3();let arrived=true;
    for(const target of [r.end,r.street]){
     let reached=false;for(let i=0;i<1200;i++){const dx=target[0]-u.pos.x,dz=target[2]-u.pos.z,d=Math.hypot(dx,dz);if(d<.15){reached=true;break;}wish.set(dx/d,0,dz/d);g.physics(u,wish,false,false,1/60);}arrived&&=reached;
    }
    ok(arrived&&u.pos.y>-.1,'川底からブーストなしで街路へ戻る '+JSON.stringify({start:r.start,goal:r.street,end:u.pos.toArray(),samples:[0,.25,.5,.75,1].map(t=>{const x=r.start[0]+(r.end[0]-r.start[0])*t,z=r.start[2];return [x,g.terrainH(x,z),z];})}));ramps.push({from:r.start,to:r.street,end:u.pos.toArray()});
   }
   const landings=[];
   for(const cap of generation.landingPocketCaps){
    const [x,z]=cap.at;ok(Math.abs(g.groundAt(x,z,cap.height+.05)-cap.height)<.03,'閉所を塞いだ面と接触の高さ');
    fresh([x,150,z]);u.onGround=false;for(let i=0;i<1200&&!u.onGround;i++)g.physics(u,zero,false,false,1/120);
    ok(u.onGround&&u.pos.y>=cap.height-.03,'空中から修正箇所へ着地');const landed=u.pos.toArray();let escaped=null;
    for(let direction=0;direction<16&&!escaped;direction++){
     fresh(landed);const a=direction*Math.PI/8,wish=new T.Vector3(Math.cos(a),0,Math.sin(a));
     for(let i=0;i<1800;i++){g.physics(u,wish,false,false,1/60);if(u.onGround&&Math.abs(u.pos.y)<.05&&Math.hypot(u.pos.x-x,u.pos.z-z)>5){escaped=u.pos.toArray();break;}}
    }
    ok(!!escaped,'修正箇所の屋根から歩いて街路へ下りる');landings.push({at:cap.at,landed,escaped});
   }
   g.drawBigMap();ok(u.pos.toArray().every(Number.isFinite),'全体マップ描画で川の出口も読める');
   return {checks,ramps,landings};
  },{starts,generation});
  await page.close();
  const preview=await browser.newPage({offline:true,viewport:{width:1800,height:1150}});preview.on('pageerror',e=>errors.push(e.stack));preview.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await preview.goto(pathToFileURL(path.join(folder,'preview.html')).href);await preview.waitForSelector('body[data-ready="true"]');
  const triangles=await preview.evaluate(()=>__preview.renderer.info.render.triangles);assert(triangles>0);
  await preview.selectOption('#heading','crop');await preview.click('#oblique');await preview.screenshot({path:path.join(out,'rebuild-oblique.png')});
  await preview.click('#top');await preview.screenshot({path:path.join(out,'rebuild-overview.png')});
  await preview.click('#akiba');await preview.screenshot({path:path.join(out,'rebuild-station.png')});
  await preview.click('#west');await preview.screenshot({path:path.join(out,'rebuild-west.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify({physical,renderedTriangles:triangles,errors,externalRequests:external},null,2)+'\n');
  console.log(JSON.stringify({checks:physical.checks,riverExits:physical.ramps.length,landingEscapes:physical.landings.length,renderedTriangles:triangles,errors,externalRequests:external}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
