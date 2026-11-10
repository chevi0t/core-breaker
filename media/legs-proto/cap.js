const path=require('node:path');const {chromium}=require('playwright');
const S=__dirname,W=1600,H=1000;
(async()=>{
 const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**fonts.g*/**',r=>r.fulfill({body:'',contentType:'text/css'}));await page.route('**cdn.jsdelivr.net/**',r=>r.fulfill({body:'',contentType:'text/javascript'}));console.log('goto');await page.goto('file://'+path.join(S,'dbg','dbg.html'));
 console.log('loaded');await page.evaluate(({W,H})=>{
  const g=__g,T=g.T;g.running=false;g.renderer.render=()=>{};
  const sc=new T.Scene();sc.background=new T.Color(0x1b2c3a);sc.add(new T.HemisphereLight(0xf0f8ff,0x394455,1.15));
  const light=new T.DirectionalLight(0xffffff,1.1);light.position.set(-5,9,-7);sc.add(light);
  const grid=new T.GridHelper(40,40,0x7f93a0,0x33495a);sc.add(grid);
  document.body.insertAdjacentHTML('beforeend','<canvas id="review" style="position:fixed;inset:0;z-index:10000"></canvas><div id="caption" style="position:fixed;z-index:10001;left:24px;top:16px;color:white;font:bold 26px sans-serif;white-space:pre-line;text-shadow:0 0 6px #000"></div><div id="cap2" style="position:fixed;z-index:10001;left:24px;top:'+(H*0.56+8)+'px;color:#cfe;font:18px sans-serif;text-shadow:0 0 6px #000"></div>');
  const ren=new T.WebGLRenderer({canvas:document.getElementById('review'),antialias:true,preserveDrawingBuffer:true});ren.setSize(W,H);ren.setScissorTest(true);
  window.__review={sc,ren,us:[]};
  // ---- 試作の部品 ----
  const V=(x,y,z)=>new T.Vector3(x,y,z),lerp=(a,b,t)=>a.clone().lerp(b,t);
  window.__kit=add=>{
   const seg=(a,b,w,d,c,roll=0)=>{const dir=b.clone().sub(a),len=dir.length();dir.normalize();
    let x=new T.Vector3().crossVectors(dir,V(0,1,0));if(x.lengthSq()<1e-4)x.set(1,0,0);x.normalize();const z=new T.Vector3().crossVectors(x,dir);
    const geo=new T.BoxGeometry(w,len,d);if(roll)geo.rotateY(roll);geo.applyMatrix4(new T.Matrix4().makeBasis(x,dir,z).setPosition(lerp(a,b,.5)));add(geo,c);};
   const box=(w,h,d,p,c,yaw=0,pitch=0)=>{const geo=new T.BoxGeometry(w,h,d);geo.rotateX(pitch);geo.rotateY(yaw);geo.translate(p.x,p.y,p.z);add(geo,c);};
   const cyl=(r,len,p,c,axis='x',yaw=0,n=8,r2=r)=>{const geo=new T.CylinderGeometry(r2,r,len,n);if(axis==='x')geo.rotateZ(Math.PI/2);if(axis==='z')geo.rotateX(Math.PI/2);geo.rotateY(yaw);geo.translate(p.x,p.y,p.z);add(geo,c);};
   return {seg,box,cyl};
  };
  const PROTO=window.__PROTO={
   // 四脚A：高い膝を外へ張り出す。蜘蛛のような脚
   quadA:add=>{const {seg,box,cyl}=__kit(add);
    cyl(.78,.34,V(0,1.6,0),'frame','y',Math.PI/8);cyl(.95,.16,V(0,1.78,0),'armor','y',Math.PI/8);cyl(.5,.3,V(0,1.32,0),'metal','y',0,8,.34);
    for(const sx of[-1,1])for(const sz of[-1,1]){const yaw=Math.atan2(sx*.85,sz*.7);
     const h=V(sx*.55,1.6,sz*.42),k=V(sx*1.28,2.02,sz*1.02),f=V(sx*1.62,.16,sz*1.36);
     seg(h,k,.3,.32,'frame');seg(lerp(h,k,.12),lerp(h,k,.92),.5,.2,'armor');const up=V(0,.17,0);seg(lerp(h,k,.12).add(up),lerp(h,k,.92).add(up),.42,.14,'armor');
     cyl(.27,.58,k,'metal','x',yaw);
     seg(k,f,.24,.28,'frame');seg(lerp(k,f,.08),lerp(k,f,.62),.44,.4,'armor');seg(lerp(k,f,.3),lerp(k,f,.38),.47,.43,'trim');
     seg(lerp(k,f,.62),lerp(k,f,.9),.3,.3,'metal');
     box(.5,.16,.66,V(f.x,.08,f.z),'metal',yaw);box(.3,.12,.3,V(f.x+Math.sin(yaw)*.38,.1,f.z+Math.cos(yaw)*.38),'frame',yaw,0);}
   },
   // 四脚B：低い胴体から太い柱の脚。重機のような脚
   quadB:add=>{const {seg,box,cyl}=__kit(add);
    box(1.3,.5,1.7,V(0,1.52,0),'frame');box(1.5,.24,1.2,V(0,1.74,0),'armor');box(.9,.3,.3,V(0,1.5,-.95),'armor');box(.9,.3,.3,V(0,1.5,.95),'armor');box(.7,.08,.32,V(0,1.5,-.96),'trim');
    for(const sx of[-1,1])for(const sz of[-1,1]){
     const h=V(sx*.62,1.5,sz*.6),k=V(sx*1.18,1.28,sz*1.12),f=V(sx*1.18,.2,sz*1.12),yaw=Math.atan2(sx*.56,sz*.52);
     seg(h,k,.4,.42,'frame');seg(lerp(h,k,.1),lerp(h,k,1.05),.62,.3,'armor');
     cyl(.3,.74,k,'metal','x',yaw);
     seg(k,f,.34,.34,'frame');box(.66,.86,.66,V(f.x,.72,f.z),'armor',yaw);box(.7,.12,.7,V(f.x,.93,f.z),'trim',yaw);
     box(.74,.3,.2,V(f.x+Math.sin(yaw)*.36,.72,f.z+Math.cos(yaw)*.36),'metal',yaw);
     box(.84,.2,.9,V(f.x,.1,f.z),'metal',yaw);box(.6,.14,.26,V(f.x+Math.sin(yaw)*.5,.07,f.z+Math.cos(yaw)*.5),'frame',yaw);}
   },
   // 逆脚A：太い腿が後ろへ、細い脛が前へ。2節の逆関節
   revA:add=>{const {seg,box,cyl}=__kit(add);
    for(const sx of[-1,1]){const h=V(sx*.6,1.8,.02),k=V(sx*.66,1.08,.86),a=V(sx*.66,.26,-.08);
     cyl(.24,.5,h,'metal');seg(h,k,.34,.4,'frame');seg(lerp(h,k,-.05),lerp(h,k,.8),.58,.62,'armor');seg(lerp(h,k,.3),lerp(h,k,.42),.62,.66,'trim');
     cyl(.25,.6,k,'metal');
     seg(k,a,.24,.28,'frame');const fw=V(0,0,-.16);seg(lerp(k,a,.15).add(fw),lerp(k,a,.8).add(fw),.36,.16,'armor');
     seg(lerp(h,k,.55).add(V(0,-.12,-.18)),lerp(k,a,.5).add(V(0,0,.12)),.1,.1,'metal');
     cyl(.17,.44,a,'metal');
     box(.42,.14,.95,V(a.x,.09,-.5),'metal',0,-.06);box(.3,.12,.4,V(a.x,.16,-.78),'armor',0,-.2);box(.16,.1,.22,V(a.x-.13,.06,-1.02),'frame');box(.16,.1,.22,V(a.x+.13,.06,-1.02),'frame');
     seg(a,V(a.x,.05,.42),.2,.14,'frame');}
   },
   // 逆脚B：鳥の脚。腿が前、中間が後ろ、足首が前の3節
   revB:add=>{const {seg,box,cyl}=__kit(add);
    for(const sx of[-1,1]){const h=V(sx*.6,1.8,.04),k=V(sx*.66,1.38,-.5),o=V(sx*.66,.82,.62),a=V(sx*.66,.24,.02);
     cyl(.24,.5,h,'metal');seg(h,k,.36,.4,'frame');seg(lerp(h,k,-.1),lerp(h,k,1.05),.56,.56,'armor');
     cyl(.22,.56,k,'metal');
     seg(k,o,.26,.3,'frame');seg(lerp(k,o,.1),lerp(k,o,.85),.4,.36,'armor');seg(lerp(k,o,.44),lerp(k,o,.52),.43,.39,'trim');
     cyl(.2,.5,o,'metal');
     seg(o,a,.18,.2,'frame');seg(lerp(o,a,.1),lerp(o,a,.75).add(V(0,0,.1)),.08,.08,'metal');
     cyl(.15,.4,a,'metal');
     for(const t of[-1,1]){seg(a,V(a.x+t*.24,.06,-.82),.16,.14,'metal');box(.14,.1,.2,V(a.x+t*.26,.05,-.9),'frame');}
     seg(a,V(a.x,.05,.5),.16,.12,'frame');box(.3,.12,.3,V(a.x,.2,0),'armor');}
   },
  };
 },{W,H});
 const variants=[['quadA','四脚 A案：高い膝を外へ張り出す脚（蜘蛛型）'],['quadB','四脚 B案：低い胴から太い柱の脚（重機型）'],['revA','逆脚 A案：太い腿が後ろへ曲がる2節の脚'],['revB','逆脚 B案：鳥の脚の形の3節の脚']];
 for(const [key,label] of variants){console.log(key);
  await page.evaluate(({key,label,W,H})=>{
   const g=__g,T=g.T,r=__review;for(const u of r.us){r.sc.remove(u.group);g.disposeMech(u.group);}r.us=[];
   window.__legProto=__PROTO[key];
   const ups=[['light','ash'],['standard','team'],['heavy','team']];
   const mk=(up,color,x,yaw,team)=>{const cfg={head:up,body:up,arms:up,legs:'standard',color};
    const m=g.buildMech(g.TEAM[team].color,cfg),u={...m,group:m.g,pos:new T.Vector3(x,0,0),vel:new T.Vector3(),alive:true,onGround:true,yaw:0,pitch:0,isPlayer:true,recoil:0,cannonDeploy:0,slots:Object.fromEntries(g.SLOTS.map(s=>[s,g.slotOf(g.loadout.assault[s])])),weapon:'main',swing:null,planted:false};
    r.sc.add(u.group);g.weaponLook(u,0);u.group.position.set(x,0,0);u.group.rotation.y=yaw;u.group.updateMatrixWorld(true);r.us.push(u);};
   ups.forEach(([up,color],i)=>mk(up,color,(1-i)*5.4,0,i===1?'R':'B'));
   const cam=new T.PerspectiveCamera(30,W/(H*.56),.1,120),cam2=new T.PerspectiveCamera(30,W/(H*.44),.1,120);
   r.ren.setViewport(0,H*.44,W,H*.56);r.ren.setScissor(0,H*.44,W,H*.56);cam.position.set(4.5,4.2,-13.5);cam.lookAt(0,1.6,0);r.ren.render(r.sc,cam);
   r.ren.setViewport(0,0,W,H*.44);r.ren.setScissor(0,0,W,H*.44);
   // 下段：真横から（左が前）
   for(const u of r.us){u.group.rotation.y=-Math.PI/2;u.group.updateMatrixWorld(true);}
   cam2.position.set(0,2.0,-12.5);cam2.lookAt(0,1.9,0);r.ren.render(r.sc,cam2);
   document.getElementById('caption').textContent=label+'\n左から 軽量・標準・重装の上半身';
   document.getElementById('cap2').textContent='真横から（左が前）';
  },{key,label,W,H});
  console.log('shot');await page.screenshot({path:path.join(S,key+'.png'),timeout:60000});
 }
 console.log('errors',errors);await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
