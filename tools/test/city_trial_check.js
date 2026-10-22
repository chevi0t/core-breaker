// 都市試走版をオフラインで開き、本体の入力とphysicsで地面・複層・壁・四辺を検査する。
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
  const folder = path.resolve(process.argv[2] || 'mapdesign/akihabara_city/trial');
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=swiftshader']});
  try {
    const context = await browser.newContext({offline:true,viewport:{width:1440,height:900}});
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    page.on('request', r => { if(/^https?:/.test(r.url())) external.push(r.url()); });
    await page.goto(pathToFileURL(path.join(folder,'index.html')).href);
    await page.waitForFunction(() => window.__cityTrial, {timeout:60000});
    await page.locator('#start').click();
    // DOMへの直接代入でなく、実際のキー入力を通して移動する。
    const before = await page.evaluate(() => __cityTrial.player.pos.toArray());
    await page.keyboard.down('KeyW');
    await page.waitForFunction(([x,,z]) => Math.hypot(__cityTrial.player.pos.x-x,__cityTrial.player.pos.z-z)>2,before,{timeout:15000});
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!__cityTrial.running&&!document.pointerLockElement&&!document.getElementById('overlay').hidden);
    const inputWalk = await page.evaluate(start => {
      const g=__cityTrial;
      return {start,end:g.player.pos.toArray(),distance:Math.hypot(g.player.pos.x-start[0],g.player.pos.z-start[2])};
    },before);
    const result = await page.evaluate(() => {
      const g=__cityTrial,{city,T}=g,u=g.player,dt=1/120,zero=new T.Vector3(),checks=[];
      function ok(condition,message,details) { if(!condition)throw Error(message+' '+JSON.stringify(details)); }
      function reset(at,onGround=true) {
        g.spawn(u);u.pos.fromArray(at);u.vel.set(0,0,0);u.onGround=onGround;
        Object.assign(u,{stun:'',stunT:0,dashT:0,lungeT:0,recoverT:0,ctrlLockT:0,flying:false,planted:false,electricT:0,charging:false,chargerOn:false});
      }
      function tick(seconds,wish=zero,boost=false,jump=false) {
        let highest=u.pos.y;
        for(let i=0;i<Math.round(seconds/dt);i++){
          g.physics(u,wish,boost,jump&&i===0,dt);
          highest=Math.max(highest,u.pos.y);
          ok(u.pos.toArray().every(Number.isFinite),'有限の座標',u.pos.toArray());
          ok(Math.abs(u.pos.x)<=298.70001&&Math.abs(u.pos.z)<=298.70001,'範囲内',u.pos.toArray());
          ok(u.pos.y>=city.river.bed-.001,'川底より下へ落ちない',u.pos.toArray());
        }
        return highest;
      }
      ok(g.units.length===1&&g.plants.length===0,'プレイヤー1機だけ');
      ok(!g.mapRoot.children.some(m=>m.userData.ref),'基地などの施設を置かない');
      for(let i=0;i<city.spawns.length;i++){
        document.getElementById('trialSpawn').value=i;g.spawn(u);
        const start=u.pos.toArray();tick(2);
        ok(u.onGround&&u.pos.distanceTo(new T.Vector3(...start))<.03,'開始地点で安定',city.spawns[i]);
        checks.push({name:'開始地点 '+city.spawns[i].name,start,end:u.pos.toArray()});
      }
      document.getElementById('trialSpawn').value=0;
      const street=city.spawns[0].at.slice();street[1]=g.terrainH(street[0],street[2]);
      reset(street);const start=u.pos.clone(),high=tick(2,zero,false,true);
      ok(high-start.y>6&&high-start.y<7.1,'本体のジャンプ高度',high-start.y);
      ok(u.onGround&&Math.abs(u.pos.y-start.y)<.02,'ジャンプ後に接地');
      checks.push({name:'ジャンプ',height:high-start.y});
      reset(street);tick(.6,new T.Vector3(0,0,-1));const walked=u.pos.distanceTo(start);
      reset(street);g.shortDash(u,new T.Vector3(0,0,-1));tick(.6,new T.Vector3(0,0,-1),true);
      const boosted=u.pos.distanceTo(start);ok(boosted>walked*1.4,'ブーストで加速',{walked,boosted});
      ok(u.boost<u.maxBoost,'本体のブーストを消費');checks.push({name:'歩行とブースト',walked,boosted});
      // 上下の高架を別々の床として扱い、下層からジャンプして上層を突き抜けない。
      for(const [name,at,floor] of [['駅屋根',[-25,35,40],25.5],['上層高架',[-25,22,26],18],['下層高架',[-30,11,28],8]]){
        reset(at,false);tick(3);ok(Math.abs(u.pos.y-floor)<.03,'落下して着地 '+name,u.pos.toArray());
        checks.push({name:'落下着地 '+name,at:u.pos.toArray()});
      }
      reset([-43,18,30]);const ceiling=g.ceilingAt(u.pos.x,u.pos.z,u.pos.y);
      ok(Math.abs(ceiling-24.8)<.01,'駅屋根の下面',ceiling);
      const jumpTop=tick(2,zero,false,true);ok(jumpTop<=ceiling-4+.01&&jumpTop>19,'頭上の屋根を通り抜けない',jumpTop);
      ok(Math.abs(u.pos.y-18)<.02,'上層高架へ戻る');checks.push({name:'天井',ceiling,highestFeet:jumpTop});
      // 屋根から横へ出たときは、空中の床に張り付かず地面へ降りる。
      reset([-160,18,12]);tick(3,new T.Vector3(0,0,-1));
      ok(u.pos.y<17.5,'高架の外へ出ると落下',u.pos.toArray());checks.push({name:'高架から降りる',at:u.pos.toArray()});
      // 長い外壁のうち、前後が空いている地点を実データから選んで高速接触させる。
      let wall;
      for(const v of city.volumes){
        if(v.kind!=='grounded'||v.top<15)continue;
        const ring=v.rings[0];
        for(let i=0;i<ring.length;i++){
          const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          if(len<16)continue;
          const x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;if(Math.abs(x)>250||Math.abs(z)>250)continue;
          for(const sign of [-1,1]){
            const nx=(b[1]-a[1])/len*sign,nz=-(b[0]-a[0])/len*sign;
            const sx=x+nx*5,sz=z+nz*5,y=g.terrainH(sx,sz);
            if(y===city.river.bed||city.contact(v,sx,sz).inside||!city.contact(v,x-nx*2,z-nz*2).inside)continue;
            if([...city.nearby(sx,sz,1.4)].some(q=>q.top>y+.3&&q.bottom<y+4&&(city.contact(q,sx,sz).inside||city.contact(q,sx,sz).distance2<2)))continue;
            wall={v,x,z,nx,nz,start:[sx,y,sz]};break;
          }
          if(wall)break;
        }
        if(wall)break;
      }
      ok(wall,'壁の試験地点がある');
      for(const dash of [false,true]){
        reset(wall.start);const wish=new T.Vector3(-wall.nx,0,-wall.nz);if(dash)g.shortDash(u,wish);tick(1.5,wish,dash);
        const c=city.contact(wall.v,u.pos.x,u.pos.z);ok(!c.inside&&c.distance2>=1.3**2-.02,'壁を抜けない',{dash,at:u.pos.toArray(),contact:c});
        checks.push({name:dash?'ダッシュで壁へ':'歩いて壁へ',at:u.pos.toArray(),wallDistance:Math.sqrt(c.distance2)});
      }
      // 弾・視線も同じ外形で止まる。屋根と斜めの外壁を本体のcastFromで検査。
      const origin=new T.Vector3(wall.x+wall.nx*5,wall.start[1]+2,wall.z+wall.nz*5),dir=new T.Vector3(-wall.nx,0,-wall.nz);
      const hit=g.castFrom(origin,dir,u,10,true);ok(hit&&hit.dist<5.1&&hit.dist>4.8,'壁が弾を遮る',hit);
      const roofHit=g.castFrom(new T.Vector3(-25,100,40),new T.Vector3(0,-1,0),u,150,true);
      ok(roofHit&&Math.abs(roofHit.point.y-25.5)<.01,'屋根が弾を遮る',roofHit);checks.push({name:'射線',wallDistance:hit.dist,roofY:roofHit.point.y});
      reset([wall.x+wall.nx*2,wall.start[1],wall.z+wall.nz*2]);u.yaw=Math.atan2(-wall.nx,-wall.nz);g.updateCamera(u,.1);
      const cameraContact=city.contact(wall.v,g.camera.position.x,g.camera.position.z);
      ok(!cameraContact.inside&&cameraContact.distance2>.01,'カメラが外壁を抜けない',g.camera.position.toArray());
      checks.push({name:'カメラの壁回避',camera:g.camera.position.toArray()});
      // 元モデルの橋について、水面上の床とその下の川底をそれぞれ検査。
      const a=city.arrays.brid;let bridge;
      for(let i=0;i<a.length;i+=9){
        const tri=new T.Triangle(...[0,3,6].map(j=>new T.Vector3(a[i+j],a[i+j+1],a[i+j+2]))),n=tri.getNormal(new T.Vector3()),p=tri.getMidpoint(new T.Vector3());
        if(n.y<.9||tri.getArea()<3||g.terrainH(p.x,p.z)>city.river.bed+.01||p.y<city.river.bed+5)continue;
        if(Math.abs(g.groundAt(p.x,p.z,p.y+.01)-p.y)>.05)continue;
        bridge=p;break;
      }
      ok(bridge,'川に架かる橋がある');reset([bridge.x,bridge.y+2,bridge.z],false);tick(3);
      ok(Math.abs(u.pos.y-bridge.y)<.06,'橋の上に着地',u.pos.toArray());const over=u.pos.toArray();
      reset([bridge.x,city.river.bed,bridge.z]);tick(1);
      ok(Math.abs(u.pos.y-city.river.bed)<.01,'橋の下では川底に接地',u.pos.toArray());
      const bridgeCeiling=g.ceilingAt(u.pos.x,u.pos.z,u.pos.y),bridgeJump=tick(2,zero,false,true);
      ok(Number.isFinite(bridgeCeiling)&&bridgeJump+4<=bridgeCeiling+.01,'橋の下面をジャンプで抜けない',{bridgeCeiling,bridgeJump});
      checks.push({name:'橋の上と下',over,under:u.pos.toArray(),ceiling:bridgeCeiling,highestFeet:bridgeJump});
      // 四辺と四隅に向けて、通常移動を超える速度でも境界を越えない。
      for(const [x,z] of [[298,0],[-298,0],[0,298],[0,-298],[298,298],[-298,298],[298,-298],[-298,-298]]){
        reset([x,170,z],false);u.vel.set(Math.sign(x)*600,0,Math.sign(z)*600);u.flying=true;u.flightSpeed=1000;
        tick(.3);ok(Math.abs(u.pos.x)<=298.70001&&Math.abs(u.pos.z)<=298.70001,'高速で境界を越えない',u.pos.toArray());
        checks.push({name:'四辺・四隅',from:[x,z],at:u.pos.toArray()});
      }
      // 同じ場所を軽量・重量の実際の機体性能でも走る。
      const savedMech={...u.mech};
      for(const type of ['light','heavy']){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};
        reset(street);const wish=new T.Vector3(0,0,-1);g.shortDash(u,wish);tick(.6,wish,true);
        ok(u.onGround,'軽量・重量で地面を維持',type);
        checks.push({name:'機体 '+type,walk:u.walkV,dash:u.dashV,end:u.pos.toArray()});
      }
      u.mech=savedMech;g.equip(u,u.cls);
      return {checks,singlePlayer:g.units.length,bases:0,plants:g.plants.length,nativeMovement:true,volumes:city.volumes.length,
        river:city.river.bed,meshTriangles:Object.fromEntries(Object.entries(city.arrays).map(([k,v])=>[k,v.length/9]))};
    });
    for(const [i,name] of [[0,'street'],[1,'station'],[2,'rail'],[4,'river']]){
      await page.selectOption('#trialSpawn',String(i));
      await page.evaluate(() => {const g=__cityTrial;g.running=false;g.player.pitch=-.06;g.updateCamera(g.player,.1);document.getElementById('overlay').hidden=true;g.renderView();});
      await page.screenshot({path:path.join(folder,name+'.png')});
    }
    await page.evaluate(()=>{__cityTrial.running=true;});
    await page.keyboard.press('KeyM');
    await page.waitForFunction(()=>!document.getElementById('bigMap').hidden);
    await page.screenshot({path:path.join(folder,'map.png')});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!__cityTrial.running&&!document.getElementById('overlay').hidden);
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    const report={...result,inputWalk,errors,externalRequests:external,offline:true};
    fs.writeFileSync(path.join(folder,'movement-check.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
