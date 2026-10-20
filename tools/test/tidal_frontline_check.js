// B–C間の射線と実弾、遮蔽物の両側の通行を、本体の同じ物理・射撃で確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{
  const browser=await chromium.launch(),results=[];
  try{
    let data=null;
    if(process.argv[4]){const c={window:{}};require('node:vm').runInNewContext(fs.readFileSync(process.argv[4],'utf8'),c);data=Object.values(c.window.MAP_DATA)[0];}
    for(const id of ['tidal','tidal-v2','tidal-v3']){
      const {page,errors}=await openMap(browser,id,data,20261600,{silent:true,debugDir:process.argv[2]||'dbg'});await page.click('#start');
      const result=await page.evaluate(()=>{
        const g=__g,covered=!!g.curMap.generation.frontlineCover,routes=[],sightlines=[];
        const diagonal=g.curMap.generation.diagonalBridge;
        const bridgeX=z=>diagonal?diagonal.from[0]+(z-diagonal.from[1])*(diagonal.to[0]-diagonal.from[0])/(diagonal.to[1]-diagonal.from[1]):-38;
        const deck=g.curMap.generation.deck;
        for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}
        const observer=g.units.find(u=>u.team==='R'),target=g.units.find(u=>u.team==='B'&&!u.isPlayer);
        const place=(u,p)=>{u.alive=true;u.pos.set(...p);u.group.position.copy(u.pos);u.group.visible=true;u.invulT=0;u.hp=u.maxHp;};
        for(const [name,from,to,block] of [
          ['C側の地上→B手前',[-64,0,40],[-64,0,128],true],
          ['高架の端→B手前',[bridgeX(60)+(diagonal?8:-8),deck,60],[-64,0,128],true],
          ['高架上の縦射線',[bridgeX(50),deck,50],[bridgeX(120),deck,120],true],
          ['展望台→B手前',[68,22,4],[-70,0,156],true],
          ['外側の開いた通路',[-135,0,40],[-135,0,130],false],
        ]){
          place(observer,from);place(target,to);g.scene.updateMatrixWorld();
          const expected=!(covered&&block),visible=g.canSee(observer,target,g.targetPoint(target)),hp=target.hp;
          g.fire(observer,g.targetPoint(target),0,g.WEAPONS.marks);
          sightlines.push({name,from,to,visible,expected,shotDamage:hp-target.hp});
        }
        observer.alive=false;observer.group.visible=false;target.alive=false;target.group.visible=false;
        const paths=[['地上・壁の西',[[-90,90,0],[-90,123,0]]],['地上・壁の東',[[-51,90,0],[-51,123,0]]],
          ['高架・塔の西',[[bridgeX(60)-8,60,deck],[bridgeX(108)-8,108,deck]]],['高架・塔の東',[[bridgeX(60)+8,60,deck],[bridgeX(108)+8,108,deck]]],
          ['中央側・貨物の西',[[-12,70,0],[-12,92,0]]],['中央側・貨物の東',[[22,70,0],[22,92,0]]],
          ['倉庫屋根と橋の間',[[-109,130,14],[-109,150,14]]]];
        for(const [cls,chassis] of [['assault','light'],['heavy','heavy']])for(const [name,points] of paths)for(const reverse of [false,true]){
          const u=g.player;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
          const path=reverse?[...points].reverse():points,[x,z,y]=path[0];u.pos.set(x,y,z);u.vel.set(0,0,0);
          Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,transfer:null,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
          let ticks=0;
          for(const [x,z,y] of path.slice(1)){
            let arrived=false;
            for(let n=0;n<1000;n++){
              const delta=new g.T.Vector3(x-u.pos.x,0,z-u.pos.z);
              if(delta.length()<1.4&&Math.abs(u.pos.y-y)<1.2){arrived=true;break;}
              g.physics(u,delta.normalize(),false,false,.05);ticks++;
            }
            if(!arrived)throw new Error(`${g.mapId}/${cls}/${name}/${reverse}: ${u.pos.toArray()} → ${x},${y},${z}`);
          }
          routes.push({name,class:cls,reverse,arrived:true,seconds:ticks*.05});u.alive=false;
        }
        return {id:g.mapId,revision:g.curMap.generation.version,covered,sightlines,routes,
          roofHeadroom:diagonal?Math.min(...g.obstacles.filter(o=>o.bottom>14&&-109>o.minX&&-109<o.maxX&&150>o.minZ&&150<o.maxZ).map(o=>o.bottom))-14:null};
      });
      results.push({...result,errors});await page.close();
    }
    const out=process.argv[3]||'dbg/tidal-frontline-check.json';fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({results},null,2)+'\n');
    for(const r of results){
      assert.deepEqual(r.errors,[]);
      if(r.covered)assert.ok(Number.isFinite(r.roofHeadroom)&&r.roofHeadroom>=4.1,r.id+'の倉庫上の空間');
      for(const line of r.sightlines){assert.equal(line.visible,line.expected,r.id+'/'+line.name);assert.equal(line.shotDamage>0,line.expected,r.id+'/'+line.name+'の実弾');}
    }
    console.log(`B–C間：3配置の射線・実弾15組、徒歩往復${results.reduce((n,r)=>n+r.routes.length,0)}経路、エラー0`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
