// 街区再構築案の容量、代表街路・広場・上下高架、配色をオフラインの実物理で確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/rebuilt');
  const reference=path.resolve(process.argv[3]||'mapdesign/akihabara_city/trial');
  const raw=fs.readFileSync(path.join(folder,'layout.json')),data=JSON.parse(raw);
  const packed=fs.readFileSync(path.join(folder,'layout.json.gz'));
  assert(raw.length<=100000,'gzip前の街データを100KB以内にする');
  assert.deepEqual(zlib.gunzipSync(packed),raw,'配布データが元の配置を復元する');
  const html=fs.readFileSync(path.join(folder,'index.html'),'utf8');
  assert.deepEqual(zlib.gunzipSync(Buffer.from(html.match(/const CITY = await createCityTrial\(T,"([^"]+)"\)/)[1],'base64')),raw,'単体HTMLも同じ街データを使う');
  const profile=JSON.parse(fs.readFileSync('research/maps/akihabara-trial.json'));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:1000}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
    const result=await page.evaluate(({profile,packing})=>{
      const g=__cityTrial,{city,T}=g;g.setup();g.running=false;const u=g.player,walks=[];
      function ok(v,msg,detail){if(!v)throw Error(msg+' '+JSON.stringify(detail));}
      const triangles=Object.fromEntries(Object.entries(city.arrays).map(([k,v])=>[k,v.length/9]));
      for(const [name,v] of Object.entries(packing.layers))ok(triangles[name]===v.triangles,'展開後の実形状の面数を報告する',{name,actual:triangles[name],reported:v.triangles});
      const buildings=city.volumes.filter(v=>v.kind==='grounded');
      ok(buildings.length<200,'普通の棟を街区単位へ減らす',buildings.length);
      ok(buildings.every(v=>v.rings.length===1),'作り直した街区に閉じた中庭穴を作らない');
      ok(city.volumes.filter(v=>v.kind==='rail-deck').length===3&&city.volumes.filter(v=>v.kind==='station-roof').length===7,'駅と上下の高架を維持');
      ok(g.units.length===1&&g.plants.length===0,'地形確認段階の試走');
      ok(city.landmarks.length===18,'採用済みの目印を残す');
      const geo=g.mapRoot.getObjectByName('city-bldg').geometry,colors=geo.attributes.color.array;
      ok([...geo.attributes.cityGlass.array].some(v=>v===1),'ガラス棟を描画');
      for(const mark of city.landmarks){
        ok(city.volumes.some(v=>v.landmark===mark.id&&v.landmarkColor===mark.color),'指定色と目印の対応',mark.id);
        const c=new T.Color(mark.color);let found=false;
        for(let i=0;i<colors.length;i+=3)if(Math.abs(colors[i]-c.r)<.001&&Math.abs(colors[i+1]-c.g)<.001&&Math.abs(colors[i+2]-c.b)<.001){found=true;break;}
        ok(found,'配色を実際の頂点へ適用',mark.id);
      }
      let flatSamples=0;
      for(const [x0,z0,x1,z1] of [[-290,-290,-175,-205],[180,216,290,290]])for(let x=x0;x<=x1;x+=5)for(let z=z0;z<=z1;z+=5){
        ok(Math.abs(g.terrainH(x,z)+2)<.01&&!buildings.some(v=>city.contact(v,x,z).inside),'基地の更地を維持',{x,z});flatSamples++;
      }
      for(const [x,z] of [[260,185],[200,185],[-150,176]])ok(g.terrainH(x,z)===city.river.bed,'川を埋めない',{x,z});
      const plans=[
        {name:'橙広場・東西',points:[[-288,-210],[-178,-210]]},
        {name:'橙広場・南北',points:[[-275,-286],[-275,-200]]},
        {name:'青広場・東西',points:[[180,225],[289,225]]},
        {name:'青広場・南側',points:[[180,286],[289,286]]},
        {name:'青広場・南北',points:[[185,218],[185,289]]}
      ];
      function edge(line,z,side){
        const ring=city.volumes.find(v=>v.kind==='rail-deck'&&v.line===line).rings[0],cross=[];
        for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const [ax,az]=ring[j],[bx,bz]=ring[i];if((az>z)!==(bz>z))cross.push(ax+(bx-ax)*(z-az)/(bz-az));
        }
        return side==='right'?Math.max(...cross):Math.min(...cross);
      }
      for(const z of [-265,-180,-70,0,90,155,250,280])plans.push({name:'線路間の横断 '+z,
        points:[[edge('local',z,'right')-4,z],[edge('highspeed',z,'left')+4,z]],rail:true});
      plans.push({name:'線路間の縦走',points:[-280,-240,-180,-120,-60,0,60,120,160,220,280].map(z=>[(edge('local',z,'right')+edge('highspeed',z,'left'))/2,z]),rail:true});
      for(const road of profile.streetRepairs)for(const offset of [0,road.width/2-2,-road.width/2+2]){
        plans.push({name:road.id+' / '+offset,points:road.points.map((p,i)=>{
          const a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          return [p[0]-(b[1]-a[1])/len*offset,p[1]+(b[0]-a[0])/len*offset];
        })});
      }
      plans.push({name:'川沿いの高架店舗',points:city.heritage.access,grade:true});
      const saved={...u.mech};
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const plan of plans)for(const reverse of [false,true]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);
        const points=plan.points.map(p=>p.slice());if(reverse)points.reverse();
        const y=plan.rail?g.groundAt(...points[0],12):g.terrainH(...points[0]);
        u.pos.set(points[0][0],y,points[0][1]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
        let t=0,goal=1,stuck=0,airborne=0,maxStep=0;
        for(;t<90&&goal<points.length;t+=dt){
          const wish=new T.Vector3(points[goal][0]-u.pos.x,0,points[goal][1]-u.pos.z);
          if(wish.length()<.4){goal++;continue;}
          const old=u.pos.clone();g.physics(u,wish.normalize(),false,false,dt);
          if(!u.onGround)airborne++;maxStep=Math.max(maxStep,Math.abs(u.pos.y-old.y));
          stuck=Math.hypot(u.pos.x-old.x,u.pos.z-old.z)<dt*.1?stuck+dt:0;if(stuck>3)break;
        }
        const entry={name:plan.name,type,dt,reverse,success:goal===points.length&&u.onGround,airborne,maxStep,seconds:+t.toFixed(3),end:u.pos.toArray()};
        walks.push(entry);ok(entry.success,'再構築後も通れる',entry);
        ok(maxStep<((plan.rail||plan.grade) ? .55 : .25),'道路に不要な段差を増やさない',entry);
        if(plan.grade)ok(airborne===0,'川沿いの整形面で跳ねない',entry);
      }
      u.mech=saved;g.equip(u,u.cls);
      const x=(edge('local',185,'right')+edge('highspeed',185,'left'))/2;
      const top=g.castFrom(new T.Vector3(x,12,185),new T.Vector3(0,-1,0),u,30,true);
      const bottom=g.castFrom(new T.Vector3(x,-5,185),new T.Vector3(0,1,0),u,30,true);
      ok(top&&bottom&&Math.abs(top.point.y-9)<.02&&Math.abs(bottom.point.y-7.75)<.02,'接続床の上下で射線を遮る');
      const cameraCounts=[];for(let i=0;i<3;i++){g.setup();g.running=false;cameraCounts.push(city.cameraGeometryCount);}
      ok(new Set(cameraCounts).size===1,'再出撃でカメラ用形状を積み重ねない',cameraCounts);
      return {walks,flatSamples,triangles,buildingVolumes:buildings.length,collisionVolumes:city.volumes.length,cameraCounts};
    },{profile,packing:data.packing});
    const maps=[];
    // 同じ描画器・縮尺で俯瞰図を作る。比較用に元の確認済み版も読み込む。
    for(const target of [reference,folder]){
      await page.goto(pathToFileURL(path.join(target,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
      maps.push(await page.evaluate(()=>{
        const c=document.createElement('canvas');c.width=c.height=900;__cityTrial.city.drawMap(c.getContext('2d'),900,900,null);return c.toDataURL();
      }));
    }
    await page.evaluate(()=>{
      const g=__cityTrial;g.setup();g.running=false;g.player.group.visible=false;
      g.renderer.domElement.id='rebuildCanvas';
      const style=document.createElement('style');style.textContent='body *{visibility:hidden!important} #rebuildCanvas{visibility:visible!important}';document.head.append(style);
      window.trialScreenshotFog=g.scene.fog;g.scene.fog=null;
      g.camera.far=2000;g.camera.updateProjectionMatrix();
      g.camera.position.set(430,560,440);g.camera.lookAt(new g.T.Vector3(0,0,0));g.camera.updateMatrixWorld(true);g.renderView();
    });
    await page.locator('#rebuildCanvas').screenshot({path:path.join(folder,'overview.png')});
    await page.evaluate(()=>{
      const g=__cityTrial,u=g.player;g.spawn(u);u.pos.set(-185,g.terrainH(-185,-50),-50);u.yaw=0;u.pitch=-.04;
      g.scene.fog=window.trialScreenshotFog;
      g.camera.far=900;g.camera.updateProjectionMatrix();
      u.group.position.copy(u.pos);u.group.rotation.set(0,0,0);u.group.visible=true;g.updateCamera(u,.1);g.renderView();
    });
    await page.locator('#rebuildCanvas').screenshot({path:path.join(folder,'street-view.png')});
    const comparison=await browser.newPage({offline:true,viewport:{width:1640,height:900}});
    await comparison.setContent('<div id="comparison" style="width:1600px;background:#172832;color:#e0edf0;font:24px system-ui;padding:16px;display:flex;gap:16px">'+
      maps.map((url,i)=>'<div style="width:792px"><p style="margin:4px 0 12px">'+(i?'再構築案：屋上の細部を省略':'参照版：確認済みの街')+'</p><img style="width:100%;display:block" src="'+url+'"></div>').join('')+'</div>');
    await comparison.locator('#comparison').screenshot({path:path.join(folder,'comparison.png')});
    await comparison.close();
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    fs.writeFileSync(path.join(folder,'rebuild-check.json'),JSON.stringify({...result,layoutBytes:raw.length,gzipBytes:packed.length,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({walks:result.walks.length,flatSamples:result.flatSamples,triangles:Object.values(result.triangles).reduce((a,b)=>a+b),layoutBytes:raw.length,gzipBytes:packed.length,errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
