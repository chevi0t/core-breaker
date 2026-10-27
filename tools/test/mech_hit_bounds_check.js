// 旧被弾面を直接レイキャストした結果と、部位の保守的な箱による早期除外を照合。
// node tools/test/mech_hit_bounds_check.js <dbg> <output.json>
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{requestAnimationFrame=()=>0;window.AudioContext=undefined;});
  await page.route('https://**/*',r=>r.fulfill({body:''}));
  await page.goto('file://'+path.resolve(process.argv[2],'dbg.html'));
  const result=await page.evaluate(()=>{
   const g=__g,T=g.T,keys=Object.values(g.PART_SERIES).map(s=>s.types[0]);
   const configs=keys.map(k=>Object.fromEntries(['head','body','arms','legs'].map(s=>[s,k])));
   configs.push({head:'light',body:'bastion',arms:'heavy',legs:'light'},{head:'heavy',body:'light',arms:'light',legs:'anchor'});
   let rays=0,hits=0,avoidedLegUpdates=0;
   for(const cfg of configs){
    const m=g.buildMech(g.TEAM.B.color,cfg),u={...m,group:m.g,pos:new T.Vector3(),vel:new T.Vector3(),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',mech:cfg,boost:100};
    for(const name of ['idle','walk','crouch','air','dash','down','repair','transfer']){
     Object.assign(u,{onGround:name!=='air',planted:name==='crouch',repairing:name==='repair',transfer:name==='transfer'?{t:1}:null,downT:name==='down'?1:0,dashState:name==='dash'?'long':''});u.vel.set(0,0,name==='walk'?-5:0);
     for(let i=0;i<20;i++){u.pos.z+=u.vel.z/60;g.weaponLook(u,1/60);}
     m.g.position.set(31,17,-42);m.g.rotation.set(.12,.71,-.09);m.g.scale.setScalar(1.3);m.g.updateMatrixWorld(true);
     const caster=new T.Raycaster();
     if(name==='idle'){
      const leg=m.rig.meshes[3].mesh,entry=m.rig.hitMeshes[3];
      caster.set(new T.Vector3(0,2.7,-10).applyMatrix4(m.g.matrixWorld),new T.Vector3(0,0,1).transformDirection(m.g.matrixWorld));
      leg.raycast(caster,[]);
      if(entry.lazy){if(entry.ranges.some(r=>r.hitPrevious))throw Error('胸への射線で脚の頂点を更新した');avoidedLegUpdates++;}
     }
     for(const entry of m.rig.meshes){
      const mesh=entry.mesh;mesh.userData.syncLegacyVisual?.();
      const display=mesh.geometry,proxy=mesh.userData.hitGeometry,positions=proxy.attributes.position;
      // 各部位の実三角形の中心を、表裏とほぼ接線方向から狙う。
      for(let i=0;i<positions.count;i+=Math.max(3,Math.floor(positions.count/48/3)*3)){
       const a=new T.Vector3().fromBufferAttribute(positions,i),b=new T.Vector3().fromBufferAttribute(positions,(i+1)%positions.count),c=new T.Vector3().fromBufferAttribute(positions,(i+2)%positions.count);
       const center=a.clone().add(b).add(c).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
       const normal=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize().transformDirection(mesh.matrixWorld);
       for(const direction of [normal,normal.clone().negate(),normal.clone().add(new T.Vector3(12,.03,-5)).normalize()]){
        caster.set(center.clone().addScaledVector(direction,4),direction.clone().negate());
        const expected=[],actual=[];mesh.geometry=proxy;try{T.Mesh.prototype.raycast.call(mesh,caster,expected);}finally{mesh.geometry=display;}
        mesh.raycast(caster,actual);const normalize=a=>a.sort((x,y)=>x.distance-y.distance).map(h=>[h.distance,h.faceIndex,...h.face.normal.toArray()]);
        if(JSON.stringify(normalize(actual))!==JSON.stringify(normalize(expected)))throw Error('被弾結果差 '+JSON.stringify(cfg)+'/'+name+'/'+mesh.userData.armorSlot);
        rays++;hits+=actual.length;
       }
      }
     }
    }
    g.disposeMech(m.g);
   }
   return{configurations:configs.length,poses:8,rays,hits,avoidedLegUpdates};
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(process.argv[3],JSON.stringify({...result,errors},null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
