// 基地の更地・線路間の床を実機体で往復し、川と横断道路を残せたか確認する。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
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
      const g=__cityTrial,{city,T}=g;g.setup();g.running=false;const u=g.player,walks=[],saved={...u.mech};
      function ok(v,msg,data){if(!v)throw Error(msg+' '+JSON.stringify(data));}
      const blue=city.base('B');ok(blue.at[0]===260&&blue.at[1]===250,'矢印の先へ青基地を移す',blue);
      ok(city.district.roofPads.length===1&&city.district.roofPads[0].team==='R','撤去した南東棟へ向かうパッドを残さない');
      const tower=city.volumes.filter(v=>v.landmark==='black_west_tower');
      ok(tower.length===4&&Math.max(...tower.map(v=>v.top))===96&&g.groundAt(-231,-164,98)===95,'枠外の北西高層棟と着地点を残す',tower.map(v=>v.top));
      let flatSamples=0;
      const samples=[[-297,-280],[297,217],[299,286],[297,297]];
      for(const [x0,z0,x1,z1] of [[-290,-290,-175,-205],[180,216,290,290]])for(let x=x0;x<=x1;x+=5)for(let z=z0;z<=z1;z+=5)samples.push([x,z]);
      for(const [x,z] of samples){
        ok(Math.abs(g.terrainH(x,z)+2)<.001,'赤枠内の陸地は平ら',{x,z,y:g.terrainH(x,z)});
        ok(!city.volumes.some(v=>['grounded','infill','upper','elevated'].includes(v.kind)&&city.contact(v,x,z).inside),'元の棟を更地へ残さない',{x,z});
        flatSamples++;
      }
      for(const [x,z] of [[260,185],[200,185],[-150,176]])ok(g.terrainH(x,z)===city.river.bed,'赤枠に含まれる川も埋めない',{x,z,y:g.terrainH(x,z)});
      ok(Math.abs(city.river.area-24536.47)<.01,'川の輪郭を維持',city.river.area);
      const reduction=city.district.groundSimplification;
      const before=Object.values(reduction.beforeTriangles).reduce((a,b)=>a+b),after=Object.values(reduction.afterTriangles).reduce((a,b)=>a+b);
      ok(after<before*.2,'地面・舗装の細分化を大幅に省く',{before,after});
      function edge(line,z,side){
        const v=city.volumes.find(v=>v.kind==='rail-deck'&&v.line===line),cross=[];
        for(const ring of v.rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const [ax,az]=ring[j],[bx,bz]=ring[i];
          if((az>z)!==(bz>z))cross.push(ax+(bx-ax)*(z-az)/(bz-az));
        }
        return side==='right'?Math.max(...cross):Math.min(...cross);
      }
      const routes=[
        {name:'橙広場・東西',points:[[-288,-210],[-178,-210]],height:-2},
        {name:'橙広場・南北',points:[[-275,-286],[-275,-200]],height:-2},
        {name:'青広場・東西',points:[[180,225],[289,225]],height:-2},
        {name:'青広場・南側',points:[[180,286],[289,286]],height:-2},
        {name:'青広場・南北',points:[[185,218],[185,289]],height:-2}
      ];
      for(const z of [-265,-180,-70,0,90,155,250,280])routes.push({name:'線路間の横断 '+z,
        points:[[edge('local',z,'right')-4,z],[edge('highspeed',z,'left')+4,z]],height:8,rail:true});
      routes.push({name:'線路間の縦走',points:[-280,-240,-180,-120,-60,0,60,120,160,220,280].map(z=>[(edge('local',z,'right')+edge('highspeed',z,'left'))/2,z]),height:9,rail:true});
      for(const type of ['light','heavy'])for(const dt of [1/30,1/120])for(const route of routes)for(const reverse of [false,true]){
        u.mech={head:type,body:type,arms:type,legs:type,color:'team'};g.spawn(u);
        const points=route.points.map(p=>p.slice());if(reverse)points.reverse();
        const startHeight=route.rail?g.groundAt(...points[0],route.height+2):route.height;
        u.pos.set(points[0][0],startHeight,points[0][1]);u.vel.set(0,0,0);u.onGround=true;u.maxBoost=u.boost=0;
        let goal=1,t=0,stuck=0,airborne=0,maxStep=0;const start=u.pos.toArray();
        for(;t<90&&goal<points.length;t+=dt){
          const wish=new T.Vector3(points[goal][0]-u.pos.x,0,points[goal][1]-u.pos.z);
          if(wish.length()<.4){goal++;continue;}
          const old=u.pos.clone();g.physics(u,wish.normalize(),false,false,dt);
          maxStep=Math.max(maxStep,Math.abs(old.y-u.pos.y));if(!u.onGround)airborne++;
          stuck=Math.hypot(old.x-u.pos.x,old.z-u.pos.z)<dt*.1?stuck+dt:0;if(stuck>3)break;
        }
        const entry={name:route.name,type,dt,reverse,goal,success:goal===points.length&&u.onGround,airborne,maxStep,seconds:+t.toFixed(3),start,end:u.pos.toArray()};walks.push(entry);
        ok(entry.success,'平地と線路間を歩いて通り抜ける',entry);
        ok(route.rail?maxStep<.55:airborne===0&&maxStep<.001,'不要な段差や落下を増やさない',entry);
      }
      // 川の上は地面を増やさず、床の上面・下面だけが射線を遮る。
      const z=185,x=(edge('local',z,'right')+edge('highspeed',z,'left'))/2;
      ok(g.terrainH(x,z)===city.river.bed,'線路間の埋め立てで川底を埋めない',{x,z});
      const top=g.castFrom(new T.Vector3(x,12,z),new T.Vector3(0,-1,0),u,30,true);
      const bottom=g.castFrom(new T.Vector3(x,-5,z),new T.Vector3(0,1,0),u,30,true);
      ok(top&&Math.abs(top.point.y-9)<.01&&bottom&&Math.abs(bottom.point.y-7.75)<.01,'接続床の上面・下面で射線を遮る',{top:top?.point.toArray(),bottom:bottom?.point.toArray()});
      u.mech=saved;g.equip(u,u.cls);
      return {walks,flatSamples,groundTriangles:{before,after},riverArea:city.river.area};
    });
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.id='flatMap';c.width=c.height=1200;c.style='position:fixed;inset:0;z-index:10000;width:900px;height:900px';
      document.body.append(c);__cityTrial.city.drawMap(c.getContext('2d'),1200,1200,null);
    });
    await page.locator('#flatMap').screenshot({path:path.join(folder,'flat-map.png')});await page.evaluate(()=>document.getElementById('flatMap').remove());
    for(const [name,eye,target] of [['flat-orange',[-200,140,-150],[-230,-2,-240]],['flat-blue',[170,120,200],[240,-2,260]],['rail-link',[90,95,-160],[0,8,-105]]]){
      await page.evaluate(({eye,target})=>{
        const g=__cityTrial;document.getElementById('overlay').hidden=true;document.getElementById('trialPanel').style.opacity='.15';
        g.camera.position.fromArray(eye);g.camera.lookAt(new g.T.Vector3(...target));g.camera.updateMatrixWorld(true);g.renderView();
      },{eye,target});
      await page.screenshot({path:path.join(folder,name+'.png')});
    }
    assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));
    fs.writeFileSync(path.join(folder,'flat-check.json'),JSON.stringify({...result,errors,externalRequests:external,offline:true},null,2)+'\n');
    console.log(JSON.stringify({cases:result.walks.length,flatSamples:result.flatSamples,groundTriangles:result.groundTriangles,errors,external}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
