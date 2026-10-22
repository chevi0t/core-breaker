// 指定区域の基地、復元した路地、高層棟へのジャンプパッドを本体のphysicsで実走する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
  const folder=path.resolve(process.argv[2]||'mapdesign/akihabara_city/trial');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try{
    const page=await browser.newPage({offline:true,viewport:{width:1440,height:900}}),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    await page.addInitScript(()=>{requestAnimationFrame=()=>0;AudioContext=undefined;});
    await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.waitForFunction(()=>window.__cityTrial);
    const result=await page.evaluate(()=>{
      const g=__cityTrial,{city,T}=g;g.setup();g.running=false;const u=g.player,walks=[],flights=[],approaches=[],railCrossings=[];
      const saved={...u.mech};
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      for(const b of city.district.bases){
        const [x,z]=b.at;
        ok(b.team==='B'?x>150&&z>210:x<-180&&z<-190,'赤枠の陸上に基地',b);
        ok(g.terrainH(x,z)>city.river.water,'基地を水に置かない',b);
        ok(g.cores[b.team].group.position.distanceTo(new T.Vector3(x,b.height,z))<.01,'コアも実際の基地位置',b);
        for(const dx of [-20,0,20])for(const dz of [-20,0,20])if(Math.hypot(dx,dz)<26){
          ok(Math.abs(g.terrainH(x+dx,z+dz)-b.height)<.01,'コア周辺の床が平坦',{team:b.team,dx,dz});
        }
      }
      ok(city.district.reopenedArea>5000&&city.district.minimumPassageWidth===5,'過剰な路地充填を戻した');
      ok(city.district.shops[0].area>1000,'東西高架下に店舗を追加');
      const cross=city.volumes.filter(v=>v.kind==='rail-shop'&&v.line==='cross');
      ok(cross.length>0,'東西店舗の壁にも実体');
      // 店舗内では機体が押し戻され、下を横断する南北線は元の高さを維持する。
      let checked=0,hiddenShops=0;
      for(const v of cross){
        let face;
        const ring=v.rings[0];
        for(let i=0;i<ring.length&&!face;i++){
          const [ax,az]=ring[i],[bx,bz]=ring[(i+1)%ring.length],length=Math.hypot(bx-ax,bz-az);if(length<4)continue;
          const x=(ax+bx)/2,z=(az+bz)/2;let nx=(bz-az)/length,nz=-(bx-ax)/length;
          if(city.contact(v,x+nx*.1,z+nz*.1).inside){nx=-nx;nz=-nz;}
          const sx=x+nx*2.2,sz=z+nz*2.2,y=g.terrainH(sx,sz);
          if(Math.abs(sx)>298||Math.abs(sz)>298||y<city.river.water)continue;
          if([...city.nearby(sx,sz,1.4)].some(w=>w.top>y+.3&&w.bottom<y+4&&(city.contact(w,sx,sz).inside||city.contact(w,sx,sz).distance2<1.4**2)))continue;
          face={sx,sz,y,nx,nz};
        }
        // 他の店舗に囲まれた内部区画には、地上から接近できる外壁がない。
        if(!face){hiddenShops++;continue;}
        g.spawn(u);u.pos.set(face.sx,face.y,face.sz);u.vel.set(0,0,0);u.onGround=true;
        for(let i=0;i<60;i++)g.physics(u,new T.Vector3(-face.nx,0,-face.nz),false,false,1/120);
        const c=city.contact(v,u.pos.x,u.pos.z);ok(!c.inside&&c.distance2>1.29**2,'店舗の外から壁を歩いて抜けない',u.pos.toArray());checked++;
      }
      ok(checked>=4,'地上に露出した店舗の外壁を検査',{checked,hiddenShops});
      ok(Math.abs(g.groundAt(-30,28,8)-8)<.01&&Math.abs(g.groundAt(10,28,10)-10)<.01,'交差する南北線の走行空間を保つ');
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};
        for(const route of [
          {line:'local',at:[-26.625,8,-15],points:[[-28,8,0],[-37,8,79]]},
          {line:'highspeed',at:[13.5,10,-15],points:[[12,10,0],[4.1,10,79]]}
        ]){
          g.spawn(u);u.pos.fromArray(route.at);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          let t=0,goal=0;
          for(;t<30&&goal<route.points.length;t+=dt){
            const wish=new T.Vector3(...route.points[goal]).sub(u.pos).setY(0);
            if(wish.length()<.4){goal++;continue;}
            g.physics(u,wish.normalize(),false,false,dt);
          }
          ok(goal===route.points.length&&u.onGround&&Math.abs(u.pos.y-route.at[1])<.02,'東西店舗を足しても南北線を歩いて通れる',{type,dt,line:route.line,goal,at:u.pos.toArray()});
          railCrossings.push({type,dt,line:route.line,seconds:+t.toFixed(3),end:u.pos.toArray()});
        }
        for(const route of city.district.accessRoutes){
          g.spawn(u);u.pos.fromArray(route.points[0]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          let t=0,goal=1;
          for(;t<60&&goal<route.points.length;t+=dt){
            const wish=new T.Vector3(...route.points[goal]).sub(u.pos).setY(0);
            if(wish.length()<.4){goal++;continue;}
            g.physics(u,wish.normalize(),false,false,dt);
          }
          ok(goal===route.points.length&&u.onGround,'基地からパッドへ徒歩でたどり着ける',{type,dt,team:route.team,goal,at:u.pos.toArray(),points:route.points});
          approaches.push({type,dt,team:route.team,seconds:+t.toFixed(3),length:route.length,end:u.pos.toArray()});
        }
        for(const [i,p] of city.district.passages.entries()){
          g.spawn(u);u.pos.fromArray(p.start);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
          const target=new T.Vector3(...p.end),start=u.pos.toArray();let t=0;
          for(;t<10;t+=dt){
            const wish=target.clone().sub(u.pos).setY(0);if(wish.length()<.6)break;
            g.physics(u,wish.normalize(),false,false,dt);
          }
          ok(t<10&&u.onGround,'復元した路地を歩いて通り抜ける',{type,dt,i,start,end:u.pos.toArray(),target:p.end});
          walks.push({type,dt,passage:i,seconds:+t.toFixed(3),start,end:u.pos.toArray()});
        }
        for(const [i,p] of g.jumpPads.entries()){
          g.spawn(u);u.pos.copy(p.pos);u.vel.set(0,0,0);u.onGround=true;u.catCd=0;u.maxBoost=u.boost=0;
          g.jumpPadUpdate(dt);ok(u.flying&&u.vel.y>0,'接触でジャンプパッドから射出');
          const start=u.pos.toArray();let peak=u.pos.y,t=0,steer=false;
          for(;t<14;t+=dt){
            if(u.pos.y>p.exit.y+1)steer=true;
            const wish=steer?p.exit.clone().sub(u.pos).setY(0):new T.Vector3();
            if(wish.length()>.3)wish.normalize();else wish.set(0,0,0);
            g.physics(u,wish,false,false,dt);peak=Math.max(peak,u.pos.y);
            if(u.onGround)break;
          }
          ok(t<14&&Math.abs(u.pos.y-p.exit.y)<.1&&Math.hypot(u.pos.x-p.exit.x,u.pos.z-p.exit.z)<4,'ブーストなしで高層棟へ着地',{type,dt,i,start,at:u.pos.toArray(),exit:p.exit.toArray(),peak});
          flights.push({type,dt,pad:i,seconds:+t.toFixed(3),start,end:u.pos.toArray(),peak,boost:u.boost});
        }
      }
      u.mech=saved;g.equip(u,u.cls);
      return {walks,flights,approaches,railCrossings,shopWalls:checked,hiddenShops,bases:city.district.bases,reopenedArea:city.district.reopenedArea,shops:city.district.shops};
    });
    // 俯瞰図は実際にゲームが表示する地図から出す。
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.id='districtPlan';c.width=c.height=1200;c.style='position:fixed;inset:0;z-index:10000;width:900px;height:900px;background:#18232b';
      document.body.append(c);__cityTrial.city.drawMap(c.getContext('2d'),1200,1200,null);
    });
    await page.locator('#districtPlan').screenshot({path:path.join(folder,'district-map.png')});
    await page.evaluate(()=>document.getElementById('districtPlan').remove());
    for(const [name,at,yaw,pitch] of [['district-street',[-185,0,-50],-.45,.04],['cross-shops',[-185,0,-1],-1.87,-.12],['roof-pad',[252,0,274],-Math.PI/2,-.12],['base',[190,0,275],0,-.1]]){
      await page.evaluate(({at,yaw,pitch})=>{
        const g=__cityTrial,u=g.player;g.spawn(u);u.pos.fromArray(at);u.pos.y=g.terrainH(at[0],at[2]);u.yaw=yaw;u.pitch=pitch;
        u.group.position.copy(u.pos);u.group.rotation.set(0,yaw,0);u.group.visible=true;
        document.getElementById('overlay').hidden=true;document.getElementById('trialPanel').style.opacity='.15';
        for(let i=0;i<60;i++)g.updateCamera(u,1/60);g.renderView();
      },{at,yaw,pitch});
      await page.screenshot({path:path.join(folder,name+'.png')});
    }
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    fs.writeFileSync(path.join(folder,'district-check.json'),JSON.stringify({...result,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({walks:result.walks.length,flights:result.flights.length,approaches:result.approaches.length,railCrossings:result.railCrossings.length,shopWalls:result.shopWalls,hiddenShops:result.hiddenShops,reopenedArea:result.reopenedArea,errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
