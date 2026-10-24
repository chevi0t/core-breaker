// 通常本体が組み立てた地形・施設を俯瞰する。色・形・当たり判定の別模型は作らない。
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {build}=require('./build_hoshimichi_west_rebuild_battle.cjs');
const ROOT=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'/tmp/hoshimichi-west-facilities');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const dbg=path.join(out,'render-dbg');execFileSync('python3',['tools/test/make_dbg.py',dbg],{cwd:ROOT,stdio:'pipe'});const file=path.join(dbg,'dbg.html');build(file,file);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']}),errors=[];
 try{
  const page=await browser.newPage({offline:true,viewport:{width:1800,height:1150}});page.on('pageerror',e=>errors.push(e.stack));
  await page.addInitScript(()=>{
   requestAnimationFrame=()=>0;AudioContext=undefined;
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,options){return original.call(this,type,/^(webgl2?|experimental-webgl)$/.test(type)?{...options,preserveDrawingBuffer:true}:options);};
  });await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>window.__g);
  await page.evaluate(()=>{
   const g=__g,T=g.T;g.setup();g.running=false;for(const u of g.units)u.group.visible=false;
   const r=g.renderer;r.setSize(innerWidth,innerHeight);Object.assign(r.domElement.style,{display:'block',position:'fixed',inset:0,width:'100vw',height:'100vh'});g.scene.fog=null;g.scene.background=new T.Color('#26373f');
   // 本体のResizeObserverが参照する要素は保持し、画面だけ隠す。
   document.body.appendChild(r.domElement);
   for(const el of [...document.body.children])if(el!==r.domElement&&el.tagName!=='SCRIPT')el.style.display='none';
   Object.assign(document.body.style,{margin:0,background:'#26373f',overflow:'hidden'});
   g.scene.add(new T.HemisphereLight(0xe5f3ff,0x667571,.3));
   const camera=new T.OrthographicCamera(-600,600,400,-400,.1,10000),labels=[];
   function label(text,at,color){const el=document.createElement('div');el.textContent=text;Object.assign(el.style,{position:'fixed',padding:'3px 7px',background:'#15232be8',border:'1px solid '+color,borderRadius:'4px',color,font:'bold 14px system-ui',transform:'translate(-50%,-100%)',pointerEvents:'none'});document.body.append(el);labels.push({el,at});}
   for(const p of g.plants)label(p.id,p.pos.clone().add(new T.Vector3(0,10,0)),p.id==='A'?'#88d8ff':p.id==='E'?'#ffbc75':'#fff');
   for(const team of ['B','R'])label(team==='B'?'青基地':'橙基地',g.cores[team].pos.clone().add(new T.Vector3(0,8,0)),team==='B'?'#88d8ff':'#ffbc75');
   g.jumpPads.forEach((p,i)=>label('J'+(i+1),p.pos.clone().add(new T.Vector3(0,4,0)),'#8bf0c4'));
   function line(points,color,dashed=false){const m=new T.Line(new T.BufferGeometry().setFromPoints(points),dashed?new T.LineDashedMaterial({color,dashSize:3,gapSize:3,depthTest:false,transparent:true,opacity:.65}):new T.LineBasicMaterial({color,depthTest:false}));m.computeLineDistances();m.renderOrder=30;g.scene.add(m);}
   line([[-350,-175],[350,-175],[350,175],[-350,175],[-350,-175]].map(([x,z])=>new T.Vector3(x,1,z)),0xf4d35f);
   for(const cp of g.catapults){
    const points=[];for(let i=0;i<=64;i++){const t=i/64;points.push(new T.Vector3(cp.pos.x+(cp.land.x-cp.pos.x)*t,cp.pos.y+(cp.land.y-cp.pos.y)*t+.5*34*cp.flight**2*t*(1-t),cp.pos.z+(cp.land.z-cp.pos.z)*t));}
    line(points,cp.plant?0xffb16b:0xe4d686,true);
   }
   const header=document.createElement('div');Object.assign(header.style,{position:'fixed',left:'20px',top:'18px',padding:'14px 18px',borderRadius:'8px',border:'1px solid #627a84',background:'#16242bed',color:'#e6eef0',font:'14px system-ui'});header.innerHTML='<b style="font-size:21px">星路西街区・設備配置</b><br>ベース2 · プラント5 · カタパルト10 · ジャンプパッド8<br><span style="color:#f4d35f">黄色：進入範囲</span>　<span style="color:#8bf0c4">J：共有ジャンプパッド</span><br>点線：本体の射出式による無入力時の軌道';document.body.append(header);
   const footer=document.createElement('div');Object.assign(footer.style,{position:'fixed',right:'20px',bottom:'20px',padding:'10px 14px',borderRadius:'6px',background:'#16242bed',color:'#dbe7e9',font:'14px system-ui',lineHeight:1.8});footer.innerHTML='青：基地 → A → B<br>橙：基地 → E → D<br>進入範囲 700 × 350m · 縮尺1/2';document.body.append(footer);
   window.facilityView=(top=false)=>{
    const span=top?700:650,aspect=innerWidth/innerHeight,pitch=top?Math.PI/2-.000001:.85,yaw=top?0:.12,target=new T.Vector3(0,top?0:12,top?-25:0);
    Object.assign(camera,{left:-span*aspect/2,right:span*aspect/2,top:span/2,bottom:-span/2});camera.updateProjectionMatrix();camera.position.copy(target).add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(1600));camera.lookAt(target);camera.updateMatrixWorld(true);r.render(g.scene,camera);
    for(const {at,el} of labels){const p=at.clone().project(camera);el.style.left=(p.x+1)*innerWidth/2+'px';el.style.top=(1-p.y)*innerHeight/2+'px';}
   };facilityView();
  });
  await page.screenshot({path:path.join(out,'facilities-oblique.png')});await page.evaluate(()=>facilityView(true));await page.screenshot({path:path.join(out,'facilities-overview.png')});
  if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({views:2,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
