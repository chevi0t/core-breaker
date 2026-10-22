// 路面の3本の帯を両方向に実走する。基準版にも同じ経路を与えて段差・停止を比較できる。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/trial'),baseline=process.argv.includes('--baseline');
  const plans=JSON.parse(fs.readFileSync('research/maps/akihabara-trial.json')).streetRepairs;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:900}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
    const result=await page.evaluate(({plans,baseline})=>{
      const g=__cityTrial,{T,city}=g;g.setup();g.running=false;const u=g.player,walks=[];
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      const saved={...u.mech};
      if(!baseline){
        ok(city.landmarks.length===19,'指定した施設の棟を識別');
        const mesh=g.mapRoot.getObjectByName('city-bldg'),color=mesh.geometry.attributes.color.array,glass=mesh.geometry.attributes.cityGlass.array;
        ok([...glass].some(v=>v===1),'ガラス張りの属性が実際の形状にある');
        for(const landmark of city.landmarks){
          const vs=city.volumes.filter(v=>v.landmark===landmark.id);
          ok(vs.length>0&&vs.every(v=>v.landmarkColor===landmark.color),'各棟と上部へ指定色を適用',landmark.id);
          const wanted=new T.Color(landmark.color);
          ok([...city.arrays.bldg.keys()].some((_,i)=>i%3===0&&Math.abs(color[i]-wanted.r)<.001&&Math.abs(color[i+1]-wanted.g)<.001&&Math.abs(color[i+2]-wanted.b)<.001),'指定色の頂点がある',landmark.id);
        }
        ok(city.streetRepairs.removedBridgeFragments.length>0&&city.streetRepairs.removedBuildingShards.length>0,'古い橋片と高架の切断片を除去');
      }
      function pointsOf(plan,offset){
        return plan.points.map((p,i)=>{
          const a=plan.points[Math.max(0,i-1)],b=plan.points[Math.min(plan.points.length-1,i+1)],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          return [p[0]-(b[1]-a[1])/len*offset,p[1]+(b[0]-a[0])/len*offset];
        });
      }
      if(!baseline){
        const site=city.heritage;
        ok(city.arrays.historicWall.length>0,'川沿いの壁面を表示する');
        ok(site.trimmedShoreArea>0&&Math.abs(g.terrainH(-280,150)-city.river.bed)<.01,'岸の整形で川を埋めない');
        for(const [x,z] of [[-290,153],[-280,164],[-270,178]])ok(Math.abs(g.terrainH(x,z)-site.height)<.02,'旧駅の上面を平坦にする',{x,z,h:g.terrainH(x,z)});
        plans=[...plans,{id:'heritage_access',points:site.access,width:4}];
      }
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const plan of plans)for(const offset of plan.id==='heritage_access'?[0]:[0,plan.width/2-2,-plan.width/2+2])for(const reverse of [false,true]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);
        const points=pointsOf(plan,offset);if(reverse)points.reverse();
        u.pos.set(points[0][0],g.terrainH(...points[0]),points[0][1]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
        let t=0,goal=1,stuck=0,airborne=0,maxStep=0;const start=u.pos.toArray();
        for(;t<65&&goal<points.length;t+=dt){
          const wish=new T.Vector3(points[goal][0]-u.pos.x,0,points[goal][1]-u.pos.z);
          if(wish.length()<.4){goal++;continue;}
          const old=u.pos.clone();g.physics(u,wish.normalize(),false,false,dt);
          maxStep=Math.max(maxStep,Math.abs(u.pos.y-old.y));if(!u.onGround)airborne++;
          const moved=Math.hypot(u.pos.x-old.x,u.pos.z-old.z);stuck=moved<.1*dt?stuck+dt:0;
          if(stuck>3)break;
        }
        const success=goal===points.length&&u.onGround;
        walks.push({type,dt,road:plan.id,offset,reverse,success,seconds:+t.toFixed(3),goal,airborne,maxStep,start,end:u.pos.toArray()});
        if(!baseline)ok(success,'道路を歩いて通り抜ける',walks.at(-1));
        // 旧駅への斜面は通常歩行で登れる勾配。平坦な車道とは1フレームの上下量が異なる。
        if(!baseline)ok(plan.id==='heritage_access'?airborne===0&&maxStep<.55:maxStep<.25,'段差で跳ねずに路面を通る',walks.at(-1));
      }
      u.mech=saved;g.equip(u,u.cls);return {walks,failed:walks.filter(w=>!w.success).length};
    },{plans,baseline});
    if(!baseline){
      await page.evaluate(()=>{
        const cv=document.createElement('canvas');cv.id='landmarkMap';cv.width=cv.height=1200;cv.style='position:fixed;inset:0;width:900px;height:900px;z-index:10000';document.body.append(cv);
        __cityTrial.city.drawMap(cv.getContext('2d'),1200,1200,null);
      });
      await page.locator('#landmarkMap').screenshot({path:path.join(folder,'landmark-map.png')});await page.evaluate(()=>document.getElementById('landmarkMap').remove());
      for(const [name,at,yaw,pitch] of [['landmarks',[-175,0,-150],-Math.PI/2,.15],['underpass',[-55,0,-104],-Math.PI/2,-.08]]){
        await page.evaluate(({at,yaw,pitch})=>{
          const g=__cityTrial,u=g.player;g.spawn(u);u.pos.set(at[0],g.terrainH(at[0],at[2]),at[2]);u.yaw=yaw;u.pitch=pitch;
          u.group.position.copy(u.pos);u.group.rotation.set(0,yaw,0);u.group.visible=true;document.getElementById('overlay').hidden=true;document.getElementById('trialPanel').style.opacity='.15';
          for(let i=0;i<90;i++)g.updateCamera(u,1/60);g.renderView();
        },{at,yaw,pitch});
        await page.screenshot({path:path.join(folder,name+'.png')});
      }
      for(const [name,eye,target] of [['glass-facade',[-150,75,-120],[-75,45,-205]],['heritage',[-240,90,100],[-280,3,161]]]){
        await page.evaluate(({eye,target})=>{
          const g=__cityTrial;g.camera.position.fromArray(eye);g.camera.lookAt(new g.T.Vector3(...target));g.camera.updateMatrixWorld(true);g.renderView();
        },{eye,target});
        await page.screenshot({path:path.join(folder,name+'.png')});
      }
    }
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    const output=baseline?path.join(require('node:os').tmpdir(),'city-streets-baseline.json'):path.join(folder,'streets-check.json');
    fs.writeFileSync(output,JSON.stringify({...result,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({baseline,cases:result.walks.length,failed:result.failed,maxStep:Math.max(...result.walks.map(w=>w.maxStep)),errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
