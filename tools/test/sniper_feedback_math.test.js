// 復旧版の独立Node試験。WebGL/DOM/CSS/入力のブラウザ試験の代用ではない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('prototype/index.html');
const T=require('../../vendor/three-r128/three.min.js');
const c={T,console,structuredClone,TEAM:{B:{color:0x00ff00},R:{color:0xff0000}},SFX:{}};vm.createContext(c);
vm.runInContext(html.match(/const WALK = [^\n]+/)[0]+'\n'+html.match(/function baseKick\(w\) \{[^\n]+/)[0]+'\n'+read('prototype/parts.js')+'\nObject.assign(globalThis,partTables());\n'+read('prototype/weapons.js')+'\nObject.assign(globalThis,weaponModels());Object.assign(globalThis,weaponTables());',c);
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,start);return source.slice(a,b);}
vm.runInContext('const LAND_SPEED=28;\n'+section(html,'const LEG_TRAITS_BASE =','function fwdOf(')+'\n'+section(html,'function shotSpread(','function scopePower(')+'\n'+section(html,'function scopePower(','let player;'),c);
// main fb6bf0b の発射式を独立に固定。shallow checkoutでもgit履歴を必要としない。
vm.runInContext(`function mainSpread(u,sl,spread){const w=sl.w;let sp=spread+w.spread;if(w.scope)sp+=u.scoped?w.sway*(1-sl.conv):w.hip*(Math.hypot(u.vel.x,u.vel.z)>3||!u.onGround?w.hipMove||1:1);sp*=aimSpread(u);return sp;}`,c);
const weapons=Object.values(c.WEAPONS).filter(w=>w.type==='gun'&&!w.proj),scopes=weapons.filter(w=>w.scope);
const traits=[undefined,...Object.values(c.LEG_KIND_TRAITS)];let equivalence=0;
for(const w of weapons)for(const conv of [0,.15,.5,.9,1])for(const scoped of [false,true])for(const speed of [0,2.99,3,12])for(const onGround of [false,true])for(const spread of [0,.0034,.017,.025,.042])for(const aimMul of [.7,1,1.3])for(const trait of traits)for(const crouching of [false,true]){
  const u={vel:{x:speed,y:0,z:0},scoped,onGround,aimMul,crouching,stats:{P:{legs:{traits:trait}}}},sl={w,conv};
  assert.equal(c.shotSpread(u,sl,spread),c.mainSpread(u,sl,spread));equivalence++;
}
const camera=new T.PerspectiveCamera(70,16/9,.1,1000);let projections=0,rays=0,monotonic=0;
for(const w of scopes)for(const [yaw,pitch] of [[0,0],[.8,.4],[-1.6,-.7]])for(const distance of [10,120,300])for(const [width,height] of [[1280,720],[390,844]])for(const fov of [60/w.scope,100/w.scope])for(const movement of [0,.017,.042]){
  camera.position.set(8,7,9);camera.rotation.set(pitch,yaw,0,'YXZ');camera.fov=fov;camera.aspect=width/height;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const forward=camera.getWorldDirection(new T.Vector3()),from=camera.position.clone().addScaledVector(forward,7).add(new T.Vector3(1.4,-1.2,.2)),aim=camera.position.clone().addScaledVector(forward,distance),u={vel:{x:0,z:0},scoped:true,onGround:true,aimMul:1.2,stats:{P:{legs:{}}}};
  let previous=Infinity;
  for(const conv of [0,.25,.5,.75,1]){
    const spread=c.shotSpread(u,{w,conv},movement),outline=c.scopeSpreadOutline(from,aim,spread,camera,width,height),diamond=c.scopeSpreadDiamond(outline);assert.equal(diamond.length,4);const radius=diamond[1].x;
    assert(radius<=previous+1e-7);previous=radius;monotonic++;
    const dir=aim.clone().sub(from).normalize(),depth=forward.dot(aim.clone().sub(from));
    for(const x of [-.5,-.17,0,.31,.5])for(const y of [-.5,0,.5])for(const z of [-.5,0,.5]){
      const d=dir.clone().add(new T.Vector3(x*spread,y*spread,z*spread)).normalize();const p=from.clone().addScaledVector(d,depth/forward.dot(d)).project(camera);
      assert(Math.abs(p.x*width/2)+Math.abs(p.y*height/2)<=radius+1e-6);rays++;
    }projections++;
  }
}
assert.deepEqual(Array.from(c.scopeSpreadDiamond([])),[]);
assert.equal(c.scopeSpreadOutline(new T.Vector3(),new T.Vector3(0,0,10),.1,new T.PerspectiveCamera(),1280,720).length,0);
// 最小の表示要素の代役で値と状態だけ確認。DOM配置/描画/blurは検証しない。
const ids=[...read('prototype/index.html').matchAll(/id="(scope[^\"]*)"/g)].map(m=>m[1]);const nodes=new Map(ids.map(id=>[id,{hidden:false,dataset:{},attrs:{},style:{},firstElementChild:{style:{}},setAttribute(k,v){this.attrs[k]=v;}}]));
let reads=0;Object.assign(c,{$:id=>{assert(nodes.has(id),id);return nodes.get(id)},innerWidth:1280,innerHeight:720,camera,CAM:{back:8},movementSpread:()=>0,castFrom:()=>{reads++;return {point:new T.Vector3(0,0,-120)}},muzzle:()=>new T.Vector3(0,0,-5)});
camera.position.set(0,0,0);camera.rotation.set(0,0,0);camera.fov=20;camera.aspect=1280/720;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
let hudCases=0;
for(const w of scopes){const p={alive:true,downT:0,scoped:true,weapon:'sub',slots:{sub:{w,conv:1,ammo:3,reserve:9,reloadT:0}},vel:{x:0,z:0},onGround:true,aimMul:1,stats:{P:{legs:{}}}};const before=JSON.stringify(p);c.scopeHud(p);assert.equal(JSON.stringify(p),before);assert.equal(nodes.get('scope').dataset.optic,w.laserFade>0?'laser':'ballistic');assert.equal(nodes.get('scopeAmmo').textContent,'3 / 9');assert.equal(nodes.get('scopeDistance').textContent,'115 m');assert.equal(nodes.get('scopePercent').textContent,'100%');assert.equal(nodes.get('scope').hidden,false);p.alive=false;c.scopeHud(p);assert.equal(nodes.get('scope').hidden,true);p.alive=true;p.downT=1;c.scopeHud(p);assert.equal(nodes.get('scope').hidden,true);p.downT=0;p.scoped=false;c.scopeHud(p);assert.equal(nodes.get('scope').hidden,true);hudCases++;}
assert.equal(reads,scopes.length,'見えている時だけ1回中心レイを読む');
console.log(JSON.stringify({hitscanWeapons:weapons.length,scopedWeapons:scopes.length,legTraitKinds:traits.length,exactMainFormulaComparisons:equivalence,projectionCases:projections,sampledDirectionsContained:rays,monotonicConvergenceCases:monotonic,hudStubWeapons:hudCases,browserVerified:false},null,2));
