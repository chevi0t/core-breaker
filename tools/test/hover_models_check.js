// node tools/test/hover_models_check.js dbg/models dbg/models-base [画像・記録の出力先]
// 試作の承認済み形状、全ホバー型の混成、旧版の脚被弾形状、噴射と解放を確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const dir=path.resolve(process.argv[2]||'dbg/models'),base=path.resolve(process.argv[3]||'dbg/models-base'),out=path.resolve(process.argv[4]||'dbg/hover-models');
const accepted=require('../../media/hover-models/accepted.json');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function probe(){
 const g=__g,T=g.T,rows=[],yes=(ok,msg)=>{if(!ok)throw Error(msg);};
 g.renderer.render=()=>{};g.selectMap('dock');g.setup();g.running=false;
 const digest=async arrays=>{const size=arrays.reduce((n,a)=>n+a.byteLength,0),bytes=new Uint8Array(size);let offset=0;for(const a of arrays){bytes.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),offset);offset+=a.byteLength;}return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');};
 const fixture=cfg=>{const m=g.buildMech(g.TEAM.B.color,cfg);m.g.position.set(0,20,0);return {...m,group:m.g,mech:cfg,stats:g.mechStats(cfg,g.loadout.assault),slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',pos:new T.Vector3(0,20,0),vel:new T.Vector3(),yaw:0,pitch:0,recoil:0,alive:true,onGround:true,boost:100,overheat:false,planted:false,repairing:false,stun:'',downT:0,cannonDeploy:0};};
 const pose=(u,name)=>{Object.assign(u,{onGround:name!=='air',planted:name==='planted',repairing:name==='repair',transfer:name==='transfer'?{t:1}:null,downT:name==='down'?1:0,dashState:name==='dash'?'long':''});u.vel.set(0,name==='air'?-2:0,name==='walk'?-5:0);for(let i=0;i<30;i++){u.pos.z+=u.vel.z/60;g.weaponLook(u,1/60);}u.g.updateMatrixWorld(true);};
 for(const family of ['wisp','skimmer','anchor'])for(const legs of g.PART_SERIES[family].types)for(const upper of ['light3','standard','heavy3']){
  const cfg={head:upper,body:upper,arms:upper,legs,color:'ash'},u=fixture(cfg),leg=u.rig.meshes.find(m=>m.mesh.userData.armorSlot==='legs').mesh,hit=leg.userData.hitGeometry||leg.geometry,hasProxy=!!leg.userData.hitGeometry;
  const row={family,cfg,hasProxy,displayTriangles:u.rig.meshes.reduce((n,m)=>n+m.pos.length/9,0),poses:[]};
  yes(u.rig.meshes.length===4,'装甲4メッシュ');yes(new Set(u.rig.meshes.map(m=>m.mesh.material)).size===1,'装甲材質1つ');
  if(upper==='standard'&&legs===family){const data=u.rig.meshes.map(m=>({pos:Array.from(m.pos),nor:Array.from(m.nor),col:Array.from(m.mesh.geometry.attributes.color.array)}));data.push(Array.from(u.hoverJet.userData.rest||u.hoverJet.geometry.attributes.position.array));row.approvedInput=JSON.stringify(data);}
  for(const name of ['stand','walk','dash','air','planted','repair','transfer','down']){
   pose(u,name);
   const display=leg.geometry.attributes.position.array;let minY=Infinity;for(let i=1;i<display.length;i+=3)minY=Math.min(minY,display[i]);yes(minY>=-.05,family+'/'+name+'で脚が床に埋まる');
   for(const m of u.rig.meshes)for(const key of ['position','normal'])yes(m.mesh.geometry.attributes[key].array.every(Number.isFinite),family+'/'+name+'の頂点・法線');
   const rays=[];
   for(const height of [.4,.8,1.3])for(const lateral of [-1.4,-1,-.6,0,.6,1,1.4])for(const side of ['front','back','left']){
    const from=side==='left'?new T.Vector3(-4,20+height,lateral):new T.Vector3(lateral,20+height,side==='front'?-4:4),direction=side==='left'?new T.Vector3(1,0,0):new T.Vector3(0,0,side==='front'?1:-1),hits=new T.Raycaster(from,direction,0,10).intersectObject(leg,false);
    yes(leg.geometry!==leg.userData.hitGeometry,'raycast後に描画形状へ戻す');rays.push(hits.length?hits.map(h=>[h.distance,...h.face.normal.toArray()]):null);
   }
   if(hasProxy){
    yes(u.hoverJet.visible===g.hoverActive(u),family+'/'+name+'の噴射停止');
    if(u.hoverJet.visible)for(const range of u.hoverJet.userData.ranges){const wanted=new T.Vector3().fromArray(u.hoverJet.userData.rest,range.start).applyMatrix4(u.rig.bones[range.bone].matrix),actual=new T.Vector3().fromArray(u.hoverJet.geometry.attributes.position.array,range.start);yes(wanted.distanceTo(actual)<1e-5,'膝と噴射口の同期');}
   }
   row.poses.push({name,minY,jetVisible:u.hoverJet.visible,hitHash:await digest([hit.attributes.position.array,hit.attributes.normal.array]),rays});
  }
  if(hasProxy){
   yes(u.hoverJet.userData.visualOnly&&new T.Raycaster().intersectObject(u.hoverJet).length===0,'炎を被弾面にしない');
   for(const flow of u.hoverJet.userData.flows){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=flow.start;i<flow.end;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],u.hoverJet.userData.rest[i+k]);max[k]=Math.max(max[k],u.hoverJet.userData.rest[i+k]);}if(flow.kind==='cover')yes(min[2]>=flow.origin[2]-1e-5&&max[2]>flow.origin[2]+.5,'カバーは後方噴射');else yes(max[1]<=flow.origin[1]+1e-5&&min[1]<flow.origin[1]-.2,'ふくらはぎは下方噴射');}
   let displayFreed=0,hitFreed=0,jetFreed=0,matFreed=0;leg.geometry.addEventListener('dispose',()=>displayFreed++);hit.addEventListener('dispose',()=>hitFreed++);u.hoverJet.geometry.addEventListener('dispose',()=>jetFreed++);u.armor.addEventListener('dispose',()=>matFreed++);g.disposeMech(u.g);yes(displayFreed===1&&hitFreed===1&&jetFreed===1&&matFreed===1,'表示・被弾・噴射の形と共通材質を1回ずつ解放');
  }else g.disposeMech(u.g);
  rows.push(row);
 }
 const bipeds={};
 for(const legs of Object.keys(g.PARTS.legs).filter(k=>!g.PART_SERIES[g.PARTS.legs[k].series].profile)){
  const u=fixture({...g.MECH_DEFAULT,legs,color:'ash'});pose(u,'walk');bipeds[legs]=await digest(u.rig.meshes.flatMap(m=>[m.mesh.geometry.attributes.position.array,m.mesh.geometry.attributes.normal.array,m.mesh.geometry.attributes.color.array]));yes(!u.rig.hitMeshes&&!u.hoverJet,'二脚にホバーの形と被弾面を足さない');g.disposeMech(u.g);
 }
 return {rows,bipeds,catalog:{parts:g.PARTS,weapons:g.WEAPONS,armory:g.ARMORY,series:g.PART_SERIES}};
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1360,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=window.webkitAudioContext=undefined;});
  await page.goto('file://'+path.join(base,'dbg.html'));const before=await page.evaluate(probe);
  await page.goto('file://'+path.join(dir,'dbg.html'));const after=await page.evaluate(probe);
  assert.deepEqual(after.catalog,before.catalog,'武器・パーツの性能、選択肢、保存キーを維持');assert.deepEqual(after.bipeds,before.bipeds,'二脚18型の表示形状と姿勢を維持');
  for(let i=0;i<after.rows.length;i++){const a=after.rows[i],b=before.rows[i];assert(a.hasProxy,'ホバー脚は表示と被弾形状を分ける');assert.deepEqual(a.poses.map(p=>[p.name,p.hitHash,p.rays,p.jetVisible]),b.poses.map(p=>[p.name,p.hitHash,p.rays,p.jetVisible]),a.cfg.legs+'の姿勢ごとの被弾形状・レイ・噴射停止');if(a.approvedInput)assert.equal(sha(a.approvedInput),accepted.classes[a.family].sha256,a.family+'の承認済み表示形状を採用');delete a.approvedInput;}
  for(const family of ['wisp','skimmer','anchor']){
   await page.evaluate(family=>{const g=__g;Object.assign(g.mechCfg,{head:'standard',body:'standard',arms:'standard',legs:family,color:'ash'});g.renderCustom();g.showPage('pgCustom');document.getElementById('overlay').hidden=false;g.loop(performance.now());},family);
   await page.screenshot({path:path.join(out,family+'-custom.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);const report={configurations:after.rows.length,posesPerConfiguration:8,bipedTypes:Object.keys(after.bipeds).length,approvedModels:true,legacyHitShapesAndRays:true,catalogUnchanged:true,errors,rows:after.rows};fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
