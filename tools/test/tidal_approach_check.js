// A–BとC–Eの積み荷：実弾、地上の迂回、比較可能な地上標本への視認を本体で測る。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{
 const browser=await chromium.launch(),results=[];
 try{
  let data=null;
  if(process.argv[4]){const c={window:{}};require('node:vm').runInNewContext(fs.readFileSync(process.argv[4],'utf8'),c);data=Object.values(c.window.MAP_DATA)[0];}
  for(const id of ['tidal','tidal-v2','tidal-v3']){
   const {page,errors}=await openMap(browser,id,data,20261700,{silent:true,debugDir:process.argv[2]||'dbg'});await page.click('#start');
   const r=await page.evaluate(()=>{
    const g=__g,covered=!!g.curMap.generation.approachCover,sightlines=[],routes=[],exposure=[];
    for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}
    const observer=g.units.find(u=>u.team==='R'),target=g.units.find(u=>u.team==='B'&&!u.isPlayer);
    const place=(u,p)=>{u.alive=true;u.pos.set(...p);u.group.position.copy(u.pos);u.group.visible=true;u.invulT=0;u.hp=u.maxHp;};
    for(const [name,from,to,block] of [
     ['AB・中央正面',[0,0,200],[0,0,298],true],
     ['AB・中継の地上',[-36,0,238],[-36,0,307],true],
     ['AB・陸側の接近',[-66,0,300],[-66,0,340],true],
     ['AB・海側の接近',[94,0,174],[94,0,220],true],
     ['AB・外側の開いた通路',[134,0,174],[134,0,264],false],
     ['CE・陸側の入口',[-64,0,-20],[-64,0,-90],true],
     ['CE・中央の入口',[22,0,-24],[22,0,-110],true],
     ['CE・陸側の後方',[-56,0,-212],[-56,0,-300],true],
     ['CE・中央の後方',[16,0,-166],[16,0,-280],true],
     ['CE・沿岸の後方',[122,0,-224],[122,0,-278],true],
     ['CE・倉庫沿いの開いた通路',[70,0,-210],[70,0,-270],false],
    ]){
     place(observer,from);place(target,to);g.scene.updateMatrixWorld();
     const hp=target.hp,visible=g.canSee(observer,target,g.targetPoint(target));g.fire(observer,g.targetPoint(target),0,g.WEAPONS.marks);
     sightlines.push({name,from,to,visible,expected:!(covered&&block),shotDamage:hp-target.hp});
    }
    observer.alive=false;observer.group.visible=false;target.alive=false;target.group.visible=false;
    const lanes=[
     ['AB・陸側群の西',-84,330,306],['AB・陸側群の東',-48,330,306],
     ['AB・中継群の西',-52,288,264],['AB・中継群の東',-20,288,264],
     ['AB・正面群の西',-58,222,194],['AB・正面群の東',-26,222,194],
     ['AB・海側群の西',76,220,192],['AB・海側群の東',112,220,192],
     ['CE・中央後方群の西',-2,-193,-219],['CE・中央後方群の東',34,-193,-219],
     ['CE・沿岸群の西',109,-243,-265],['CE・沿岸群の東',133.5,-243,-265],
     ['CE・陸側入口群の西',-80,-49,-75],['CE・陸側入口群の東',-48,-49,-75],
    ];
    for(const [cls,chassis] of [['assault','light'],['heavy','heavy']])for(const [name,x,a,b] of lanes)for(const reverse of [false,true]){
     const u=g.player,z0=reverse?b:a,z1=reverse?a:b;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
     u.pos.set(x,0,z0);u.vel.set(0,0,0);Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,transfer:null,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
     let ticks=0,arrived=false;
     for(;ticks<1000;ticks++){
      const delta=new g.T.Vector3(x-u.pos.x,0,z1-u.pos.z);
      if(delta.length()<1.4&&Math.abs(u.pos.y)<1.2){arrived=true;break;}
      g.physics(u,delta.normalize(),false,false,.05);
     }
     if(!arrived)throw new Error(`${g.mapId}/${cls}/${name}/${reverse}: ${u.pos.toArray()}`);
     routes.push({name,class:cls,reverse,arrived,seconds:ticks*.05});u.alive=false;
    }
    if(g.mapId==='tidal'){
     const zones=[['AB',-80,120,190,330,[['B前',[-74,0,168]],['橋上',[-125,20,180]],['展望台',[72,22,0]]]],
      ['CD',-82,125,-120,-24,[['C前',[-72,0,-10]],['橋上',[90,20,-182]],['展望台',[72,22,0]]]],
      ['DE',-75,130,-330,-170,[['D前',[8,0,-166]],['橋上',[90,20,-182]],['展望台',[72,22,0]]]]];
     for(const [zone,x0,x1,z0,z1,views] of zones)for(const [view,from] of views){
      place(observer,from);
      for(let x=x0;x<=x1;x+=10)for(let z=z0;z<=z1;z+=10){
       if(Math.abs(g.terrainH(x,z))>.05)continue;
       if(g.obstacles.some(o=>x>o.minX-1.3&&x<o.maxX+1.3&&z>o.minZ-1.3&&z<o.maxZ+1.3&&o.top>.6&&(o.bottom===undefined||o.bottom<4.1)))continue;
       place(target,[x,0,z]);g.scene.updateMatrixWorld();exposure.push({zone,view,from,pos:[x,0,z],visible:g.canSee(observer,target,g.targetPoint(target))});
      }
     }
    }
    const foundations=(g.curMap.generation.approachCover?.clusters||[]).map(([name,x,z,w,d])=>({name,ground:[[-w/2,-d/2],[-w/2,d/2],[w/2,-d/2],[w/2,d/2]].map(([dx,dz])=>g.terrainH(x+dx,z+dz)),upperSurface:g.groundAt(x,z,12)}));
    return {id:g.mapId,revision:g.curMap.generation.version,covered,sightlines,routes,exposure,foundations};
   });
   results.push({...r,errors});await page.close();
  }
  const output=process.argv[3]||'dbg/tidal-approach-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
  for(const r of results){assert.deepEqual(r.errors,[]);for(const s of r.sightlines){assert.equal(s.visible,s.expected,r.id+'/'+s.name);assert.equal(s.shotDamage>0,s.expected,r.id+'/'+s.name+'の実弾');}for(const f of r.foundations){assert.ok(f.ground.every(y=>Math.abs(y)<.05),f.name+'の基礎');assert.equal(f.upperSurface,12,f.name+'の上段');}}
  console.log(`AB・CE：3配置で射線・実弾33組、徒歩往復${results.reduce((n,r)=>n+r.routes.length,0)}経路、地上視認標本${results[0].exposure.length}、エラー0`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
