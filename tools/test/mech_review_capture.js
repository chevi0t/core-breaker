// #15レビューの修正前後を同じカメラで実描画する。公式素材は使用しない。
// node tools/test/mech_review_capture.js dbg/review15-before,dbg/review15 media/mech-animation/review
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const dirs=process.argv[2].split(',').map(p=>path.resolve(p)),out=path.resolve(process.argv[3]),results=[];
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{for(const dir of dirs){
  const page=await browser.newPage({viewport:{width:720,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await page.goto('file://'+path.join(dir,'dbg.html'));
  await page.evaluate(()=>{
   const g=__g,T=g.T;g.running=false;g.renderer.render=()=>{};
   const sc=new T.Scene();sc.background=new T.Color(0x182b3b);sc.add(new T.HemisphereLight(0xf0f8ff,0x394455,1.2));
   const light=new T.DirectionalLight(0xffffff,1.1);light.position.set(-4,9,-6);sc.add(light);sc.add(new T.GridHelper(20,20,0xb3c4cf,0x385469));
   const cam=new T.PerspectiveCamera(42,720/600,.1,80);
   document.body.insertAdjacentHTML('beforeend','<canvas id="review" style="position:fixed;inset:0;z-index:10000"></canvas><div id="caption" style="position:fixed;z-index:10001;left:22px;top:18px;color:white;font:18px sans-serif;white-space:pre-line"></div>');
   const ren=new T.WebGLRenderer({canvas:document.getElementById('review'),antialias:true,preserveDrawingBuffer:true});ren.setSize(720,600);
   window.__review={sc,cam,ren,u:null};
  });
  const label=path.basename(dir).endsWith('-before')?'修正前':'修正後';
  for(const key of ['bastion-crouch','bastion-land','sword','spear']){
   const result=await page.evaluate(({key,label})=>{
    const g=__g,T=g.T,r=__review;if(r.u){r.sc.remove(r.u.group);g.disposeMech(r.u.group);}
    const legs=key.startsWith('bastion')?'bastion':'standard',cfg=Object.fromEntries(['head','body','arms','legs'].map(s=>[s,legs]));
    const m=g.buildMech(g.TEAM.B.color,{...cfg,color:'ash'}),u=r.u={...m,group:m.g,pos:new T.Vector3(),vel:new T.Vector3(),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(s==='aux'&&!key.startsWith('bastion')?key:g.loadout.assault[s])])),weapon:key.startsWith('bastion')?'main':'aux',swing:null,planted:key.startsWith('bastion')};
    r.sc.add(u.group);g.weaponLook(u,0);
    if(key==='bastion-land'){g.land(u,36);for(let f=0;f<6;f++)g.weaponLook(u,.025);}
    u.group.updateMatrixWorld(true);
    let minLegY=Infinity;const mesh=u.rig.meshes.find(q=>q.mesh.userData.armorSlot==='legs').mesh,p=mesh.geometry.attributes.position,v=new T.Vector3();
    for(let i=0;i<p.count;i++)minLegY=Math.min(minLegY,v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).y);
    if(key.startsWith('bastion')){r.cam.position.set(5,2.8,-7.5);r.cam.lookAt(0,1.25,0);}else{r.cam.position.set(8,5.5,-12);r.cam.lookAt(0,2.2,0);}
    r.ren.render(r.sc,r.cam);document.getElementById('caption').textContent=label+'　'+({'bastion-crouch':'重装機の屈み','bastion-land':'屈み＋着地','sword':'通常剣の待機','spear':'槍の待機'}[key])+'\n脚装甲の最下点 '+minLegY.toFixed(3)+' m ／ 刃の長さ倍率 '+u.blade.scale.z.toFixed(2);
    return{key,minLegY,bladeScale:u.blade.scale.z};
   },{key,label});
   const file=path.basename(dir)+'-'+key+'.png';await page.screenshot({path:path.join(out,file)});results.push({dir:path.basename(dir),...result,file});
  }
  const stats=await page.evaluate(()=>({weapons:__g.WEAPONS,parts:__g.PARTS,armory:__g.ARMORY}));fs.writeFileSync(path.join(out,path.basename(dir)+'-stats.json'),JSON.stringify(stats,null,2)+'\n');
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'poses.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
