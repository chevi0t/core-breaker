// 高架脇の拡幅、孤立穴への落下と脱出、北東の集約街区を本体のphysicsで調べる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/trial'),baseline=process.argv.includes('--baseline');
  const profile=JSON.parse(fs.readFileSync('research/maps/akihabara-trial.json'));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:900}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
    const result=await page.evaluate(({profile,baseline})=>{
      const g=__cityTrial,{city,T}=g;g.setup();g.running=false;const u=g.player,saved={...u.mech},walks=[],drops=[];
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      if(!baseline){
        ok(['tran','streets','plazas','fill'].every(k=>city.arrays[k].length===0&&!g.mapRoot.getObjectByName('city-'+k)),'細かい道路・空地の床を試走へ重ねて渡さない');
        ok(city.district.unifiedGround.afterTriangles<city.district.unifiedGround.beforeTriangles/2,'床の区分を整理して面数も減らす',city.district.unifiedGround);
        const blocks=city.volumes.filter(v=>v.blockId);
        ok(blocks.length===10&&new Set(blocks.map(v=>v.blockId)).size===10,'指定街区を10棟にまとめる',blocks.length);
        ok(blocks.every(v=>v.rings.length===1),'集約棟に落ちる中庭穴を残さない');
        ok(city.district.pocketRepairs.length===1&&city.district.pocketRepairs[0].previousSafeArea>80,'高架脇の孤立穴を検出して補修する');
      }
      const plans=[];
      const [a,b]=profile.sideAlleys.centerline,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      for(const side of [-1,1])for(const lane of [-3.5,0,3.5]){
        const offset=side*15+lane;
        plans.push({name:'高架横 '+side+' / '+lane,points:[a,b].map(p=>[p[0]-dz/length*offset,p[1]+dx/length*offset])});
      }
      plans.push({name:'北東街区・南北幹路',points:[[253,-294],[253,-104]]});
      for(const z of [-262,-222,-182,-142]){
        const west=232-(z+300)*31/182+6;
        plans.push({name:'北東街区・横道 '+z,points:[[west,z],[294,z]]});
      }
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};
        for(const plan of plans)for(const reverse of [false,true]){
          const points=plan.points.map(p=>p.slice());if(reverse)points.reverse();
          g.spawn(u);u.pos.set(points[0][0],g.terrainH(...points[0]),points[0][1]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          let goal=1,t=0,stuck=0,airborne=0;const start=u.pos.toArray();
          for(;t<60&&goal<points.length;t+=dt){
            const wish=new T.Vector3(points[goal][0]-u.pos.x,0,points[goal][1]-u.pos.z);
            if(wish.length()<.4){goal++;continue;}
            const old=u.pos.clone();g.physics(u,wish.normalize(),false,false,dt);if(!u.onGround)airborne++;
            stuck=Math.hypot(u.pos.x-old.x,u.pos.z-old.z)<dt*.1?stuck+dt:0;if(stuck>3)break;
          }
          const entry={name:plan.name,type,dt,reverse,success:goal===points.length&&u.onGround,airborne,seconds:+t.toFixed(3),start,end:u.pos.toArray()};
          walks.push(entry);if(!baseline)ok(entry.success&&airborne===0,'拡幅路と集約街区を徒歩で通れる',entry);
        }
        for(const point of [[-56,66],[-56,72],[-55.5,78]]){
          g.spawn(u);u.pos.set(point[0],20,point[1]);u.vel.set(0,0,0);u.onGround=false;u.maxBoost=u.boost=0;
          for(let t=0;t<3;t+=dt)g.physics(u,new T.Vector3(),false,false,dt);
          const landed=u.pos.toArray();let t=0;
          for(;t<8;t+=dt){
            const wish=new T.Vector3(-37-u.pos.x,0,point[1]-u.pos.z);if(wish.length()<.5)break;
            g.physics(u,wish.normalize(),false,baseline&&t===0,dt);
          }
          const entry={type,dt,point,landed,end:u.pos.toArray(),success:t<8&&u.onGround&&Math.abs(u.pos.y-8)<.02};
          drops.push(entry);if(!baseline)ok(entry.success&&Math.abs(landed[1]-8)<.02,'穴の上へ落下しても高架へ歩いて出られる',entry);
        }
      }
      u.mech=saved;g.equip(u,u.cls);
      return {walks,drops,failedWalks:walks.filter(v=>!v.success).length,failedDrops:drops.filter(v=>!v.success).length};
    },{profile,baseline});
    if(!baseline){
      await page.evaluate(()=>{
        const c=document.createElement('canvas');c.id='blocksMap';c.width=c.height=1200;c.style='position:fixed;inset:0;z-index:10000;width:900px;height:900px';
        document.body.append(c);__cityTrial.city.drawMap(c.getContext('2d'),1200,1200,null);
      });
      await page.locator('#blocksMap').screenshot({path:path.join(folder,'blocks-map.png')});await page.evaluate(()=>document.getElementById('blocksMap').remove());
      for(const [name,eye,target] of [['wide-alley',[-270,80,-35],[-250,-2,-13]],['pocket-fixed',[-75,110,72],[-56,8,72]],['merged-block',[170,170,-40],[250,8,-210]]]){
        await page.evaluate(({eye,target})=>{
          const g=__cityTrial;document.getElementById('overlay').hidden=true;document.getElementById('trialPanel').style.opacity='.15';
          g.camera.position.fromArray(eye);g.camera.lookAt(new g.T.Vector3(...target));g.camera.updateMatrixWorld(true);g.renderView();
        },{eye,target});
        await page.screenshot({path:path.join(folder,name+'.png')});
      }
    }
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    fs.writeFileSync(path.join(folder,baseline?'blocks-baseline.json':'blocks-check.json'),JSON.stringify({...result,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({baseline,walks:result.walks.length,drops:result.drops.length,failedWalks:result.failedWalks,failedDrops:result.failedDrops,errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
