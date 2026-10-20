// 街区の地上路、正面と遮蔽の射線、高所からの補給点の露出を本体で調べる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{openMap}=require('../mapgen_browser');
(async()=>{
  const browser=await chromium.launch();
  try{
    let data=null;
    if(process.argv[4]){const context={window:{}};require('node:vm').runInNewContext(fs.readFileSync(process.argv[4],'utf8'),context);data=Object.values(context.window.MAP_DATA)[0];}
    const {page,errors}=await openMap(browser,'tidal',data,20261400,{silent:true,debugDir:process.argv[2]||'dbg'});
    await page.click('#start');
    const report=await page.evaluate(()=>{
      const g=__g,T=g.T,routes=[],sightlines=[],repairVisibility=[],raidWaypoints=[];
      if(g.curMap.generation.version<4)throw new Error('街区追加版tidal4以降を読み込んでください');
      for(const u of g.units){u.alive=false;u.frozen=true;u.group.visible=false;}
      const plans=[
        ['工場の地上路・連絡橋下',[[-63,350],[-63,407],[-127,407]]],
        ['住宅の庭壁と路地',[[103,-326],[121,-350],[103,-360],[103,-402],[103,-432],[136,-432]]],
        ['青ゲート正面',[[-42,400],[-42,460]]],['橙ゲート正面',[[42,-400],[42,-460]]],
      ];
      for(const [cls,chassis] of [['assault','light'],['heavy','heavy']])for(const [name,points] of plans){
        const u=g.player;u.mech={head:chassis,body:chassis,arms:chassis,legs:chassis,color:'team'};g.equip(u,cls);
        const [sx,sz]=points[0];u.pos.set(sx,g.terrainH(sx,sz),sz);u.vel.set(0,0,0);
        Object.assign(u,{alive:true,onGround:true,flying:false,repairing:false,transfer:null,planted:false,stun:'',dashT:0,longDash:false,charging:false,overheat:false,ctrlLockT:0,boost:u.maxBoost});
        let ticks=0;
        for(const [x,z] of points.slice(1)){
          let arrived=false;
          for(let n=0;n<1000;n++){
            const delta=new T.Vector3(x-u.pos.x,0,z-u.pos.z);
            if(delta.length()<1.4){arrived=true;break;}
            g.physics(u,delta.normalize(),false,false,.05);ticks++;
          }
          if(!arrived)throw new Error(`${cls}/${name}: 到達不能 ${u.pos.toArray()} → ${x},${z}`);
        }
        routes.push({name,class:cls,seconds:ticks*.05,arrived:true});u.alive=false;
      }
      const observer=g.units.find(u=>u.team==='B'&&!u.isPlayer),target=g.units.find(u=>u.team==='R');
      const place=(u,p)=>{u.alive=true;u.pos.set(...p);u.group.position.copy(u.pos);u.group.visible=true;u.invulT=0;};
      for(const [name,from,to,expected] of [
        ['青の門内→正面の接近路',[-36,0,467.2],[-42,0,420],true],
        ['青の門内→工場間の地上路',[-36,0,467.2],[-95,0,407],false],
        ['青の門内→工場の後方屋根',[36,0,467.2],[88,10,374],false],
        ['橙の門内→正面の接近路',[36,0,-467.2],[42,0,-420],true],
        ['橙の門内→住宅間の路地',[36,0,-467.2],[103,0,-402],false],
        ['橙の門内→共同住宅の屋上',[-36,0,-467.2],[-78,10,-371],false],
      ]){
        place(observer,from);place(target,to);g.scene.updateMatrixWorld();
        sightlines.push({name,from,to,visible:g.canSee(observer,target,g.targetPoint(target)),expected});
      }
      observer.alive=false;
      // 屋根・連絡橋・低層住宅の上も候補にし、敵側から補給中の胴と頭を狙う。
      const candidates=[],seen=new Set();
      const add=(x,z)=>{
        const y=g.groundAt(x,z,60);if(y<4)return;
        const key=[x,z,y].map(v=>v.toFixed(2)).join(',');if(seen.has(key))return;seen.add(key);candidates.push([x,y,z]);
      };
      for(const [x,z,w,d] of [...g.curMap.bridges,...g.curMap.layout]){
        if(Math.abs(z)<244||Math.abs(z)>438)continue;
        for(let px=x-w/2+1.6;px<=x+w/2-1.6;px+=5)for(let pz=z-d/2+1.6;pz<=z+d/2-1.6;pz+=5)add(px,pz);
        add(x,z);
      }
      for(const pod of g.pods.filter(p=>p.plant&&(p.plant===g.plants[0]||p.plant===g.plants.at(-1)))){
        const sign=Math.sign(pod.pos.z);place(target,pod.pos.toArray());g.scene.updateMatrixWorld();
        const relevant=candidates.filter(([x,y,z])=>z*sign<=pod.plant.pos.z*sign&&Math.hypot(x-pod.pos.x,z-pod.pos.z)<=180);
        const exposed=[];
        for(const p of relevant){
          const eye=new T.Vector3(p[0],p[1]+4.6,p[2]);
          const visible=[2.4,3.9].some(h=>{
            const tp=target.pos.clone().setY(target.pos.y+h),dir=tp.clone().sub(eye),dist=dir.length();
            return g.castFrom(eye,dir.normalize(),observer,dist+1)?.ref===target;
          });
          if(visible)exposed.push(p);
        }
        repairVisibility.push({plant:pod.plant.id,samples:relevant.length,exposed});
      }
      for(const route of g.curMap.raidRoutes)for(const side of ['points','pointsR'])for(const p of route[side]){
        const blocked=g.obstacles.some(o=>p[0]>o.minX-1.1&&p[0]<o.maxX+1.1&&p[1]>o.minZ-1.1&&p[1]<o.maxZ+1.1&&o.top>p[2]+.6&&(o.bottom===undefined||o.bottom<p[2]+4));
        if(blocked)raidWaypoints.push({kind:route.kind,side,point:p,blocked});
      }
      return {routes,sightlines,repairVisibility,blockedRaidWaypoints:raidWaypoints};
    });
    const output=process.argv[3]||'dbg/tidal-district-check.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({...report,errors},null,2)+'\n');
    assert.deepEqual(errors,[]);assert.deepEqual(report.blockedRaidWaypoints,[],'攻撃役の目標が建物内');
    for(const line of report.sightlines)assert.equal(line.visible,line.expected,line.name);
    for(const pod of report.repairVisibility){assert.ok(pod.samples>0);assert.deepEqual(pod.exposed,[],`${pod.plant}: 高所から補給点が見える`);}
    console.log(`街区：地上実走${report.routes.length}経路、射線${report.sightlines.length}組、高所から補給点への視認0、攻撃経由点の干渉0、エラー0`);
    await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
