// 同じカメラと時刻で動作を撮る。公開用の動画素材は使わない。
// node tools/test/mech_motion_capture.js dbg/mech-animation /tmp/motion [sword,spear,...]
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),cases=(process.argv[4]||'walk,sword,spear,sabre,rod,clawB,pikeM').split(',');fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 try{
  const p=await b.newPage({viewport:{width:720,height:600}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**fonts.g*/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));await p.goto('file://'+path.join(dir,'dbg.html'));
  await p.evaluate(()=>{
   const g=__g,T=g.T;g.running=false;g.renderer.render=()=>{};
   const sc=new T.Scene();sc.background=new T.Color(0x182b3b);sc.add(new T.HemisphereLight(0xf0f8ff,0x394455,1.2));const li=new T.DirectionalLight(0xffffff,1.1);li.position.set(-4,9,-6);sc.add(li);sc.add(new T.GridHelper(24,24,0x63798a,0x263f52));
   const cam=new T.PerspectiveCamera(42,720/600,.1,80);cam.position.set(8,5.5,-12);cam.lookAt(0,2.2,0);
   document.body.insertAdjacentHTML('beforeend','<canvas id="motion" style="position:fixed;inset:0;z-index:10000"></canvas><div id="caption" style="position:fixed;z-index:10001;left:22px;top:18px;color:white;font:18px sans-serif"></div>');
   const ren=new T.WebGLRenderer({canvas:document.getElementById('motion'),antialias:true,preserveDrawingBuffer:true});ren.setSize(720,600);window.__motion={sc,cam,ren,u:null};
  });
  for(const key of cases){
   const folder=path.join(out,key);fs.mkdirSync(folder,{recursive:true});
   await p.evaluate(key=>{
    const g=__g,T=g.T,r=__motion;if(r.u){r.sc.remove(r.u.group);g.disposeMech(r.u.group);}
    const m=g.buildMech(g.TEAM.B.color,{...g.MECH_DEFAULT,color:'ash'}),cls=key.startsWith('pike')?'heavy':'assault';
    r.u={...m,group:m.g,pos:new T.Vector3(),vel:new T.Vector3(),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(k=>[k,g.slotOf(k==='aux'&&key!=='walk'?key:g.loadout[cls][k])])),weapon:key==='walk'?'main':'aux',swing:null};
    r.sc.add(m.g);r.land=false;
   },key);
   for(let frame=0;frame<90;frame++){
    await p.evaluate(({frame,key})=>{
     const g=__g,T=g.T,r=__motion,u=r.u,t=frame/30;u.group.rotation.set(0,0,0);u.group.position.set(0,0,0);
     let label='';
     if(key==='walk'){
      const walk=t<1.35,air=t>=1.35&&t<2.15;u.vel.set(walk?3:0,air?-8:0,walk?-8:0);u.pos.x+=walk?.04:0;u.pos.z-=walk?.1:0;u.onGround=!air;u.dashState=t>=1.05&&t<1.35?'short':'';
      if(t>=2.15&&!r.land){r.land=true;if(u.rig)g.land(u,32);}if(t>2.65)u.stun='';
      label=walk?(u.dashState?'ダッシュ':'歩行・横移動'):air?'空中姿勢':'着地・復帰';
     }else{
      const strong=t>=1.3,a=strong?u.slots.aux.w.strong:u.slots.aux.w.normal,elapsed=strong?t-1.5:t-.2;
      u.swing=elapsed>=0&&elapsed<a.time?{a,t:elapsed,yaw0:0,aimed:false,hit:new Set(),stopped:false}:null;
      label=(strong?'ダッシュ攻撃':'通常攻撃')+(u.swing?' → 振り抜き・戻し':' → 構え');
     }
     g.weaponLook(u,1/30);u.group.updateMatrixWorld(true);r.ren.render(r.sc,r.cam);document.getElementById('caption').textContent=(key==='walk'?'移動':u.slots.aux.w.name)+'　'+label;
    },{frame,key});
    await p.screenshot({path:path.join(folder,String(frame).padStart(4,'0')+'.png')});
   }
   console.log(key+': 90 frames');
  }
  if(errors.length)throw new Error(errors.join('\n'));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
