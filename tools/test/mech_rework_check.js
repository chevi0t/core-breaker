// 外装再制作：旧被弾面・性能・型の統一・姿勢・9系列の比較を記録。
// node tools/test/mech_rework_check.js <before dbg> <after dbg> <out>
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
const [before,after,out]=process.argv.slice(2).map(p=>path.resolve(p));fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;});
const results=[];
for(const [label,dir] of [['before',before],['after',after]]){
await page.goto('file://'+path.join(dir,'dbg.html'));
const result=await page.evaluate(async()=>{
const g=__g,T=g.T;g.running=false;const catalog={parts:g.PARTS,weapons:g.WEAPONS,armory:g.ARMORY,series:g.PART_SERIES};
const hash=async arrays=>{const bytes=new Uint8Array(arrays.reduce((n,a)=>n+a.byteLength,0));let off=0;for(const a of arrays){bytes.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),off);off+=a.byteLength;}return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');};
const keys=Object.values(g.PART_SERIES).map(s=>s.types[0]),fixtures=[];
for(const k of keys)fixtures.push(Object.fromEntries(['head','body','arms','legs'].map(s=>[s,k])));
fixtures.push({head:'heavy3',body:'light',arms:'bastion3',legs:'light3'},{head:'light3',body:'bastion3',arms:'light',legs:'anchor3'});
const rows=[];
for(const cfg of fixtures){
const m=g.buildMech(g.TEAM.B.color,{...cfg,color:'ash'}),u={...m,group:m.g,pos:new T.Vector3(),vel:new T.Vector3(),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',mech:cfg,boost:100};
// 法線を持たない可視装備も残像化できる（通常ゲームで検出した回帰）。
const extra=new T.Mesh(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([-.1,2,0,.1,2,0,0,2.2,0],3)),new T.MeshLambertMaterial());m.g.add(extra);
const row={cfg,vertices:m.rig.meshes.reduce((n,e)=>n+e.pos.length/3,0),meshes:m.rig.meshes.length,materials:new Set(m.rig.meshes.map(e=>e.mesh.material)).size,poses:[]};
for(const name of ['idle','walk','crouch','air','dash','down','repair','transfer']){
Object.assign(u,{onGround:name!=='air',planted:name==='crouch',repairing:name==='repair',transfer:name==='transfer'?{t:1}:null,downT:name==='down'?1:0,dashState:name==='dash'?'long':''});u.vel.set(0,0,name==='walk'?-5:0);
for(let i=0;i<20;i++){u.pos.z+=u.vel.z/60;g.weaponLook(u,1/60);}u.g.updateMatrixWorld(true);
const hits=[],rays=[];for(const e of m.rig.meshes){const geo=e.mesh.userData.hitGeometry||e.mesh.geometry;hits.push(geo.attributes.position.array,geo.attributes.normal.array);for(const y of [.5,1,1.7,2.3,2.8,3.65])for(const x of [-1.5,-.6,0,.6,1.5]){const rs=[];new T.Raycaster(new T.Vector3(x,y,-10),new T.Vector3(0,0,1)).intersectObject(e.mesh,false,rs);rays.push(rs.map(h=>[h.distance,h.face.normal.toArray()]));}}
const decoy=g.mirageMesh(u,g.WEAPONS.mirage),dg=decoy.userData.hitGeometry||decoy.geometry;const mirage=await hash([dg.attributes.position.array,dg.attributes.normal.array].map(a=>Int32Array.from(a,v=>Math.round(v*1e5))));let freed=0;dg.addEventListener('dispose',()=>freed++);decoy.geometry.dispose();decoy.material.dispose();if(freed!==1)throw Error('残像被弾面の解放');
row.poses.push({name,mirage,hit:await hash(hits.map(a=>Int32Array.from(a,v=>Math.round(v*1e5)))),rays,jet:u.hoverJet?.visible||false});
}
row.display=await hash(m.rig.meshes.flatMap(e=>[e.pos,e.nor]));if(m.hoverJet)row.hover=await hash([m.rig.meshes[3].pos,m.rig.meshes[3].nor,m.hoverJet.userData.rest]);
extra.geometry.dispose();g.disposeMech(m.g);rows.push(row);
}
const variants=[];for(const [id,s]of Object.entries(g.PART_SERIES)){const hashes=[];for(const k of s.types){const m=g.buildMech(g.TEAM.B.color,{...Object.fromEntries(['head','body','arms','legs'].map(s=>[s,k])),color:'ash'});hashes.push(await hash(m.rig.meshes.flatMap(e=>[e.pos,e.nor])));g.disposeMech(m.g);}variants.push({id,hashes});}
return {catalog,rows,variants};
});
results.push(result);fs.writeFileSync(path.join(out,label+'-geometry.json'),JSON.stringify(result,null,2));
}
assert.deepEqual(results[1].catalog,results[0].catalog);
for(let i=0;i<results[0].rows.length;i++){const b=results[0].rows[i],a=results[1].rows[i];assert.deepEqual(a.poses,b.poses,'旧被弾面/レイ/噴射 '+JSON.stringify(a.cfg));assert.equal(a.meshes,4);assert.equal(a.materials,1);if(a.hover)assert.equal(a.hover,b.hover);assert.notEqual(a.display,b.display);}
for(const s of results[1].variants)assert.equal(new Set(s.hashes).size,1,s.id+'の型を統一');
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,configurations:results[1].rows.length,posesPerConfiguration:8,series:9,catalogUnchanged:true,hoverUnchanged:true,rows:results[1].rows.map(r=>({cfg:r.cfg,triangles:r.vertices/3,vertices:r.vertices}))},null,2));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
