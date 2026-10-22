// 川から道路まで徒歩で戻ることと、路地の旋回中も視界が壁の外にあることを実データで確認。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/trial');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const p=await browser.newPage({viewport:{width:1440,height:900},offline:true}),errors=[],external=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await p.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await p.goto(pathToFileURL(path.join(folder,'index.html')).href);await p.waitForFunction(()=>window.__cityTrial);
    const recovery=await p.evaluate(()=>{
      const g=__cityTrial;g.setup();const {T,city}=g,u=g.player,results=[];
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      const saved={...u.mech};
      ok(city.river.exits.length===8,'両岸に出口8か所');
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const exit of city.river.exits){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);
        const sign=Math.sign(exit.end[2]-exit.start[2]);
        u.pos.set(exit.start[0],exit.start[1],exit.start[2]-sign*2);u.vel.set(0,0,0);u.onGround=true;
        Object.assign(u,{stun:'',stunT:0,planted:false,flying:false,ctrlLockT:0,dashT:0,lungeT:0,recoverT:0,maxBoost:0,boost:0,overheat:false});
        const waypoints=[exit.end,exit.street],start=u.pos.toArray();let goal=0,t=0;
        for(;t<18&&goal<waypoints.length;t+=dt){
          const at=waypoints[goal],wish=new T.Vector3(at[0]-u.pos.x,0,at[2]-u.pos.z);
          if(wish.length()<.7){goal++;continue;}
          g.physics(u,wish.normalize(),false,false,dt);
          ok(u.pos.toArray().every(Number.isFinite),'移動中の座標が有限',{type,id:exit.id});
        }
        ok(goal===waypoints.length,'ブーストなしで川から道路へ戻れる',{type,dt,id:exit.id,goal,at:u.pos.toArray(),want:waypoints[goal]});
        ok(u.onGround&&u.pos.y>city.river.water+.5,'陸上へ接地',{type,exit:exit.id,at:u.pos.toArray()});
        results.push({type,dt,id:exit.id,seconds:+t.toFixed(3),start,end:u.pos.toArray(),boost:u.boost});
      }
      u.mech=saved;g.equip(u,u.cls);
      return {walks:results,exits:city.river.exits};
    });
    const cameras=await p.evaluate(()=>{
      const g=__cityTrial,{T,city}=g,u=g.player,points=[],checks=[];
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      // 機体は通れるが肩位置は壁に入りうる、壁から1.3〜3mの実際の路地を選ぶ。
      for(let x=-240;x<=240&&points.length<24;x+=8)for(let z=-240;z<=120&&points.length<24;z+=8){
        const y=g.terrainH(x,z);if(y===city.river.bed)continue;
        let blocked=false,close=false;
        for(const v of city.nearby(x,z,3)){
          if(v.top<=y+.3||v.bottom>=y+4)continue;
          const c=city.contact(v,x,z);if(c.inside||c.distance2<1.31**2){blocked=true;break;}
          if(c.distance2<3**2)close=true;
        }
        if(!blocked&&close)points.push([x,y,z]);
      }
      ok(points.length>=16,'路地の代表地点');
      // 変更前の試走版で、肩位置が壁内へ入った4地点を固定して残す。
      const regressions=[[-240,-176],[-240,-136],[-232,-208],[-232,-136]];
      points.splice(0,regressions.length,...regressions.map(([x,z])=>[x,g.terrainH(x,z),z]));
      let samples=0,closeAim=0,maxAimError=0,minSide=2.2,minDistance=8;
      function inspect(at,yaw,pitch,dt){
        u.pos.fromArray(at);u.yaw=yaw;u.pitch=pitch;u.recoil=u.recoilYaw=0;g.updateCamera(u,dt);
        const camera=g.camera,r=city.cameraState.radius;
        for(const v of city.nearby(camera.position.x,camera.position.z,r)){
          if(camera.position.y+r<=v.bottom||camera.position.y-r>=v.top)continue;
          const c=city.contact(v,camera.position.x,camera.position.z);
          ok(!c.inside&&c.distance2>=r*r-.002,'カメラの幅が壁に入らない',{at,yaw,pitch,camera:camera.position.toArray(),r});
        }
        // 実際の画面の四隅が、建物内部に入り込まない。
        for(const x of [-1,1])for(const y of [-1,1]){
          const corner=new T.Vector3(x,y,-1).unproject(camera);
          for(const v of city.nearby(corner.x,corner.z)){
            if(corner.y<=v.bottom||corner.y>=v.top)continue;
            ok(!city.contact(v,corner.x,corner.z).inside,'画面端を壁が覆わない',{at,yaw,pitch,corner:corner.toArray()});
          }
        }
        // 縮んだカメラでも、照準は画面に見えている最初の壁を拾う。
        const dir=camera.getWorldDirection(new T.Vector3()),from=camera.position.clone().addScaledVector(dir,camera.near);
        const hit=g.castFrom(from,dir,u);
        if(hit){
          const aim=g.viewAim(u),error=aim.distanceTo(hit.point);maxAimError=Math.max(maxAimError,error);
          ok(error<.001,'視点が寄っても近い遮蔽物を照準から飛ばさない',{at,error});
          const ndc=aim.clone().project(camera);ok(Math.hypot(ndc.x,ndc.y)<.0001,'照準を画面中央に保つ');
          if(hit.dist<6)closeAim++;
        }
        const state=city.cameraState;minSide=Math.min(minSide,state.side);minDistance=Math.min(minDistance,state.distance);samples++;
      }
      for(const at of points){
        g.spawn(u);
        for(const pitch of [-.7,0,.65])for(let j=0;j<16;j++)inspect(at,j*Math.PI/8,pitch,1/60);
      }
      ok(minSide<1.5&&minDistance<4,'肩位置と後方距離の両方が縮む',{minSide,minDistance});
      ok(closeAim>10,'近い壁への照準も実際に検査',closeAim);
      const open=[0,170,0],before=city.cameraState.distance;
      inspect(open,0,0,1/60);const once=city.cameraState.distance;
      for(let i=0;i<120;i++)inspect(open,0,0,1/60);
      ok(city.cameraState.distance>7.99&&city.cameraState.side>2.19,'開けた場所で通常の距離へ戻る',city.cameraState.distance);
      if(before<7.5)ok(once<7.99,'壁を離れても距離が一瞬で戻らない',{before,once});
      checks.push({name:'路地の旋回',places:points.length,knownOcclusionRegressions:regressions.length,samples,minSide,minDistance,nearAimChecks:closeAim,maxAimError});
      return {checks,points};
    });
    // 代表画像は実機体を置いたまま描画する。
    for(const [name,which] of [['recovery','river'],['alley','alley']]){
      await p.evaluate(({which,point})=>{
        const g=__cityTrial,u=g.player;g.spawn(u);g.running=false;
        if(which==='river'){
          const e=g.city.river.exits.find(e=>e.id==='north-3');
          u.pos.set(e.start[0],g.terrainH(e.start[0],e.start[2]-8),e.start[2]-8);u.yaw=0;u.pitch=-.08;
        }else{u.pos.fromArray(point);u.yaw=Math.PI*1.5;u.pitch=0;}
        u.group.position.copy(u.pos);u.group.rotation.set(0,u.yaw,0);u.group.visible=true;
        document.getElementById('overlay').hidden=true;document.getElementById('trialPanel').style.opacity='.25';
        for(let i=0;i<90;i++)g.updateCamera(u,1/60);g.renderView();
      },{which,point:cameras.points[0]});
      await p.screenshot({path:path.join(folder,name+'.png')});
    }
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    const report={recovery,cameras,errors,externalRequests:external,offline:true};
    fs.writeFileSync(path.join(folder,'recovery-check.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({walks:recovery.walks.length,cameras:cameras.checks,errors,externalRequests:external},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
