// 初版→高架→店舗→通路保護後の単純化、の出自と実走を確かめ、前の100KB案と比較する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function previewData(file){
  const html=fs.readFileSync(file,'utf8'),old=html.match(/const DATA=(.*);\n/);
  if(old)return JSON.parse(old[1]);
  let data=JSON.parse(html.match(/let payload=(.*);\nif\(typeof payload/)[1]);
  if(typeof data==='string')data=JSON.parse(zlib.gunzipSync(Buffer.from(data,'base64')));return data.data;
}
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/original_rebuilt'),old=path.resolve(process.argv[3]||'mapdesign/akihabara_city/rebuilt');
  const original='mapdesign/akihabara_city/preview.html',record=JSON.parse(fs.readFileSync(path.join(folder,'reconstruction.json')));
  const source=previewData(original),first=previewData(path.join(folder,'01_rail/preview.html')),second=previewData(path.join(folder,'02_shops/preview.html'));
  assert.equal(sha(fs.readFileSync(original)),record.originalPreviewSHA256);
  assert.equal(source.bldg,first.bldg,'高架延長段階で元の建物を削らない');assert.equal(source.bldg,second.bldg,'店舗追加段階でも元の建物を削らない');
  assert.equal(first.shops,'','第一段階では店舗を追加しない');assert(second.shops.length>100,'第二段階で高架下へ店舗を追加');
  const layout=fs.readFileSync(path.join(folder,'layout.json')),data=JSON.parse(layout);
  assert(layout.length<=100000);assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(folder,'layout.json.gz'))),layout);
  const html=fs.readFileSync(path.join(folder,'index.html'),'utf8');
  assert.deepEqual(zlib.gunzipSync(Buffer.from(html.match(/const CITY = await createCityTrial\(T,"([^"]+)"\)/)[1],'base64')),layout);
  assert.equal(record.protectedAreaBlockedAfterQuantization,0);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:1000}}),errors=[],external=[],results=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    const maps=[];
    for(const [name,target] of [['前の100KB案',old],['初版からの再構築',folder]]){
      await page.goto(pathToFileURL(path.join(target,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
      const report=await page.evaluate(({name,passages})=>{
        const g=__cityTrial,{T,city}=g;g.setup();g.running=false;const u=g.player,walks=[];
        for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const plan of passages)for(const reverse of [false,true]){
          u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);
          const [a,b]=reverse?[plan.end,plan.start]:[plan.start,plan.end];u.pos.fromArray(a);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          let t=0,stuck=0,airborne=0;
          for(;t<18;t+=dt){
            const wish=new T.Vector3(b[0]-u.pos.x,0,b[2]-u.pos.z);if(wish.length()<.5)break;
            const old=u.pos.clone();g.physics(u,wish.normalize(),false,false,dt);if(!u.onGround)airborne++;
            stuck=Math.hypot(u.pos.x-old.x,u.pos.z-old.z)<dt*.1?stuck+dt:0;if(stuck>3)break;
          }
          walks.push({id:plan.id,type,dt,reverse,success:Math.hypot(b[0]-u.pos.x,b[2]-u.pos.z)<.5&&u.onGround,airborne,seconds:+t.toFixed(3),start:a,end:u.pos.toArray()});
        }
        return {name,walks,failed:walks.filter(v=>!v.success).length,triangles:Object.fromEntries(Object.entries(city.arrays).map(([k,v])=>[k,v.length/9])),volumes:city.volumes.length,landmarks:city.landmarks.length};
      },{name,passages:record.passages});
      results.push(report);
      maps.push(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=900;__cityTrial.city.drawMap(c.getContext('2d'),900,900,null);return c.toDataURL();}));
    }
    assert.equal(results[1].failed,0,JSON.stringify(results[1].walks.filter(v=>!v.success)));
    for(const [k,v] of Object.entries(data.packing.layers))assert.equal(results[1].triangles[k],v.triangles,k+' 展開した実形状の面数');
    assert.equal(results[1].landmarks,18);
    const features=await page.evaluate(()=>{
      const g=__cityTrial,{T,city}=g,u=g.player,walks=[],flights=[],drops=[];
      function ok(v,msg,detail){if(!v)throw Error(msg+' '+JSON.stringify(detail));}
      let flatSamples=0;
      for(const [x0,z0,x1,z1] of [[-290,-290,-175,-205],[180,216,290,290]])for(let x=x0;x<=x1;x+=5)for(let z=z0;z<=z1;z+=5){
        ok(Math.abs(g.terrainH(x,z)+2)<.01&&!city.volumes.some(v=>v.kind==='grounded'&&city.contact(v,x,z).inside),'採用した基地区域は平らな更地',{x,z});flatSamples++;
      }
      const colors=g.mapRoot.getObjectByName('city-bldg').geometry.attributes.color.array;
      for(const mark of city.landmarks){
        const c=new T.Color(mark.color);let found=false;
        for(let i=0;i<colors.length;i+=3)if(Math.abs(colors[i]-c.r)<.001&&Math.abs(colors[i+1]-c.g)<.001&&Math.abs(colors[i+2]-c.b)<.001){found=true;break;}
        ok(found,'目印の色を描画形状へ適用',mark.id);
      }
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};
        const plans=[...city.district.accessRoutes.map(v=>({name:'基地からパッド',points:v.points})),
          {name:'南北下層',points:[[-26.625,8,-15],[-28,8,0],[-37,8,79]]},
          {name:'南北上層',points:[[13.5,10,-15],[12,10,0],[4.1,10,79]]}];
        for(const plan of plans){
          g.spawn(u);u.pos.fromArray(plan.points[0]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          let goal=1,t=0;
          for(;t<60&&goal<plan.points.length;t+=dt){
            const wish=new T.Vector3(...plan.points[goal]).sub(u.pos).setY(0);if(wish.length()<.4){goal++;continue;}
            g.physics(u,wish.normalize(),false,false,dt);
          }
          ok(goal===plan.points.length&&u.onGround,'高架と乗り場へ徒歩で通れる',{type,dt,name:plan.name,at:u.pos.toArray()});
          walks.push({type,dt,name:plan.name,seconds:+t.toFixed(3),end:u.pos.toArray()});
        }
        for(const p of g.jumpPads){
          g.spawn(u);u.pos.copy(p.pos);u.vel.set(0,0,0);u.onGround=true;u.catCd=0;u.maxBoost=u.boost=0;g.jumpPadUpdate(dt);
          ok(u.flying&&u.vel.y>0,'パッド接触で射出');let peak=u.pos.y,t=0,steer=false;
          for(;t<14;t+=dt){
            if(u.pos.y>p.exit.y+1)steer=true;
            const wish=steer?p.exit.clone().sub(u.pos).setY(0):new T.Vector3();if(wish.length()>.3)wish.normalize();else wish.set(0,0,0);
            g.physics(u,wish,false,false,dt);peak=Math.max(peak,u.pos.y);if(u.onGround)break;
          }
          ok(t<14&&Math.abs(u.pos.y-p.exit.y)<.1&&Math.hypot(u.pos.x-p.exit.x,u.pos.z-p.exit.z)<4,'高層棟の屋上へ着地',{type,dt,at:u.pos.toArray(),exit:p.exit.toArray()});
          flights.push({type,dt,seconds:+t.toFixed(3),end:u.pos.toArray(),peak});
        }
        for(const point of [[-56,66],[-56,72],[-55.5,78]]){
          g.spawn(u);u.pos.set(point[0],20,point[1]);u.vel.set(0,0,0);u.onGround=false;u.maxBoost=u.boost=0;
          for(let t=0;t<3;t+=dt)g.physics(u,new T.Vector3(),false,false,dt);
          const landed=u.pos.clone(),queue=[{x:landed.x,z:landed.z,parent:-1}],seen=new Set(['0,0']);let found=-1;
          function safe(x,z){
            const y=g.groundAt(x,z,landed.y+.1);if(Math.abs(y-landed.y)>.5||g.ceilingAt(x,z,y)<y+4.05)return false;
            return ![...city.nearby(x,z,1.4)].some(v=>v.bottom<y+4&&v.top>y+.3&&(city.contact(v,x,z).inside||city.contact(v,x,z).distance2<1.38**2));
          }
          for(let i=0;i<queue.length&&queue.length<5000;i++){
            const p=queue[i];if(Math.hypot(p.x-landed.x,p.z-landed.z)>=25){found=i;break;}
            for(const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2]]){
              const x=p.x+dx,z=p.z+dz,key=Math.round((x-landed.x)/2)+','+Math.round((z-landed.z)/2);
              if(seen.has(key))continue;seen.add(key);
              if(safe(x,z)&&safe(p.x+dx/2,p.z+dz/2))queue.push({x,z,parent:i});
            }
          }
          ok(found>=0,'既知の穴の位置から脱出する通路がある',{type,dt,point,landed:landed.toArray()});
          const route=[];for(let i=found;i>=0;i=queue[i].parent)route.unshift(queue[i]);let goal=1,t=0;
          for(;t<20&&goal<route.length;t+=dt){
            const wish=new T.Vector3(route[goal].x-u.pos.x,0,route[goal].z-u.pos.z);if(wish.length()<.25){goal++;continue;}
            g.physics(u,wish.normalize(),false,false,dt);
          }
          ok(goal===route.length&&u.onGround,'落下後にブーストなしで周囲の通路へ出られる',{type,dt,point,goal,total:route.length,at:u.pos.toArray()});
          drops.push({type,dt,point,landed:landed.toArray(),end:u.pos.toArray(),seconds:+t.toFixed(3)});
        }
      }
      return {walks,flights,drops,flatSamples};
    });
    await page.evaluate(()=>{
      const g=__cityTrial;g.player.group.visible=false;g.renderer.domElement.id='originalCanvas';
      const style=document.createElement('style');style.textContent='body *{visibility:hidden!important} #originalCanvas{visibility:visible!important}';document.head.append(style);
      g.scene.fog=null;g.camera.far=2000;g.camera.updateProjectionMatrix();g.camera.position.set(430,560,440);g.camera.lookAt(new g.T.Vector3(0,0,0));g.camera.updateMatrixWorld(true);g.renderView();
    });
    await page.locator('#originalCanvas').screenshot({path:path.join(folder,'overview.png')});
    await page.evaluate(()=>{
      const g=__cityTrial,u=g.player,p=g.city.district.passages[0];g.spawn(u);u.pos.fromArray(p.start);u.yaw=Math.atan2(p.end[0]-p.start[0],p.end[2]-p.start[2]);u.pitch=-.04;
      u.group.position.copy(u.pos);u.group.rotation.set(0,u.yaw,0);u.group.visible=true;g.camera.far=900;g.camera.updateProjectionMatrix();g.updateCamera(u,.1);g.renderView();
    });
    await page.locator('#originalCanvas').screenshot({path:path.join(folder,'alley-view.png')});
    const comparison=await browser.newPage({offline:true,viewport:{width:1640,height:900}});
    await comparison.setContent('<div id="comparison" style="width:1600px;padding:16px;display:flex;gap:16px;background:#172832;color:#e0edf0;font:24px system-ui">'+maps.map((url,i)=>'<div style="width:792px"><p style="margin:4px 0 12px">'+(i?'初版から通路を残す案':'前の100KB案')+'</p><img style="display:block;width:100%" src="'+url+'"></div>').join('')+'</div>');
    await comparison.locator('#comparison').screenshot({path:path.join(folder,'comparison.png')});await comparison.close();
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    fs.writeFileSync(path.join(folder,'original-check.json'),JSON.stringify({sourceSHA256:record.originalPreviewSHA256,sourceBuildingsUnchangedInStages1And2:true,layoutBytes:layout.length,results,features,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({cases:results[1].walks.length,baselineFailed:results[0].failed,candidateFailed:results[1].failed,layoutBytes:layout.length,errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
